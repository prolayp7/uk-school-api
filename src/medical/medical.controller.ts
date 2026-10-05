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
import {
  AddPupilMedicalConditionDto,
  CreateMedicalConditionDto,
  CreateHealthcarePlanDto,
  CreateMedicalIncidentDto,
  CreateMedicationAdministrationDto,
  CreateMedicationAuthorizationDto,
  CreateMedicationDto,
} from "../support/support.dto";
import { MedicalService } from "./medical.service";

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
export class MedicalController {
  constructor(private readonly medicalService: MedicalService) {}

  @Get("erp/pupils/:pupilId/medical")
  getPupilMedical(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("pupilId", ParseUUIDPipe) pupilId: string,
  ) {
    return this.medicalService.getPupilMedical(resolveSchoolId(user, schoolId), user.id, pupilId);
  }

  @Post("erp/medical/conditions")
  createCondition(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Body() body: CreateMedicalConditionDto,
  ) {
    return this.medicalService.createCondition(resolveSchoolId(user, schoolId), user.id, body);
  }

  @Post("erp/pupils/:pupilId/medical/conditions")
  addPupilCondition(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("pupilId", ParseUUIDPipe) pupilId: string,
    @Body() body: AddPupilMedicalConditionDto,
  ) {
    return this.medicalService.addPupilCondition(
      resolveSchoolId(user, schoolId),
      user.id,
      pupilId,
      body,
    );
  }

  @Post("erp/medical/medications")
  createMedication(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Body() body: CreateMedicationDto,
  ) {
    return this.medicalService.createMedication(resolveSchoolId(user, schoolId), user.id, body);
  }

  @Post("erp/pupils/:pupilId/medical/medication-authorizations")
  createMedicationAuthorization(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("pupilId", ParseUUIDPipe) pupilId: string,
    @Body() body: CreateMedicationAuthorizationDto,
  ) {
    return this.medicalService.createMedicationAuthorization(
      resolveSchoolId(user, schoolId),
      user.id,
      pupilId,
      body,
    );
  }

  @Post("erp/pupils/:pupilId/medical/medication-administrations")
  createMedicationAdministration(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("pupilId", ParseUUIDPipe) pupilId: string,
    @Body() body: CreateMedicationAdministrationDto,
  ) {
    return this.medicalService.createMedicationAdministration(
      resolveSchoolId(user, schoolId),
      user.id,
      pupilId,
      body,
    );
  }

  @Post("erp/pupils/:pupilId/medical/incidents")
  createIncident(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("pupilId", ParseUUIDPipe) pupilId: string,
    @Body() body: CreateMedicalIncidentDto,
  ) {
    return this.medicalService.createIncident(
      resolveSchoolId(user, schoolId),
      user.id,
      pupilId,
      body,
    );
  }

  @Get("erp/pupils/:pupilId/medical/healthcare-plans")
  getHealthcarePlans(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("pupilId", ParseUUIDPipe) pupilId: string,
  ) {
    return this.medicalService.getHealthcarePlans(resolveSchoolId(user, schoolId), user.id, pupilId);
  }

  @Post("erp/pupils/:pupilId/medical/healthcare-plans")
  createHealthcarePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("pupilId", ParseUUIDPipe) pupilId: string,
    @Body() body: CreateHealthcarePlanDto,
  ) {
    return this.medicalService.createHealthcarePlan(
      resolveSchoolId(user, schoolId),
      user.id,
      pupilId,
      body,
    );
  }
}

@Controller("parent/children")
@UseGuards(AuthGuard)
export class ParentMedicalController {
  constructor(private readonly medicalService: MedicalService) {}

  @Get(":pupilId/medical")
  getParentMedical(@CurrentUser() user: AuthenticatedUser, @Param("pupilId", ParseUUIDPipe) pupilId: string) {
    return this.medicalService.getParentMedical(user.id, pupilId);
  }
}
