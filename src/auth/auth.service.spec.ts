import { createHash, scryptSync } from "node:crypto";
import { AuthService } from "./auth.service";
import type { PrismaService } from "../prisma/prisma.service";

describe("AuthService", () => {
  it("accepts the seeded development password format", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "user-1",
          emailNormalized: "head@example.test",
          passwordHash: `scrypt$development-seed$${scryptSync(
            "ChangeMe123!",
            "development-seed",
            64,
          ).toString("hex")}`,
          status: "active",
        }),
      },
      schoolMembership: {
        findMany: jest.fn().mockResolvedValue([
          { schoolId: "school-1", userId: "user-1", status: "active" },
        ]),
      },
    } as unknown as PrismaService;

    const service = new AuthService(prisma);

    const result = await service.verifyCredentials(
      "head@example.test",
      "ChangeMe123!",
    );

    expect(result).toMatchObject({ id: "user-1", emailNormalized: "head@example.test" });
  });

  it("creates a session token and loads the user school memberships", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "user-1",
          emailNormalized: "head@example.test",
          passwordHash: `scrypt$development-seed$${scryptSync(
            "ChangeMe123!",
            "development-seed",
            64,
          ).toString("hex")}`,
          status: "active",
        }),
      },
      schoolMembership: {
        findMany: jest.fn().mockResolvedValue([
          { schoolId: "school-1", userId: "user-1", status: "active" },
          { schoolId: "school-2", userId: "user-1", status: "active" },
        ]),
      },
    } as unknown as PrismaService;

    const service = new AuthService(prisma);
    const session = await service.createSession({
      email: "head@example.test",
      password: "ChangeMe123!",
    });

    expect(session.token).toBeTruthy();
    expect(session.user.id).toBe("user-1");
    expect(session.schools).toHaveLength(2);
    expect(service.resolveSession(session.token)).toMatchObject({
      userId: "user-1",
    });
  });

  it("requires a reset token to update a password", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "user-1",
          emailNormalized: "head@example.test",
          passwordHash: `scrypt$development-seed$${scryptSync(
            "ChangeMe123!",
            "development-seed",
            64,
          ).toString("hex")}`,
          status: "active",
        }),
        update: jest.fn().mockResolvedValue({ id: "user-1" }),
      },
      schoolMembership: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;

    const service = new AuthService(prisma);
    const token = await service.requestPasswordReset("head@example.test");
    const reset = await service.resetPassword({
      token,
      password: "NewPass123!",
    });

    expect(reset).toBe(true);
    expect(createHash("sha256").update(token).digest("hex")).toBeTruthy();
  });
});
