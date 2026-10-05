import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, SchoolAccessGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import {
  AttendanceReportQueryDto,
  AttendanceSessionsQueryDto,
  BulkAttendanceRecordsDto,
  CreateAttendanceInterventionDto,
  CreateAttendanceSessionDto,
} from "./attendance.dto";
import { AttendanceService } from "./attendance.service";

type AuthenticatedUser = { id: string; schoolIds: string[] };

function resolveSchoolId(user: AuthenticatedUser, requestedSchoolId?: string): string {
  if (requestedSchoolId) {
    return requestedSchoolId;
  }
  if (user.schoolIds?.length === 1) {
    return user.schoolIds[0];
  }
  if (user.schoolIds?.length > 1) {
    throw new BadRequestException("Select a school with the x-school-id header.");
  }
  throw new BadRequestException("An active school membership is required.");
}

@Controller()
@UseGuards(AuthGuard, SchoolAccessGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get("erp/attendance/codes")
  codes(@CurrentUser() user: AuthenticatedUser, @Headers("x-school-id") schoolId?: string) {
    return this.attendanceService.listCodes(resolveSchoolId(user, schoolId), user.id);
  }

  @Get("erp/attendance/class-groups")
  classGroups(@CurrentUser() user: AuthenticatedUser, @Headers("x-school-id") schoolId?: string) {
    return this.attendanceService.listClassGroups(resolveSchoolId(user, schoolId), user.id);
  }

  @Post("erp/attendance/sessions")
  createSession(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Body() body: CreateAttendanceSessionDto,
  ) {
    return this.attendanceService.createSession(resolveSchoolId(user, schoolId), user.id, body);
  }

  @Get("erp/attendance/sessions")
  listSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Query() query: AttendanceSessionsQueryDto,
  ) {
    return this.attendanceService.listSessions(resolveSchoolId(user, schoolId), user.id, query);
  }

  @Get("erp/attendance/sessions/:sessionId/register")
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("sessionId") sessionId: string,
  ) {
    return this.attendanceService.getSessionRegister(resolveSchoolId(user, schoolId), user.id, sessionId);
  }

  @Put("erp/attendance/sessions/:sessionId/records")
  upsertSessionRecords(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("sessionId") sessionId: string,
    @Body() body: BulkAttendanceRecordsDto,
  ) {
    return this.attendanceService.upsertSessionRecords(
      resolveSchoolId(user, schoolId),
      sessionId,
      user.id,
      body.records,
    );
  }

  @Get("erp/pupils/:pupilId/attendance")
  pupilAttendance(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("pupilId") pupilId: string,
  ) {
    return this.attendanceService.getPupilAttendance(resolveSchoolId(user, schoolId), user.id, pupilId);
  }

  @Post("erp/pupils/:pupilId/attendance/interventions")
  createIntervention(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("pupilId") pupilId: string,
    @Body() body: CreateAttendanceInterventionDto,
  ) {
    return this.attendanceService.createIntervention(
      resolveSchoolId(user, schoolId),
      pupilId,
      user.id,
      body,
    );
  }

  @Get("erp/reports/attendance")
  report(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Query() query: AttendanceReportQueryDto,
  ) {
    return this.attendanceService.getReport(resolveSchoolId(user, schoolId), user.id, query);
  }

  @Get("erp/attendance/teacher-summary")
  teacherSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Query() query: AttendanceReportQueryDto,
  ) {
    return this.attendanceService.getTeacherSummary(resolveSchoolId(user, schoolId), user.id, query);
  }
}

@Controller("parent/children")
@UseGuards(AuthGuard)
export class ParentAttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get(":pupilId/attendance")
  attendance(@CurrentUser() user: AuthenticatedUser, @Param("pupilId") pupilId: string) {
    return this.attendanceService.getParentPupilAttendance(user.id, pupilId);
  }
}

@Controller("student")
@UseGuards(AuthGuard)
export class StudentAttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get("attendance")
  attendance(@CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.getStudentAttendance(user.id);
  }
}
