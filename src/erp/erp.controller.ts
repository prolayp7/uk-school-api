import { Controller, Get, Headers, Param, UseGuards } from "@nestjs/common";
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
  async listPupils(@CurrentUser() user: ErpCurrentUser) {
    const schoolId = user.schoolIds?.[0];
    if (!schoolId) {
      return { total: 0, items: [] };
    }

    return this.erpService.listPupils(schoolId, user.id);
  }

  @Get("pupils/count")
  @UseGuards(AuthGuard)
  async pupilCount(@CurrentUser() user: ErpCurrentUser) {
    const schoolId = user.schoolIds?.[0];
    if (!schoolId) {
      return { total: 0 };
    }

    return this.erpService.getPupilCount(schoolId, user.id);
  }

  @Get("academic-structure")
  @UseGuards(AuthGuard)
  async getAcademicStructure(@CurrentUser() user: ErpCurrentUser) {
    const schoolId = user.schoolIds?.[0];
    if (!schoolId) {
      return { currentAcademicYear: null, yearGroups: [], forms: [], houses: [], subjects: [] };
    }

    return this.erpService.getAcademicStructure(schoolId, user.id);
  }
}
