import { ForbiddenException } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

describe("AuthController admin password updates", () => {
  const authService = {
    updatePasswordForEmail: jest.fn(),
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
});
