import {
  Injectable,
  HttpException,
  HttpStatus,
  Inject,
  ForbiddenException,
  UnauthorizedException,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AUTH_MAILER } from "./auth.constants";
import type { AuthMailer } from "./auth.mailer";

const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const RESET_LIFETIME_MS = 15 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const RESET_WINDOW_MS = 60 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const MAX_ADDRESS_LOGIN_ATTEMPTS = 30;
const MAX_RESET_REQUESTS = 3;
const MAX_ADDRESS_RESET_REQUESTS = 20;

export interface SessionUser {
  id: string;
  emailNormalized: string;
  permissions: string[];
  roleCodes: string[];
  schools: Array<{ id: string; code: string; name: string }>;
}

export interface SessionRecord {
  userId: string;
  user: SessionUser;
  expiresAt: number;
  schoolIds: string[];
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUTH_MAILER) private readonly mailer: AuthMailer,
  ) {}

  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  hashPassword(password: string, salt: string = randomUUID()): string {
    const derived = scryptSync(password, salt, 64).toString("hex");
    return `scrypt$${salt}$${derived}`;
  }

  verifyPassword(hash: string, candidate: string): boolean {
    if (!hash.startsWith("scrypt$")) return false;
    const [, salt, expected] = hash.split("$");
    if (!salt || !expected) return false;

    const derived = scryptSync(candidate, salt, 64).toString("hex");
    const actual = Buffer.from(derived, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
  }

  private async getMembershipContext(userId: string): Promise<{
    schools: Array<{ id: string; code: string; name: string }>;
    permissions: string[];
    roleCodes: string[];
    schoolIds: string[];
  }> {
    const memberships = await this.prisma.schoolMembership.findMany({
      where: { userId, status: "active" },
      include: {
        school: { select: { id: true, code: true, name: true } },
        membershipRoles: {
          include: { role: { select: { code: true } } },
        },
      },
    });

    const schools = memberships.map(({ school, schoolId }) => school ?? {
      id: schoolId,
      code: "UNKNOWN",
      name: "Unknown school",
    });
    const schoolIds = memberships.map(({ schoolId }) => schoolId);
    const roleCodes = Array.from(new Set(memberships.flatMap(({ membershipRoles = [] }) =>
      membershipRoles.map(({ role }) => role?.code ?? "UNKNOWN_ROLE"),
    )));
    const roleIds = Array.from(new Set(memberships.flatMap(({ membershipRoles = [] }) =>
      membershipRoles.map(({ roleId }) => roleId).filter(Boolean),
    )));
    const permissionEntries = schoolIds.length && roleIds.length
      ? await this.prisma.rolePermission.findMany({
          where: { schoolId: { in: schoolIds }, roleId: { in: roleIds } },
          select: { permissionCode: true },
        })
      : [];

    return {
      schools,
      schoolIds,
      roleCodes,
      permissions: Array.from(new Set(permissionEntries.map(({ permissionCode }) => permissionCode))),
    };
  }

  private async audit(action: string, actorUserId: string | null, metadata: object): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        action,
        entityType: "auth",
        actorUserId,
        metadata,
      },
    });
  }

  private async enforceRateLimit(
    bucket: string,
    windowMs: number,
    maximum: number,
  ): Promise<void> {
    const bucketKey = this.hash(bucket);
    const [updated] = await this.prisma.$queryRaw<
      Array<{ attempts: number; locked_until: Date | null }>
    >`
      INSERT INTO "auth_rate_limits" ("bucket_key", "attempts", "window_started_at")
      VALUES (${bucketKey}, 1, NOW())
      ON CONFLICT ("bucket_key") DO UPDATE SET
        "attempts" = CASE
          WHEN "auth_rate_limits"."window_started_at" <= NOW() - (${windowMs} * INTERVAL '1 millisecond')
          THEN 1
          ELSE "auth_rate_limits"."attempts" + 1
        END,
        "window_started_at" = CASE
          WHEN "auth_rate_limits"."window_started_at" <= NOW() - (${windowMs} * INTERVAL '1 millisecond')
          THEN NOW()
          ELSE "auth_rate_limits"."window_started_at"
        END,
        "locked_until" = CASE
          WHEN "auth_rate_limits"."locked_until" > NOW()
          THEN "auth_rate_limits"."locked_until"
          WHEN "auth_rate_limits"."window_started_at" <= NOW() - (${windowMs} * INTERVAL '1 millisecond')
          THEN NULL
          WHEN "auth_rate_limits"."attempts" + 1 >= ${maximum}
          THEN NOW() + (${windowMs} * INTERVAL '1 millisecond')
          ELSE NULL
        END
      RETURNING "attempts", "locked_until"
    `;
    if (
      updated?.attempts >= maximum ||
      (updated?.locked_until && updated.locked_until > new Date())
    ) {
      throw new HttpException("Too many attempts. Please try again later.", HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async assertNotRateLimited(bucket: string): Promise<void> {
    const bucketKey = this.hash(bucket);
    const existing = await this.prisma.authRateLimit.findUnique({ where: { bucketKey } });
    if (existing?.lockedUntil && existing.lockedUntil > new Date()) {
      throw new HttpException(
        "Too many attempts. Please try again later.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async createSession({
    email,
    password,
    clientAddress = "unknown",
    requiredRoleCode,
  }: {
    email: string;
    password: string;
    clientAddress?: string;
    requiredRoleCode?: "SUPER_ADMIN";
  }): Promise<{
    token: string;
    user: SessionUser;
    schools: Array<{ id: string; code: string; name: string }>;
  }> {
    const normalized = this.normalizeEmail(email);
    const accountBucket = `login:account:${normalized}`;
    const addressBucket = `login:address:${clientAddress}`;
    try {
      await this.assertNotRateLimited(accountBucket);
      await this.assertNotRateLimited(addressBucket);
    } catch (error) {
      await this.audit("auth.sign_in.failed", null, {
        emailHash: this.hash(normalized),
        addressHash: this.hash(clientAddress),
      });
      throw error;
    }

    const user = await this.prisma.user.findUnique({
      where: { emailNormalized: normalized },
    });
    const valid = Boolean(
      user && user.status === "active" && this.verifyPassword(user.passwordHash, password),
    );

    if (!valid || !user) {
      try {
        await this.enforceRateLimit(
          accountBucket,
          LOGIN_WINDOW_MS,
          MAX_LOGIN_ATTEMPTS,
        );
        await this.enforceRateLimit(
          addressBucket,
          LOGIN_WINDOW_MS,
          MAX_ADDRESS_LOGIN_ATTEMPTS,
        );
      } catch (error) {
        await this.audit("auth.sign_in.failed", null, {
          emailHash: this.hash(normalized),
          addressHash: this.hash(clientAddress),
        });
        throw error;
      }
      await this.audit("auth.sign_in.failed", null, {
        emailHash: this.hash(normalized),
        addressHash: this.hash(clientAddress),
      });
      throw new UnauthorizedException("Invalid username or password.");
    }

    await this.prisma.authRateLimit.deleteMany({
      where: { bucketKey: this.hash(accountBucket) },
    });
    const membershipContext = await this.getMembershipContext(user.id);
    if (requiredRoleCode && !membershipContext.roleCodes.includes(requiredRoleCode)) {
      await this.audit("auth.sign_in.failed", user.id, {
        addressHash: this.hash(clientAddress),
        reason: "role_restricted_login",
        requiredRoleCode,
      });
      throw new ForbiddenException("Super administrator access is required.");
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.authSession.create({
        data: {
          tokenHash: this.hash(token),
          userId: user.id,
          expiresAt,
        },
      });
      await transaction.auditEvent.create({
        data: {
          action: "auth.sign_in.succeeded",
          entityType: "auth",
          actorUserId: user.id,
          metadata: { addressHash: this.hash(clientAddress) },
        },
      });
    });

    return {
      token,
      user: {
        id: user.id,
        emailNormalized: user.emailNormalized,
        permissions: membershipContext.permissions,
        roleCodes: membershipContext.roleCodes,
        schools: membershipContext.schools,
      },
      schools: membershipContext.schools,
    };
  }

  async resolveSession(token: string): Promise<SessionRecord | null> {
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: this.hash(token) },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now() ||
      session.user.status !== "active"
    ) {
      return null;
    }

    const membershipContext = await this.getMembershipContext(session.user.id);
    return {
      userId: session.user.id,
      schoolIds: membershipContext.schoolIds,
      expiresAt: session.expiresAt.getTime(),
      user: {
        id: session.user.id,
        emailNormalized: session.user.emailNormalized,
        permissions: membershipContext.permissions,
        roleCodes: membershipContext.roleCodes,
        schools: membershipContext.schools,
      },
    };
  }

  async revokeSession(token: string): Promise<boolean> {
    const result = await this.prisma.authSession.updateMany({
      where: { tokenHash: this.hash(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count > 0;
  }

  async getCurrentUser(token: string): Promise<SessionUser> {
    const session = await this.resolveSession(token);
    if (!session) throw new UnauthorizedException("Session is invalid or expired.");
    return session.user;
  }

  async requestPasswordReset(email: string, clientAddress = "unknown"): Promise<void> {
    const normalized = this.normalizeEmail(email);
    await this.enforceRateLimit(
      `reset:account:${normalized}`,
      RESET_WINDOW_MS,
      MAX_RESET_REQUESTS,
    );
    await this.enforceRateLimit(
      `reset:address:${clientAddress}`,
      RESET_WINDOW_MS,
      MAX_ADDRESS_RESET_REQUESTS,
    );

    const user = await this.prisma.user.findUnique({
      where: { emailNormalized: normalized },
      select: { id: true, status: true },
    });
    await this.audit("auth.password_reset.requested", user?.id ?? null, {
      emailHash: this.hash(normalized),
      addressHash: this.hash(clientAddress),
    });
    if (!user || user.status !== "active") return;

    const token = randomBytes(32).toString("base64url");
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await this.prisma.passwordResetToken.create({
      data: {
        tokenHash: this.hash(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + RESET_LIFETIME_MS),
      },
    });
    try {
      await this.mailer.sendPasswordReset(normalized, token);
    } catch (error) {
      await this.prisma.passwordResetToken.updateMany({
        where: { tokenHash: this.hash(token), consumedAt: null },
        data: { consumedAt: new Date() },
      });
      throw error;
    }
  }

  async resetPassword({
    token,
    password,
  }: {
    token: string;
    password: string;
  }): Promise<boolean> {
    const tokenHash = this.hash(token);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });
    if (!record || record.consumedAt || record.expiresAt.getTime() <= Date.now()) return false;

    const now = new Date();
    const completed = await this.prisma.$transaction(async (transaction) => {
      const claim = await transaction.passwordResetToken.updateMany({
        where: { id: record.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (claim.count !== 1) return false;

      await transaction.user.update({
        where: { id: record.userId },
        data: { passwordHash: this.hashPassword(password) },
      });
      const resetUser = await transaction.user.findUnique({
        where: { id: record.userId },
        select: { emailNormalized: true },
      });
      if (resetUser) {
        await transaction.authRateLimit.deleteMany({
          where: {
            bucketKey: this.hash(`login:account:${resetUser.emailNormalized}`),
          },
        });
      }
      await transaction.authSession.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.passwordResetToken.updateMany({
        where: { userId: record.userId, consumedAt: null },
        data: { consumedAt: now },
      });
      await transaction.auditEvent.create({
        data: {
          action: "auth.password_reset.completed",
          entityType: "auth",
          actorUserId: record.userId,
          metadata: {},
        },
      });
      return true;
    });
    return completed;
  }

  async updatePasswordForEmail(email: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { emailNormalized: this.normalizeEmail(email) },
      select: { id: true, status: true },
    });
    if (!user || user.status !== "active") {
      throw new NotFoundException("No active portal account was found for this contact.");
    }

    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: user.id },
        data: { passwordHash: this.hashPassword(password) },
      });
      await transaction.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: now },
      });
      await transaction.authRateLimit.deleteMany({
        where: {
          bucketKey: this.hash(
            `login:account:${this.normalizeEmail(email)}`,
          ),
        },
      });
      await transaction.auditEvent.create({
        data: {
          action: "auth.password.admin_updated",
          entityType: "auth",
          actorUserId: user.id,
          metadata: {},
        },
      });
    });
  }
}
