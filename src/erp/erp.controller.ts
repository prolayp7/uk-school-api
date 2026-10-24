import {
  Body,
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Type } from "class-transformer";
import {
  IsDateString,
  IsArray,
  ArrayUnique,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from "class-validator";
import { AuthGuard, SchoolAccessGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { ErpService } from "./erp.service";

type ErpCurrentUser = {
  id: string;
  emailNormalized: string;
  roleCodes: string[];
  permissions: string[];
  schools: Array<{ id: string; code: string; name: string }>;
  schoolIds: string[];
};

class GrantMembershipRoleDto {
  @IsString()
  @Length(1, 64)
  roleCode!: string;
}

class UpdateRolePermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 120, { each: true })
  permissionCodes!: string[];
}

class UpdatePupilEnrolmentDto {
  @IsUUID()
  academicYearId!: string;

  @IsUUID()
  yearGroupId!: string;

  @IsUUID()
  formId!: string;

  @IsOptional()
  @IsUUID()
  houseId?: string | null;

  @IsDateString({ strict: true })
  startsOn!: string;
}

class ListPupilsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  search?: string;

  @IsOptional()
  @IsUUID()
  yearGroupId?: string;

  @IsOptional()
  @IsUUID()
  formId?: string;

  @IsOptional()
  @IsIn(["enrolled", "applicant", "withdrawn", "left"])
  status?: string;
}

class CreatePupilDto {
  @IsString()
  @Length(1, 100)
  legalFirstName!: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  preferredName?: string;

  @IsString()
  @Length(1, 100)
  lastName!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  @Length(1, 13)
  upn?: string;

  @IsString()
  @Length(1, 32)
  admissionNumber!: string;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  gender?: string;

  @IsDateString({ strict: true })
  admissionDate!: string;

  @IsUUID()
  academicYearId!: string;

  @IsUUID()
  yearGroupId!: string;

  @IsUUID()
  formId!: string;

  @IsOptional()
  @IsUUID()
  houseId?: string | null;

  @IsDateString({ strict: true })
  startsOn!: string;
}

class UpdatePupilDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  legalFirstName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  preferredName?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  lastName?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dateOfBirth?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 13)
  upn?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  admissionNumber?: string;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  gender?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  admissionDate?: string;

  @IsOptional()
  @IsIn(["enrolled", "applicant", "withdrawn", "left"])
  status?: string;
}

@Controller("erp")
export class ErpController {
  constructor(private readonly erpService: ErpService) {}

  @Get("student/summary")
  @UseGuards(AuthGuard)
  async studentSummary(
    @CurrentUser() user: ErpCurrentUser,
    @Headers("x-school-id") schoolId?: string,
  ) {
    return this.erpService.getStudentSummary(user.id, schoolId);
  }

  @Get("parent/children")
  @UseGuards(AuthGuard)
  async parentChildren(@CurrentUser() user: ErpCurrentUser) {
    return this.erpService.listParentChildren(user.id);
  }

  @Get("parent/children/:pupilId/homework")
  @UseGuards(AuthGuard)
  async parentHomework(@CurrentUser() user: ErpCurrentUser, @Param("pupilId") pupilId: string) {
    return this.erpService.getParentPupilHomework(user.id, pupilId);
  }

  @Get("parent/children/:pupilId/notices")
  @UseGuards(AuthGuard)
  async parentNotices(@CurrentUser() user: ErpCurrentUser, @Param("pupilId") pupilId: string) {
    return this.erpService.getParentPupilNotices(user.id, pupilId);
  }

  @Get("parent/children/:pupilId/messages")
  @UseGuards(AuthGuard)
  async parentMessages(@CurrentUser() user: ErpCurrentUser, @Param("pupilId") pupilId: string) {
    return this.erpService.getParentPupilMessages(user.id, pupilId);
  }

  @Get("parent/children/:pupilId/calendar")
  @UseGuards(AuthGuard)
  async parentSchoolEvents(@CurrentUser() user: ErpCurrentUser, @Param("pupilId") pupilId: string) {
    return this.erpService.getParentPupilSchoolEvents(user.id, pupilId);
  }

  @Get("parent/children/:pupilId/achievements")
  @UseGuards(AuthGuard)
  async parentAchievements(@CurrentUser() user: ErpCurrentUser, @Param("pupilId") pupilId: string) {
    return this.erpService.getParentPupilAchievements(user.id, pupilId);
  }

  @Get("parent/children/:pupilId/behaviour-summary")
  @UseGuards(AuthGuard)
  async parentBehaviourSummary(@CurrentUser() user: ErpCurrentUser, @Param("pupilId") pupilId: string) {
    return this.erpService.getParentPupilBehaviourSummary(user.id, pupilId);
  }

  @Get("parent/children/:pupilId/consents")
  @UseGuards(AuthGuard)
  async parentConsents(@CurrentUser() user: ErpCurrentUser, @Param("pupilId") pupilId: string) {
    return this.erpService.getParentPupilConsents(user.id, pupilId);
  }

  @Get("parent/children/:pupilId/forms")
  @UseGuards(AuthGuard)
  async parentForms(@CurrentUser() user: ErpCurrentUser, @Param("pupilId") pupilId: string) {
    return this.erpService.getParentPupilForms(user.id, pupilId);
  }

  @Get("parent/children/:pupilId/trips")
  @UseGuards(AuthGuard)
  async parentTrips(@CurrentUser() user: ErpCurrentUser, @Param("pupilId") pupilId: string) {
    return this.erpService.getParentPupilTrips(user.id, pupilId);
  }

  @Get("parent/children/:pupilId/contact-summary")
  @UseGuards(AuthGuard)
  async parentContactSummary(@CurrentUser() user: ErpCurrentUser, @Param("pupilId") pupilId: string) {
    return this.erpService.getParentPupilContactSummary(user.id, pupilId);
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: ErpCurrentUser) {
    return {
      id: user.id,
      email: user.emailNormalized,
      roles: user.roleCodes,
      permissions: user.permissions,
      schools: user.schools,
    };
  }

  @Get("schools")
  @UseGuards(AuthGuard)
  schools(@CurrentUser() user: ErpCurrentUser) {
    return {
      schools: user.schools,
      total: user.schools.length,
    };
  }

  @Post("schools/:schoolId/members/:membershipId/roles")
  @UseGuards(AuthGuard, SchoolAccessGuard)
  grantMembershipRole(
    @CurrentUser() user: ErpCurrentUser,
    @Param("schoolId") schoolId: string,
    @Param("membershipId") membershipId: string,
    @Body() body: GrantMembershipRoleDto,
  ) {
    return this.erpService.grantMembershipRole(
      schoolId,
      user.id,
      membershipId,
      body.roleCode,
    );
  }

  @Get("schools/:schoolId/members")
  @UseGuards(AuthGuard, SchoolAccessGuard)
  listSchoolMembers(
    @CurrentUser() user: ErpCurrentUser,
    @Param("schoolId") schoolId: string,
  ) {
    return this.erpService.listSchoolMembers(schoolId, user.id);
  }

  @Get("schools/:schoolId/roles/permissions")
  @UseGuards(AuthGuard, SchoolAccessGuard)
  listSchoolRolePermissions(
    @CurrentUser() user: ErpCurrentUser,
    @Param("schoolId") schoolId: string,
  ) {
    return this.erpService.listSchoolRolePermissions(schoolId, user.id);
  }

  @Put("schools/:schoolId/roles/:roleCode/permissions")
  @UseGuards(AuthGuard, SchoolAccessGuard)
  updateSchoolRolePermissions(
    @CurrentUser() user: ErpCurrentUser,
    @Param("schoolId") schoolId: string,
    @Param("roleCode") roleCode: string,
    @Body() body: UpdateRolePermissionsDto,
  ) {
    return this.erpService.updateSchoolRolePermissions(
      schoolId,
      user.id,
      roleCode,
      body.permissionCodes,
    );
  }

  @Get("schools/:schoolId")
  @UseGuards(AuthGuard, SchoolAccessGuard)
  schoolSummary(
    @CurrentUser() user: ErpCurrentUser,
    @Param("schoolId") schoolId: string,
  ) {
    return {
      school: user.schools.find((school) => school.id === schoolId) ?? null,
      roles: user.roleCodes,
      permissions: user.permissions,
    };
  }

  @Get("pupils")
  @UseGuards(AuthGuard)
  async listPupils(
    @CurrentUser() user: ErpCurrentUser,
    @Query() query: ListPupilsQueryDto,
    @Headers("x-school-id") requestedSchoolId?: string,
  ) {
    const schoolId = this.resolveSchoolId(user, requestedSchoolId);
    if (!schoolId) {
      return {
        total: 0,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: 0,
        items: [],
      };
    }

    return this.erpService.listPupils(schoolId, user.id, query);
  }

  @Post("pupils")
  @UseGuards(AuthGuard, SchoolAccessGuard)
  async createPupil(
    @CurrentUser() user: ErpCurrentUser,
    @Body() body: CreatePupilDto,
    @Headers("x-school-id") requestedSchoolId?: string,
  ) {
    const schoolId = this.resolveSchoolId(user, requestedSchoolId);
    if (!schoolId) throw new BadRequestException("An active school membership is required.");
    try {
      return await this.erpService.createPupil(schoolId, user.id, body);
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "P2002"
      ) {
        throw new ConflictException("The admission number or UPN is already in use at this school.");
      }
      throw error;
    }
  }

  @Get("pupils/:pupilId/contacts")
  @UseGuards(AuthGuard)
  pupilContacts(
    @CurrentUser() user: ErpCurrentUser,
    @Param("pupilId", ParseUUIDPipe) pupilId: string,
    @Headers("x-school-id") requestedSchoolId?: string,
  ) {
    const schoolId = this.resolveSchoolId(user, requestedSchoolId);
    if (!schoolId) throw new BadRequestException("An active school membership is required.");
    return this.erpService.getPupilContacts(schoolId, user.id, pupilId);
  }

  @Get("pupils/:pupilId")
  @UseGuards(AuthGuard)
  pupilDetails(
    @CurrentUser() user: ErpCurrentUser,
    @Param("pupilId", ParseUUIDPipe) pupilId: string,
    @Headers("x-school-id") requestedSchoolId?: string,
  ) {
    const schoolId = this.resolveSchoolId(user, requestedSchoolId);
    if (!schoolId) throw new BadRequestException("An active school membership is required.");
    return this.erpService.getPupil(schoolId, user.id, pupilId);
  }

  @Patch("pupils/:pupilId")
  @UseGuards(AuthGuard, SchoolAccessGuard)
  async updatePupil(
    @CurrentUser() user: ErpCurrentUser,
    @Param("pupilId", ParseUUIDPipe) pupilId: string,
    @Body() body: UpdatePupilDto,
    @Headers("x-school-id") requestedSchoolId?: string,
  ) {
    const schoolId = this.resolveSchoolId(user, requestedSchoolId);
    if (!schoolId) throw new BadRequestException("An active school membership is required.");
    try {
      return await this.erpService.updatePupil(schoolId, user.id, pupilId, body);
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "P2002"
      ) {
        throw new ConflictException("The admission number or UPN is already in use at this school.");
      }
      throw error;
    }
  }

  @Get("pupils/count")
  @UseGuards(AuthGuard)
  async pupilCount(
    @CurrentUser() user: ErpCurrentUser,
    @Headers("x-school-id") requestedSchoolId?: string,
  ) {
    const schoolId = this.resolveSchoolId(user, requestedSchoolId);
    if (!schoolId) {
      return { total: 0 };
    }

    return this.erpService.getPupilCount(schoolId, user.id);
  }

  @Put("pupils/:pupilId/enrolments/:enrolmentId")
  @UseGuards(AuthGuard, SchoolAccessGuard)
  updatePupilEnrolment(
    @CurrentUser() user: ErpCurrentUser,
    @Param("pupilId", ParseUUIDPipe) pupilId: string,
    @Param("enrolmentId", ParseUUIDPipe) enrolmentId: string,
    @Body() body: UpdatePupilEnrolmentDto,
    @Headers("x-school-id") requestedSchoolId?: string,
  ) {
    const schoolId = this.resolveSchoolId(user, requestedSchoolId);
    if (!schoolId) {
      throw new BadRequestException("An active school membership is required.");
    }
    return this.erpService.updatePupilEnrolment(
      schoolId,
      user.id,
      pupilId,
      enrolmentId,
      body,
    );
  }

  @Get("academic-structure")
  @UseGuards(AuthGuard)
  async getAcademicStructure(
    @CurrentUser() user: ErpCurrentUser,
    @Headers("x-school-id") requestedSchoolId?: string,
  ) {
    const schoolId = this.resolveSchoolId(user, requestedSchoolId);
    if (!schoolId) {
      return {
        currentAcademicYear: null,
        academicYears: [],
        terms: [],
        yearGroups: [],
        forms: [],
        houses: [],
        subjects: [],
      };
    }

    return this.erpService.getAcademicStructure(schoolId, user.id);
  }

  private resolveSchoolId(user: ErpCurrentUser, requestedSchoolId?: string): string | undefined {
    if (requestedSchoolId) {
      if (!user.schoolIds.includes(requestedSchoolId)) {
        throw new BadRequestException("The selected school is not available to this account.");
      }
      return requestedSchoolId;
    }
    if (user.schoolIds.length === 1) return user.schoolIds[0];
    if (user.schoolIds.length > 1) {
      throw new BadRequestException("Select a school with the x-school-id header.");
    }
    return undefined;
  }
}
