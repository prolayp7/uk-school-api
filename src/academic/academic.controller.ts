import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, SchoolAccessGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import {
  AcademicQueryDto,
  CreateAssessmentDto,
  CreateCurriculumPlanDto,
  CreateExamCandidatesDto,
  CreateExamSeriesDto,
  CreateGradeScaleDto,
  CreatePupilTargetDto,
  CreateSchemeOfWorkDto,
  CreateTimetableSlotDto,
  UpsertAssessmentResultsDto,
  UpsertExamResultsDto,
} from "./academic.dto";
import { AcademicService } from "./academic.service";

type AuthenticatedUser = { id: string; schoolIds: string[] };

function resolveSchoolId(user: AuthenticatedUser, requestedSchoolId?: string): string {
  if (requestedSchoolId) return requestedSchoolId;
  if (user.schoolIds.length === 1) return user.schoolIds[0];
  if (user.schoolIds.length > 1) {
    throw new BadRequestException("Select a school with the x-school-id header.");
  }
  throw new BadRequestException("An active school membership is required.");
}

@Controller("erp")
@UseGuards(AuthGuard, SchoolAccessGuard)
export class AcademicController {
  constructor(private readonly academicService: AcademicService) {}

  @Get("classes")
  listClasses(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Query() query: AcademicQueryDto,
  ) {
    return this.academicService.listClasses(resolveSchoolId(user, schoolId), user.id, query.academicYearId);
  }

  @Get("curriculum/plans")
  listCurriculumPlans(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Query() query: AcademicQueryDto,
  ) {
    return this.academicService.listCurriculumPlans(resolveSchoolId(user, schoolId), user.id, query.academicYearId);
  }

  @Post("curriculum/plans")
  createCurriculumPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Body() body: CreateCurriculumPlanDto,
  ) {
    return this.academicService.createCurriculumPlan(resolveSchoolId(user, schoolId), user.id, body);
  }

  @Post("curriculum/plans/:planId/schemes")
  createScheme(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("planId", ParseUUIDPipe) planId: string,
    @Body() body: CreateSchemeOfWorkDto,
  ) {
    return this.academicService.createSchemeOfWork(resolveSchoolId(user, schoolId), user.id, planId, body);
  }

  @Post("timetable/slots")
  createTimetableSlot(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Body() body: CreateTimetableSlotDto,
  ) {
    return this.academicService.createTimetableSlot(resolveSchoolId(user, schoolId), user.id, body);
  }

  @Post("grade-scales")
  createGradeScale(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Body() body: CreateGradeScaleDto,
  ) {
    return this.academicService.createGradeScale(resolveSchoolId(user, schoolId), user.id, body);
  }

  @Post("assessments")
  createAssessment(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Body() body: CreateAssessmentDto,
  ) {
    return this.academicService.createAssessment(resolveSchoolId(user, schoolId), user.id, body);
  }

  @Put("assessments/:assessmentId/results")
  upsertAssessmentResults(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("assessmentId", ParseUUIDPipe) assessmentId: string,
    @Body() body: UpsertAssessmentResultsDto,
  ) {
    return this.academicService.upsertAssessmentResults(resolveSchoolId(user, schoolId), user.id, assessmentId, body);
  }

  @Get("pupils/:pupilId/assessment-results")
  getPupilAssessmentResults(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("pupilId", ParseUUIDPipe) pupilId: string,
  ) {
    return this.academicService.getPupilAssessmentResults(resolveSchoolId(user, schoolId), user.id, pupilId);
  }

  @Post("pupils/:pupilId/targets")
  createPupilTarget(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("pupilId", ParseUUIDPipe) pupilId: string,
    @Body() body: CreatePupilTargetDto,
  ) {
    return this.academicService.createPupilTarget(resolveSchoolId(user, schoolId), user.id, pupilId, body);
  }

  @Post("exam-series")
  createExamSeries(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Body() body: CreateExamSeriesDto,
  ) {
    return this.academicService.createExamSeries(resolveSchoolId(user, schoolId), user.id, body);
  }

  @Post("exam-series/:seriesId/candidates")
  addExamCandidates(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("seriesId", ParseUUIDPipe) seriesId: string,
    @Body() body: CreateExamCandidatesDto,
  ) {
    return this.academicService.addExamCandidates(resolveSchoolId(user, schoolId), user.id, seriesId, body);
  }

  @Put("exam-series/:seriesId/results")
  upsertExamResults(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("seriesId", ParseUUIDPipe) seriesId: string,
    @Body() body: UpsertExamResultsDto,
  ) {
    return this.academicService.upsertExamResults(resolveSchoolId(user, schoolId), user.id, seriesId, body);
  }

  @Get("exam-series/:seriesId/results")
  getExamResults(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("seriesId", ParseUUIDPipe) seriesId: string,
  ) {
    return this.academicService.getExamResults(resolveSchoolId(user, schoolId), user.id, seriesId);
  }
}
