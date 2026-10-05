import { Controller, Get, Query, UseGuards } from "@nestjs/common";
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
  async studentSummary(@CurrentUser() user: ErpCurrentUser) {
    const schoolId = user.schoolIds?.[0];
    if (!schoolId) {
      return null;
    }

    return this.erpService.getStudentSummary(user.id, schoolId);
  }

  @Get("parent/children")
  @UseGuards(AuthGuard)
  async parentChildren(@CurrentUser() user: ErpCurrentUser) {
    return this.erpService.listParentChildren(user.id);
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
    @Query("schoolId") _schoolId?: string,
  ) {
    return {
      school: user.schools.find((school) => school.id === _schoolId) ?? null,
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

    return this.erpService.listPupils(schoolId);
  }

  @Get("academic-structure")
  @UseGuards(AuthGuard)
  async getAcademicStructure(@CurrentUser() user: ErpCurrentUser) {
    const schoolId = user.schoolIds?.[0];
    if (!schoolId) {
      return { currentAcademicYear: null, yearGroups: [], forms: [], houses: [], subjects: [] };
    }

    return this.erpService.getAcademicStructure(schoolId);
  }
}
