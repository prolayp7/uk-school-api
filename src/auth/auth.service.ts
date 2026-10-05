import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";

export interface SessionUser {
  id: string;
  emailNormalized: string;
  permissions: string[];
  roleCodes: string[];
  schools: Array<{ id: string; code: string; name: string }>;
}

interface SessionRecord {
  userId: string;
  user: SessionUser;
  expiresAt: number;
  schoolIds: string[];
}

interface PasswordResetRecord {
  userId: string;
  expiresAt: number;
}

@Injectable()
export class AuthService {
  private readonly sessionStore = new Map<string, SessionRecord>();
  private readonly resetTokenStore = new Map<string, PasswordResetRecord>();

  constructor(private readonly prisma: PrismaService) {}

  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  hashPassword(password: string, salt = randomUUID()): string {
    const derived = scryptSync(password, salt, 64).toString("hex");
    return `scrypt$${salt}$${derived}`;
  }

  verifyPassword(hash: string, candidate: string): boolean {
    if (!hash.startsWith("scrypt$")) {
      return false;
    }

    const [, salt, expected] = hash.split("$");
    if (!salt || !expected) {
      return false;
    }

    const derived = scryptSync(candidate, salt, 64).toString("hex");
    const actual = Buffer.from(derived, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");

    if (actual.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(actual, expectedBuffer);
  }

  async verifyCredentials(
    email: string,
    password: string,
  ): Promise<{
    id: string;
    emailNormalized: string;
    passwordHash: string;
    status: string;
  } | null> {
    const normalized = this.normalizeEmail(email);

    const user = await this.prisma.user.findUnique({
      where: { emailNormalized: normalized },
    });

    if (!user || user.status !== "active") {
      return null;
    }

    if (!this.verifyPassword(user.passwordHash, password)) {
      return null;
    }

    return user;
  }

  private async getMembershipContext(userId: string): Promise<{
    schools: Array<{ id: string; code: string; name: string }>;
    permissions: string[];
    roleCodes: string[];
    schoolIds: string[];
  }> {
    const memberships = await this.prisma.schoolMembership.findMany({
      where: {
        userId,
        status: "active",
      },
      include: {
        school: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        membershipRoles: {
          include: {
            role: {
              select: {
                code: true,
              },
            },
          },
        },
      },
    });

    const schools = memberships
      .map(({ school, schoolId }) => {
        if (!school) {
          return {
            id: schoolId,
            code: "UNKNOWN",
            name: "Unknown school",
          };
        }

        return {
          id: school.id,
          code: school.code,
          name: school.name,
        };
      })
      .filter((school) => Boolean(school));

    const schoolIds = memberships.map(({ schoolId }) => schoolId);
    const roleCodes = Array.from(
      new Set(
        memberships.flatMap(({ membershipRoles = [] }) =>
          membershipRoles.map(({ role }) => role?.code ?? "UNKNOWN_ROLE"),
        ),
      ),
    );

    const uniqueRoleIds = Array.from(
      new Set(
        memberships.flatMap(({ membershipRoles = [] }) =>
          membershipRoles.map(({ roleId }) => roleId).filter(Boolean),
        ),
      ),
    );

    const permissionEntries = this.prisma.rolePermission
      ? await this.prisma.rolePermission.findMany({
          where: {
            schoolId: { in: schoolIds },
            roleId: { in: uniqueRoleIds },
          },
          select: {
            permissionCode: true,
          },
        })
      : [];

    const permissions = Array.from(
      new Set(permissionEntries.map(({ permissionCode }) => permissionCode)),
    );

    return { schools, permissions, roleCodes, schoolIds };
  }

  async createSession({
    email,
    password,
  }: {
    email: string;
    password: string;
  }): Promise<{
    token: string;
    user: SessionUser;
    schools: Array<{ id: string; code: string; name: string }>;
  }> {
    const user = await this.verifyCredentials(email, password);

    if (!user) {
      throw new UnauthorizedException("Invalid username or password.");
    }

    const membershipContext = await this.getMembershipContext(user.id);
    const token = randomUUID();
    const session: SessionRecord = {
      userId: user.id,
      schoolIds: membershipContext.schoolIds,
      expiresAt: Date.now() + 8 * 60 * 60 * 1000,
      user: {
        id: user.id,
        emailNormalized: user.emailNormalized,
        permissions: membershipContext.permissions,
        roleCodes: membershipContext.roleCodes,
        schools: membershipContext.schools,
      },
    };

    this.sessionStore.set(token, session);

    return {
      token,
      user: session.user,
      schools: membershipContext.schools,
    };
  }

  resolveSession(token: string): SessionRecord | null {
    const session = this.sessionStore.get(token);
    if (!session) {
      return null;
    }

    if (Date.now() > session.expiresAt) {
      this.sessionStore.delete(token);
      return null;
    }

    return session;
  }

  revokeSession(token: string): boolean {
    return this.sessionStore.delete(token);
  }

  async getCurrentUser(token: string): Promise<SessionUser> {
    const session = this.resolveSession(token);

    if (!session) {
      throw new UnauthorizedException("Session is invalid or expired.");
    }

    return session.user;
  }

  async requestPasswordReset(email: string): Promise<string> {
    const normalized = this.normalizeEmail(email);
    const user = await this.prisma.user.findUnique({
      where: { emailNormalized: normalized },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException("No account found for that email address.");
    }

    const token = randomUUID();
    this.resetTokenStore.set(token, {
      userId: user.id,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });

    return token;
  }

  async resetPassword({
    token,
    password,
  }: {
    token: string;
    password: string;
  }): Promise<boolean> {
    const record = this.resetTokenStore.get(token);

    if (!record) {
      return false;
    }

    if (Date.now() > record.expiresAt) {
      this.resetTokenStore.delete(token);
      return false;
    }

    const salt = randomUUID();
    const passwordHash = this.hashPassword(password, salt);

    await this.prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    });

    this.resetTokenStore.delete(token);
    return true;
  }

  async updatePasswordForEmail(email: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { emailNormalized: this.normalizeEmail(email) },
      select: { id: true, status: true },
    });

    if (!user || user.status !== "active") {
      throw new NotFoundException("No active portal account was found for this contact.");
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: this.hashPassword(password) },
    });

    for (const [token, session] of this.sessionStore) {
      if (session.userId === user.id) {
        this.sessionStore.delete(token);
      }
    }

    for (const [token, reset] of this.resetTokenStore) {
      if (reset.userId === user.id) {
        this.resetTokenStore.delete(token);
      }
    }
  }
}
