import { createHash, scryptSync } from "node:crypto";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthMailer } from "./auth.mailer";
import { AuthService } from "./auth.service";

function makePrisma() {
  const user = {
    id: "user-1",
    emailNormalized: "head@example.test",
    passwordHash: `scrypt$development-seed$${scryptSync(
      "ChangeMe123!",
      "development-seed",
      64,
    ).toString("hex")}`,
    status: "active",
  };
  const transaction = jest.fn();
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ ...user, ...data }),
      ),
    },
    schoolMembership: {
      findMany: jest.fn().mockResolvedValue([
        {
          schoolId: "school-1",
          userId: "user-1",
          school: { id: "school-1", code: "ONE", name: "One School" },
          membershipRoles: [],
        },
      ]),
    },
    rolePermission: { findMany: jest.fn().mockResolvedValue([]) },
    authRateLimit: {
      findUnique: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    authSession: {
      create: jest.fn().mockResolvedValue({ id: "session-1" }),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    passwordResetToken: {
      create: jest.fn().mockResolvedValue({ id: "reset-1" }),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue([{ attempts: 1, locked_until: null }]),
    $transaction: transaction,
  };
  transaction.mockImplementation(async (operation: unknown) => {
    if (Array.isArray(operation)) return Promise.all(operation);
    if (typeof operation === "function") {
      return (operation as (client: PrismaService) => Promise<unknown>)(
        prisma as unknown as PrismaService,
      );
    }
    throw new Error("Unexpected transaction operation.");
  });
  return { prisma: prisma as unknown as PrismaService, mocks: prisma, user };
}

describe("AuthService", () => {
  const mailer = { sendPasswordReset: jest.fn().mockResolvedValue(undefined) } as unknown as AuthMailer;

  beforeEach(() => jest.clearAllMocks());

  it("verifies the seeded scrypt password format", () => {
    const { prisma } = makePrisma();
    const service = new AuthService(prisma, mailer);
    const hash = service.hashPassword("NewPass123!", "test-salt");
    expect(service.verifyPassword(hash, "NewPass123!")).toBe(true);
    expect(service.verifyPassword(hash, "wrong-password")).toBe(false);
  });

  it("stores only a hash of each persistent session token and resolves current memberships", async () => {
    const { prisma, mocks, user } = makePrisma();
    const service = new AuthService(prisma, mailer);
    const session = await service.createSession({
      email: "head@example.test",
      password: "ChangeMe123!",
    });
    const stored = mocks.authSession.create.mock.calls[0][0].data;

    expect(session.token).toBeTruthy();
    expect(stored.tokenHash).toBe(createHash("sha256").update(session.token).digest("hex"));
    expect(stored.tokenHash).not.toBe(session.token);
    expect(session.schools).toEqual([{ id: "school-1", code: "ONE", name: "One School" }]);

    mocks.authSession.findUnique.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user,
    });
    await expect(service.resolveSession(session.token)).resolves.toMatchObject({
      userId: "user-1",
      schoolIds: ["school-1"],
    });
    await expect(service.revokeSession(session.token)).resolves.toBe(true);

    mocks.authSession.findUnique.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      expiresAt: new Date(Date.now() - 1),
      revokedAt: null,
      user,
    });
    await expect(service.resolveSession(session.token)).resolves.toBeNull();
    mocks.authSession.findUnique.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(),
      user,
    });
    await expect(service.resolveSession(session.token)).resolves.toBeNull();
  });

  it("allows only super administrators to create website-admin sessions", async () => {
    const { prisma, mocks } = makePrisma();
    mocks.schoolMembership.findMany.mockResolvedValue([
      {
        schoolId: "school-1",
        userId: "user-1",
        school: { id: "school-1", code: "ONE", name: "One School" },
        membershipRoles: [
          { roleId: "role-1", role: { code: "SUPER_ADMIN" } },
        ],
      },
    ]);
    const service = new AuthService(prisma, mailer);

    await expect(service.createSession({
      email: "superadmin@example.test",
      password: "ChangeMe123!",
      requiredRoleCode: "SUPER_ADMIN",
    })).resolves.toMatchObject({ user: { roleCodes: ["SUPER_ADMIN"] } });
    expect(mocks.authSession.create).toHaveBeenCalledTimes(1);
  });

  it("rejects non-superadmins without creating a website-admin session", async () => {
    const { prisma, mocks } = makePrisma();
    const service = new AuthService(prisma, mailer);

    await expect(service.createSession({
      email: "head@example.test",
      password: "ChangeMe123!",
      requiredRoleCode: "SUPER_ADMIN",
    })).rejects.toMatchObject({ status: 403 });

    expect(mocks.authSession.create).not.toHaveBeenCalled();
    expect(mocks.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "auth.sign_in.failed",
        metadata: expect.objectContaining({
          reason: "role_restricted_login",
          requiredRoleCode: "SUPER_ADMIN",
        }),
      }),
    }));
  });

  it("audits invalid credentials without recording the email or password", async () => {
    const { prisma, mocks, user } = makePrisma();
    mocks.user.findUnique.mockResolvedValue({ ...user, passwordHash: "invalid" });
    const service = new AuthService(prisma, mailer);

    await expect(service.createSession({
      email: "HEAD@example.test",
      password: "wrong-password",
    })).rejects.toMatchObject({ status: 401 });

    expect(mocks.$queryRaw).toHaveBeenCalled();
    expect(mocks.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "auth.sign_in.failed",
        metadata: expect.not.objectContaining({
          email: "head@example.test",
          password: "wrong-password",
        }),
      }),
    }));
  });

  it("locks an account after repeated failed sign-ins, including concurrent-safe counts", async () => {
    const { prisma, mocks, user } = makePrisma();
    mocks.user.findUnique.mockResolvedValue({ ...user, passwordHash: "invalid" });
    mocks.$queryRaw.mockResolvedValue([
      { attempts: 5, locked_until: new Date(Date.now() + 60_000) },
    ]);
    const service = new AuthService(prisma, mailer);

    await expect(service.createSession({
      email: "head@example.test",
      password: "wrong-password",
    })).rejects.toMatchObject({ status: 429 });
    expect(mocks.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "auth.sign_in.failed" }),
    }));
  });

  it("does not issue a reset token for unknown accounts and sends a message for active accounts", async () => {
    const { prisma, mocks } = makePrisma();
    const service = new AuthService(prisma, mailer);
    await expect(service.requestPasswordReset("head@example.test")).resolves.toBeUndefined();
    expect(mocks.passwordResetToken.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: "user-1", tokenHash: expect.any(String) }),
    }));
    expect(mailer.sendPasswordReset).toHaveBeenCalledWith(
      "head@example.test",
      expect.any(String),
    );

    mocks.user.findUnique.mockResolvedValue(null);
    await expect(service.requestPasswordReset("missing@example.test")).resolves.toBeUndefined();
    expect(mailer.sendPasswordReset).toHaveBeenCalledTimes(1);
  });

  it("rejects expired reset tokens and consumes valid tokens while revoking sessions", async () => {
    const { prisma, mocks } = makePrisma();
    const service = new AuthService(prisma, mailer);
    const token = "opaque-reset-token";
    mocks.passwordResetToken.findUnique.mockResolvedValue({
      id: "reset-1",
      userId: "user-1",
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    let tokenClaimed = false;
    mocks.passwordResetToken.updateMany.mockImplementation(({ where }) => {
      if (where.id === "reset-1") {
        if (tokenClaimed) return Promise.resolve({ count: 0 });
        tokenClaimed = true;
        return Promise.resolve({ count: 1 });
      }
      return Promise.resolve({ count: 1 });
    });

    await expect(service.resetPassword({ token, password: "NewPass123!" })).resolves.toBe(true);
    await expect(service.resetPassword({ token, password: "OtherPass123!" })).resolves.toBe(false);
    expect(mocks.passwordResetToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: createHash("sha256").update(token).digest("hex") },
    });
    expect(mocks.authSession.updateMany).toHaveBeenCalled();
    expect(mocks.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "auth.password_reset.completed" }),
    }));
    expect(mocks.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        passwordHash: expect.stringContaining("scrypt$"),
      }),
    }));

    mocks.passwordResetToken.findUnique.mockResolvedValue({
      id: "reset-expired",
      userId: "user-1",
      consumedAt: null,
      expiresAt: new Date(Date.now() - 1),
    });
    await expect(service.resetPassword({ token, password: "Another123!" })).resolves.toBe(false);
  });

  it("revokes sessions and outstanding reset tokens after an administrative password change", async () => {
    const { prisma, mocks } = makePrisma();
    const service = new AuthService(prisma, mailer);
    await service.updatePasswordForEmail(" HEAD@EXAMPLE.TEST ", "NewPass123!");

    expect(mocks.authSession.updateMany).toHaveBeenCalled();
    expect(mocks.passwordResetToken.updateMany).toHaveBeenCalled();
    expect(mocks.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "auth.password.admin_updated" }),
    }));
  });
});
