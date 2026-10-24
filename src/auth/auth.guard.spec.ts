import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthGuard, SchoolAccessGuard, SuperAdminGuard } from "./auth.guard";
import type { AuthService } from "./auth.service";

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("AuthGuard", () => {
  it("rejects requests without a session token", async () => {
    const authService = {
      resolveSession: jest.fn(),
    } as unknown as AuthService;
    const guard = new AuthGuard(authService);

    await expect(guard.canActivate(makeContext({ header: () => undefined })))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(authService.resolveSession).not.toHaveBeenCalled();
  });

  it("rejects revoked, expired, or otherwise unresolved session tokens", async () => {
    const authService = {
      resolveSession: jest.fn().mockResolvedValue(null),
    } as unknown as AuthService;
    const guard = new AuthGuard(authService);
    const request = {
      header: (name: string) => name === "authorization" ? "Bearer token" : undefined,
    };

    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe("SchoolAccessGuard", () => {
  const guard = new SchoolAccessGuard({} as never);

  it("denies access to a school outside the authenticated user's memberships", () => {
    const request = {
      params: { schoolId: "school-2" },
      user: { schoolIds: ["school-1"] },
    };
    expect(() => guard.canActivate(makeContext(request))).toThrow(ForbiddenException);
  });

  describe("SuperAdminGuard", () => {
    const guard = new SuperAdminGuard();

    it("rejects users without the super administrator role", () => {
      expect(() =>
        guard.canActivate(makeContext({ user: { id: "user-1", roleCodes: ["ADMIN"] } })),
      ).toThrow(ForbiddenException);
    });

    it("allows users with an active super administrator role", () => {
      expect(
        guard.canActivate(
          makeContext({ user: { id: "user-1", roleCodes: ["SUPER_ADMIN"] } }),
        ),
      ).toBe(true);
    });
  });

  it("allows access when the requested school is in the active membership set", () => {
    const request = {
      params: { schoolId: "school-1" },
      user: { schoolIds: ["school-1"] },
    };
    expect(guard.canActivate(makeContext(request))).toBe(true);
  });
});
