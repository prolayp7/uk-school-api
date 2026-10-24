import { ForbiddenException } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

describe("AuthController admin password updates", () => {
  const authService = {
    updatePasswordForEmail: jest.fn(),
    requestPasswordReset: jest.fn().mockResolvedValue(undefined),
    createSession: jest.fn(),
  } as unknown as AuthService;
  const controller = new AuthController(authService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects users without the super administrator role", async () => {
    await expect(
      controller.adminUpdatePassword(
        { email: "parent@example.test", password: "NewPass123!" },
        { roleCodes: ["PARENT"] },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(authService.updatePasswordForEmail).not.toHaveBeenCalled();
  });

  it("allows a super administrator to update a portal account", async () => {
    await controller.adminUpdatePassword(
      { email: "parent@example.test", password: "NewPass123!" },
      { roleCodes: ["SUPER_ADMIN"] },
    );
    expect(authService.updatePasswordForEmail).toHaveBeenCalledWith(
      "parent@example.test",
      "NewPass123!",
    );
  });

  it("creates website-admin sessions through the superadmin-only auth service scope", async () => {
    const session = {
      token: "secure-session-token",
      user: { id: "admin-1", roleCodes: ["SUPER_ADMIN"] },
      schools: [{ id: "school-1", code: "ONE", name: "One School" }],
    };
    (authService.createSession as jest.Mock).mockResolvedValue(session);
    const cookie = jest.fn();
    const response = { cookie } as unknown as Response;
    const request = { socket: { remoteAddress: "127.0.0.1" } } as Request;

    await expect(
      controller.createWebsiteAdminSession(
        { email: "admin@example.test", password: "NewPass123!" },
        request,
        response,
      ),
    ).resolves.toEqual(session);

    expect(authService.createSession).toHaveBeenCalledWith({
      email: "admin@example.test",
      password: "NewPass123!",
      clientAddress: "127.0.0.1",
      requiredRoleCode: "SUPER_ADMIN",
    });
    expect(cookie).toHaveBeenCalledWith(
      "session_token",
      session.token,
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it("keeps the general session endpoint available without a role restriction", async () => {
    const session = {
      token: "portal-session-token",
      user: { id: "parent-1", roleCodes: ["PARENT"] },
      schools: [{ id: "school-1", code: "ONE", name: "One School" }],
    };
    (authService.createSession as jest.Mock).mockResolvedValue(session);
    const response = { cookie: jest.fn() } as unknown as Response;
    const request = { socket: { remoteAddress: "127.0.0.1" } } as Request;

    await expect(
      controller.createSession(
        { email: "parent@example.test", password: "ParentPass123!" },
        request,
        response,
      ),
    ).resolves.toEqual(session);

    expect(authService.createSession).toHaveBeenCalledWith({
      email: "parent@example.test",
      password: "ParentPass123!",
      clientAddress: "127.0.0.1",
    });
  });

  it("returns a non-enumerating reset response without exposing a reset token", async () => {
    const response = await controller.forgotPassword(
      { email: "parent@example.test" },
      { socket: { remoteAddress: "127.0.0.1" } } as Request,
    );

    expect(authService.requestPasswordReset).toHaveBeenCalledWith(
      "parent@example.test",
      "127.0.0.1",
    );
    expect(response).toEqual({
      message: "If the account exists, password reset instructions have been sent.",
    });
    expect(response).not.toHaveProperty("token");
  });
});
