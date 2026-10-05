import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { HealthService } from "./health.service";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("live")
  @ApiOkResponse({ description: "The API process is running." })
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  @ApiOkResponse({ description: "The API and required database are ready." })
  @ApiServiceUnavailableResponse({
    description: "A required dependency is unavailable.",
  })
  async ready(): Promise<{ status: "ok" }> {
    if (!(await this.health.isReady())) {
      throw new ServiceUnavailableException({
        code: "SERVICE_NOT_READY",
        message: "A required service is not ready.",
      });
    }

    return { status: "ok" };
  }
}
