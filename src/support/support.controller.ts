import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, SchoolAccessGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { CreateSendTargetReviewDto, CreateSupportPlanDto } from "./support.dto";
import { SupportService } from "./support.service";

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
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get("erp/pupils/:pupilId/send")
  getPupilSend(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("pupilId", ParseUUIDPipe) pupilId: string,
  ) {
    return this.supportService.getPupilSend(resolveSchoolId(user, schoolId), user.id, pupilId);
  }

  @Post("erp/pupils/:pupilId/send/plans")
  createPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("pupilId", ParseUUIDPipe) pupilId: string,
    @Body() body: CreateSupportPlanDto,
  ) {
    return this.supportService.createSupportPlan(
      resolveSchoolId(user, schoolId),
      user.id,
      pupilId,
      body,
    );
  }

  @Post("erp/send/plans/:planId/reviews")
  reviewTarget(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("planId", ParseUUIDPipe) planId: string,
    @Body() body: CreateSendTargetReviewDto,
  ) {
    return this.supportService.createPlanReview(resolveSchoolId(user, schoolId), user.id, planId, body);
  }
}

@Controller("parent/children")
@UseGuards(AuthGuard)
export class ParentSupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get(":pupilId/send")
  getParentSend(@CurrentUser() user: AuthenticatedUser, @Param("pupilId", ParseUUIDPipe) pupilId: string) {
    return this.supportService.getParentSend(user.id, pupilId);
  }
}
