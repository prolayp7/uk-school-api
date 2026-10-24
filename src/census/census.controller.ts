import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, SchoolAccessGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import {
  CensusReadinessQueryDto,
  ListStaffComplianceQueryDto,
  UpdateStaffComplianceDto,
} from "./census.dto";
import { CensusService } from "./census.service";

type AuthenticatedUser = { id: string; schoolIds: string[] };

function resolveSchoolId(user: AuthenticatedUser, requestedSchoolId?: string): string {
  if (requestedSchoolId) return requestedSchoolId;
  if (user.schoolIds.length === 1) return user.schoolIds[0];
  if (user.schoolIds.length > 1) throw new BadRequestException("Select a school with the x-school-id header.");
  throw new BadRequestException("An active school membership is required.");
}

@Controller("erp/census")
@UseGuards(AuthGuard, SchoolAccessGuard)
export class CensusController {
  constructor(private readonly censusService: CensusService) {}

  @Get("readiness")
  readiness(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Query() query: CensusReadinessQueryDto,
  ) {
    return this.censusService.getReadiness(resolveSchoolId(user, schoolId), user.id, query);
  }

  @Get("staff-compliance")
  staffCompliance(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Query() query: ListStaffComplianceQueryDto,
  ) {
    return this.censusService.listStaffCompliance(resolveSchoolId(user, schoolId), user.id, query);
  }

  @Put("staff/:staffProfileId/compliance")
  updateStaffCompliance(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("staffProfileId", ParseUUIDPipe) staffProfileId: string,
    @Body() body: UpdateStaffComplianceDto,
  ) {
    return this.censusService.updateStaffCompliance(
      resolveSchoolId(user, schoolId),
      user.id,
      staffProfileId,
      body,
    );
  }
}
