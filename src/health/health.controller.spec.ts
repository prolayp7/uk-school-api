import { ServiceUnavailableException } from "@nestjs/common";
import { HealthController } from "./health.controller";
import type { HealthService } from "./health.service";

describe("HealthController", () => {
  const health = { isReady: jest.fn<Promise<boolean>, []>() };
  const controller = new HealthController(health as unknown as HealthService);

  beforeEach(() => jest.clearAllMocks());

  it("reports process liveness without checking dependencies", () => {
    expect(controller.live()).toEqual({ status: "ok" });
    expect(health.isReady).not.toHaveBeenCalled();
  });

  it("reports readiness only when PostgreSQL is reachable", async () => {
    health.isReady.mockResolvedValue(true);
    await expect(controller.ready()).resolves.toEqual({ status: "ok" });

    health.isReady.mockResolvedValue(false);
    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
