import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, SchoolAccessGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import {
  CreateBehaviourIncidentDto,
  CreateBehaviourRewardDto,
  CreateBehaviourSanctionDto,
  CreateSafeguardingActionDto,
  CreateSafeguardingConcernDto,
  CreateSafeguardingMeetingDto,
  GrantSafeguardingCaseAccessDto,
  UpdateSafeguardingCaseStatusDto,
} from "./behaviour.dto";
import { BehaviourService } from "./behaviour.service";
import { SafeguardingService } from "./safeguarding.service";

type AuthenticatedUser = { id: string; schoolIds: string[] };

function resolveSchoolId(user: AuthenticatedUser, requestedSchoolId?: string): string {
  if (requestedSchoolId) return requestedSchoolId;
  if (user.schoolIds.length === 1) return user.schoolIds[0];
  if (user.schoolIds.length > 1) {
    throw new BadRequestException("Select a school with the x-school-id header.");
  }
  throw new BadRequestException("An active school membership is required.");
}

@Controller()
@UseGuards(AuthGuard, SchoolAccessGuard)
export class BehaviourController {
  constructor(private readonly behaviourService: BehaviourService) {}

  @Post("erp/behaviour/incidents")
  createIncident(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Body() body: CreateBehaviourIncidentDto,
  ) {
    return this.behaviourService.createIncident(resolveSchoolId(user, schoolId), user.id, body);
  }

  @Post("erp/behaviour/rewards")
  createReward(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Body() body: CreateBehaviourRewardDto,
  ) {
    return this.behaviourService.createReward(resolveSchoolId(user, schoolId), user.id, body);
  }

  @Post("erp/behaviour/incidents/:incidentId/sanctions")
  createSanction(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("incidentId", ParseUUIDPipe) incidentId: string,
    @Body() body: CreateBehaviourSanctionDto,
  ) {
    return this.behaviourService.createSanction(
      resolveSchoolId(user, schoolId),
      user.id,
      incidentId,
      body,
    );
  }

  @Get("erp/pupils/:pupilId/behaviour")
  pupilBehaviour(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("pupilId", ParseUUIDPipe) pupilId: string,
  ) {
    return this.behaviourService.getPupilBehaviour(
      resolveSchoolId(user, schoolId),
      user.id,
      pupilId,
    );
  }

  @Get("erp/behaviour/reports/summary")
  behaviourSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
  ) {
    return this.behaviourService.getSchoolBehaviourSummary(
      resolveSchoolId(user, schoolId),
      user.id,
    );
  }
}

@Controller("erp/safeguarding")
@UseGuards(AuthGuard, SchoolAccessGuard)
export class SafeguardingController {
  constructor(private readonly safeguardingService: SafeguardingService) {}

  @Get("cases")
  listCases(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId?: string,
  ) {
    return this.safeguardingService.listCases(resolveSchoolId(user, schoolId), user.id);
  }

  @Post("concerns")
  submitConcern(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Body() body: CreateSafeguardingConcernDto,
  ) {
    return this.safeguardingService.submitConcern(resolveSchoolId(user, schoolId), user.id, body);
  }

  @Get("cases/:caseId")
  getCase(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("caseId", ParseUUIDPipe) caseId: string,
  ) {
    return this.safeguardingService.getCase(resolveSchoolId(user, schoolId), user.id, caseId);
  }

  @Post("cases/:caseId/actions")
  createAction(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("caseId", ParseUUIDPipe) caseId: string,
    @Body() body: CreateSafeguardingActionDto,
  ) {
    return this.safeguardingService.createAction(resolveSchoolId(user, schoolId), user.id, caseId, body);
  }

  @Post("cases/:caseId/meetings")
  createMeeting(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("caseId", ParseUUIDPipe) caseId: string,
    @Body() body: CreateSafeguardingMeetingDto,
  ) {
    return this.safeguardingService.createMeeting(resolveSchoolId(user, schoolId), user.id, caseId, body);
  }

  @Patch("cases/:caseId/status")
  updateCaseStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("caseId", ParseUUIDPipe) caseId: string,
    @Body() body: UpdateSafeguardingCaseStatusDto,
  ) {
    return this.safeguardingService.updateCaseStatus(resolveSchoolId(user, schoolId), user.id, caseId, body);
  }

  @Post("cases/:caseId/access")
  grantCaseAccess(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("caseId", ParseUUIDPipe) caseId: string,
    @Body() body: GrantSafeguardingCaseAccessDto,
  ) {
    return this.safeguardingService.grantCaseAccess(resolveSchoolId(user, schoolId), user.id, caseId, body);
  }

  @Delete("cases/:caseId/access/:userId")
  revokeCaseAccess(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("userId", ParseUUIDPipe) userId: string,
  ) {
    return this.safeguardingService.revokeCaseAccess(
      resolveSchoolId(user, schoolId),
      user.id,
      caseId,
      userId,
    );
  }
}
