import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  AddPupilMedicalConditionDto,
  CreateMedicalConditionDto,
  CreateHealthcarePlanDto,
  CreateMedicalIncidentDto,
  CreateMedicationAdministrationDto,
  CreateMedicationAuthorizationDto,
  CreateMedicationDto,
} from "../support/support.dto";

const MEDICAL_ROLE_CODES = ["MEDICAL", "HEADTEACHER"];

function dateOnly(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function validateDateRange(startsOn: string, endsOn?: string): void {
  if (endsOn && dateOnly(endsOn) < dateOnly(startsOn)) {
    throw new BadRequestException("End date cannot precede start date.");
  }
}

@Injectable()
export class MedicalService {
  constructor(private readonly prisma: PrismaService) {}

  async getPupilMedical(schoolId: string, userId: string, pupilId: string) {
    await this.requireMedicalRole(schoolId, userId);
    await this.requirePupil(schoolId, pupilId);
    const [conditions, authorizations, administrations, healthcarePlans, incidents] = await Promise.all([
      this.prisma.pupilMedicalCondition.findMany({
        where: {
          schoolId,
          pupilId,
          startsOn: { lte: dateOnly(new Date().toISOString()) },
          OR: [{ endsOn: null }, { endsOn: { gte: dateOnly(new Date().toISOString()) } }],
        },
        orderBy: { startsOn: "desc" },
        select: {
          severity: true,
          careNote: true,
          startsOn: true,
          endsOn: true,
          parentVisible: true,
          condition: { select: { code: true, name: true, category: true } },
        },
      }),
      this.prisma.medicationAuthorization.findMany({
        where: { schoolId, pupilId },
        orderBy: { startsOn: "desc" },
        select: {
          id: true,
          dosageInstructions: true,
          startsOn: true,
          endsOn: true,
          status: true,
          guardianPersonId: true,
          medication: { select: { code: true, name: true, strength: true, form: true } },
        },
      }),
      this.prisma.medicationAdministration.findMany({
        where: { schoolId, pupilId },
        orderBy: { administeredAt: "desc" },
        select: {
          id: true,
          authorizationId: true,
          administeredAt: true,
          doseGiven: true,
          status: true,
          note: true,
          correctionOfId: true,
          correctionReason: true,
          recordedAt: true,
        },
      }),
      this.prisma.healthcarePlan.findMany({
        where: { schoolId, pupilId },
        orderBy: { startsOn: "desc" },
      }),
      this.prisma.medicalIncident.findMany({
        where: { schoolId, pupilId },
        orderBy: { occurredAt: "desc" },
      }),
    ]);
    await this.auditRead(schoolId, userId, pupilId, "medical.profile.viewed", {
      conditionCount: conditions.length,
      authorizationCount: authorizations.length,
      administrationCount: administrations.length,
      incidentCount: incidents.length,
      healthcarePlanCount: healthcarePlans.length,
    });
    return { conditions, authorizations, administrations, healthcarePlans, incidents };
  }

  async createMedication(schoolId: string, userId: string, input: CreateMedicationDto) {
    await this.requireMedicalRole(schoolId, userId);
    const medication = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.medication.create({
        data: {
          schoolId,
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          strength: input.strength?.trim(),
          form: input.form?.trim(),
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "medical.medication.created",
          entityType: "medication",
          entityId: created.id,
          metadata: { code: created.code },
        },
      });
      return created;
    });
    return medication;
  }

  async createCondition(schoolId: string, userId: string, input: CreateMedicalConditionDto) {
    await this.requireMedicalRole(schoolId, userId);
    return this.prisma.$transaction(async (transaction) => {
      const condition = await transaction.medicalCondition.create({
        data: {
          schoolId,
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          category: input.category.trim().toLowerCase(),
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "medical.condition.created",
          entityType: "medical_condition",
          entityId: condition.id,
          metadata: { code: condition.code, category: condition.category },
        },
      });
      return condition;
    });
  }

  async addPupilCondition(
    schoolId: string,
    userId: string,
    pupilId: string,
    input: AddPupilMedicalConditionDto,
  ) {
    await this.requireMedicalRole(schoolId, userId);
    await this.requirePupil(schoolId, pupilId);
    validateDateRange(input.startsOn, input.endsOn);
    const condition = await this.prisma.medicalCondition.findFirst({
      where: { schoolId, id: input.conditionId },
      select: { id: true },
    });
    if (!condition) throw new NotFoundException("Medical condition not found.");

    return this.prisma.$transaction(async (transaction) => {
      const record = await transaction.pupilMedicalCondition.upsert({
        where: {
          schoolId_pupilId_medicalConditionId: {
            schoolId,
            pupilId,
            medicalConditionId: input.conditionId,
          },
        },
        create: {
          schoolId,
          pupilId,
          medicalConditionId: input.conditionId,
          severity: input.severity,
          careNote: input.careNote.trim(),
          startsOn: dateOnly(input.startsOn),
          endsOn: input.endsOn ? dateOnly(input.endsOn) : null,
          parentVisible: input.parentVisible ?? false,
        },
        update: {
          severity: input.severity,
          careNote: input.careNote.trim(),
          startsOn: dateOnly(input.startsOn),
          endsOn: input.endsOn ? dateOnly(input.endsOn) : null,
          parentVisible: input.parentVisible ?? false,
        },
        select: { severity: true, startsOn: true, endsOn: true, parentVisible: true },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "medical.pupil_condition.recorded",
          entityType: "pupil_medical_condition",
          entityId: pupilId,
          metadata: { pupilId, conditionId: input.conditionId, severity: input.severity },
        },
      });
      return record;
    });
  }

  async createMedicationAuthorization(
    schoolId: string,
    userId: string,
    pupilId: string,
    input: CreateMedicationAuthorizationDto,
  ) {
    await this.requireMedicalRole(schoolId, userId);
    await this.requirePupil(schoolId, pupilId);
    validateDateRange(input.startsOn, input.endsOn);
    const today = dateOnly(new Date().toISOString());
    const guardianLink = await this.prisma.pupilContact.findFirst({
      where: {
        schoolId,
        pupilId,
        guardianPersonId: input.guardianPersonId,
        hasParentalResponsibility: true,
        canViewPortal: true,
        startsOn: { lte: today },
        OR: [{ endsOn: null }, { endsOn: { gte: today } }],
      },
      select: { guardianPersonId: true },
    });
    if (!guardianLink) {
      throw new BadRequestException("Medication authorization requires an active contact with parental responsibility.");
    }
    const medication = await this.prisma.medication.findFirst({
      where: { schoolId, id: input.medicationId },
      select: { id: true },
    });
    if (!medication) {
      throw new NotFoundException("Medication not found.");
    }

    return this.prisma.$transaction(async (transaction) => {
      const authorization = await transaction.medicationAuthorization.create({
        data: {
          schoolId,
          pupilId,
          medicationId: medication.id,
          guardianPersonId: guardianLink.guardianPersonId,
          authorizedByUserId: userId,
          dosageInstructions: input.dosageInstructions.trim(),
          startsOn: dateOnly(input.startsOn),
          endsOn: input.endsOn ? dateOnly(input.endsOn) : null,
        },
        select: { id: true, medicationId: true, pupilId: true, startsOn: true, endsOn: true, status: true },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "medical.medication.authorization.created",
          entityType: "medication_authorization",
          entityId: authorization.id,
          metadata: { pupilId, medicationId: medication.id, guardianPersonId: guardianLink.guardianPersonId },
        },
      });
      return authorization;
    });
  }

  async createMedicationAdministration(
    schoolId: string,
    userId: string,
    pupilId: string,
    input: CreateMedicationAdministrationDto,
  ) {
    await this.requireMedicalRole(schoolId, userId);
    const administeredAt = new Date(input.administeredAt);
    const administeredDate = dateOnly(input.administeredAt);
    const authorization = await this.prisma.medicationAuthorization.findFirst({
      where: {
        schoolId,
        id: input.authorizationId,
        pupilId,
        status: "active",
        startsOn: { lte: administeredDate },
        OR: [{ endsOn: null }, { endsOn: { gte: administeredDate } }],
      },
      select: { id: true, pupilId: true },
    });
    if (!authorization) {
      throw new BadRequestException("A current medication authorization for this pupil is required.");
    }
    if (Boolean(input.correctionOfId) !== Boolean(input.correctionReason?.trim())) {
      throw new BadRequestException("Corrections require both the original administration ID and a correction reason.");
    }
    if (input.correctionOfId) {
      const original = await this.prisma.medicationAdministration.findFirst({
        where: {
          schoolId,
          id: input.correctionOfId,
          pupilId,
          authorizationId: authorization.id,
        },
        select: { id: true },
      });
      if (!original) {
        throw new BadRequestException("The corrected record must be an administration for this pupil and authorization.");
      }
    }

    return this.prisma.$transaction(async (transaction) => {
      const administration = await transaction.medicationAdministration.create({
        data: {
          schoolId,
          pupilId,
          authorizationId: authorization.id,
          administeredByUserId: userId,
          administeredAt,
          doseGiven: input.doseGiven.trim(),
          status: input.status,
          note: input.note?.trim(),
          correctionOfId: input.correctionOfId,
          correctionReason: input.correctionReason?.trim(),
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: input.correctionOfId
            ? "medical.medication.administration.corrected"
            : "medical.medication.administration.recorded",
          entityType: "medication_administration",
          entityId: administration.id,
          metadata: {
            pupilId,
            authorizationId: authorization.id,
            status: input.status,
            correctionOfId: input.correctionOfId ?? null,
          },
        },
      });
      return administration;
    });
  }

  async createHealthcarePlan(
    schoolId: string,
    userId: string,
    pupilId: string,
    input: CreateHealthcarePlanDto,
  ) {
    await this.requireMedicalRole(schoolId, userId);
    await this.requirePupil(schoolId, pupilId);
    return this.prisma.$transaction(async (transaction) => {
      const plan = await transaction.healthcarePlan.create({
        data: {
          schoolId,
          pupilId,
          title: input.title.trim(),
          instructions: input.instructions.trim(),
          emergencyActions: input.emergencyActions.trim(),
          startsOn: dateOnly(input.startsOn),
          reviewDue: input.reviewDue ? dateOnly(input.reviewDue) : null,
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "medical.healthcare_plan.created",
          entityType: "healthcare_plan",
          entityId: plan.id,
          metadata: { pupilId },
        },
      });
      return plan;
    });
  }

  async getHealthcarePlans(schoolId: string, userId: string, pupilId: string) {
    await this.requireMedicalRole(schoolId, userId);
    await this.requirePupil(schoolId, pupilId);
    const plans = await this.prisma.healthcarePlan.findMany({
      where: { schoolId, pupilId },
      orderBy: { startsOn: "desc" },
    });
    await this.auditRead(schoolId, userId, pupilId, "medical.healthcare_plans.viewed", { count: plans.length });
    return plans;
  }

  async createIncident(
    schoolId: string,
    userId: string,
    pupilId: string,
    input: CreateMedicalIncidentDto,
  ) {
    await this.requireMedicalRole(schoolId, userId);
    await this.requirePupil(schoolId, pupilId);
    return this.prisma.$transaction(async (transaction) => {
      const incident = await transaction.medicalIncident.create({
        data: {
          schoolId,
          pupilId,
          incidentType: input.incidentType.trim(),
          details: input.details.trim(),
          actionTaken: input.actionTaken.trim(),
          followUpRequired: input.followUpRequired ?? false,
          occurredAt: new Date(input.occurredAt),
          reportedByUserId: userId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "medical.incident.created",
          entityType: "medical_incident",
          entityId: incident.id,
          metadata: { pupilId, incidentType: input.incidentType, followUpRequired: incident.followUpRequired },
        },
      });
      return incident;
    });
  }

  async getParentMedical(userId: string, pupilId: string) {
    const contact = await this.findParentLink(userId, pupilId);
    if (!contact) {
      throw new ForbiddenException("You do not have portal access to this pupil's medical summary.");
    }
    const today = dateOnly(new Date().toISOString());
    const [conditions, medications] = await Promise.all([
      this.prisma.pupilMedicalCondition.findMany({
        where: {
          schoolId: contact.schoolId,
          pupilId,
          parentVisible: true,
          startsOn: { lte: today },
          OR: [{ endsOn: null }, { endsOn: { gte: today } }],
        },
        select: {
          startsOn: true,
          endsOn: true,
          condition: { select: { name: true, category: true } },
        },
      }),
      this.prisma.medicationAuthorization.findMany({
        where: {
          schoolId: contact.schoolId,
          pupilId,
          guardianPersonId: contact.guardianPersonId,
          status: "active",
          startsOn: { lte: today },
          OR: [{ endsOn: null }, { endsOn: { gte: today } }],
        },
        select: {
          startsOn: true,
          endsOn: true,
          medication: { select: { name: true, strength: true, form: true } },
        },
      }),
    ]);
    await this.auditRead(contact.schoolId, userId, pupilId, "medical.parent_summary.viewed", {
      conditionCount: conditions.length,
      medicationCount: medications.length,
    });
    return { conditions, medications };
  }

  private async requireMedicalRole(schoolId: string, userId: string): Promise<void> {
    const membership = await this.prisma.schoolMembership.findFirst({
      where: {
        schoolId,
        userId,
        status: "active",
        membershipRoles: { some: { role: { code: { in: MEDICAL_ROLE_CODES } } } },
      },
      select: { id: true },
    });
    if (!membership) {
      await this.auditRead(schoolId, userId, null, "medical.access_denied", {});
      throw new ForbiddenException("Medical staff authorization is required.");
    }
  }

  private async requirePupil(schoolId: string, pupilId: string): Promise<void> {
    const pupil = await this.prisma.pupilProfile.findFirst({
      where: { schoolId, id: pupilId },
      select: { id: true },
    });
    if (!pupil) throw new NotFoundException("Pupil not found.");
  }

  private findParentLink(userId: string, pupilId: string) {
    const today = dateOnly(new Date().toISOString());
    return this.prisma.pupilContact.findFirst({
      where: {
        pupilId,
        canViewPortal: true,
        hasParentalResponsibility: true,
        startsOn: { lte: today },
        OR: [{ endsOn: null }, { endsOn: { gte: today } }],
        guardian: { person: { userId } },
      },
      select: { schoolId: true, guardianPersonId: true },
    });
  }

  private auditRead(
    schoolId: string,
    userId: string,
    pupilId: string | null,
    action: string,
    metadata: object,
  ) {
    return this.prisma.auditEvent.create({
      data: {
        schoolId,
        actorUserId: userId,
        action,
        entityType: "medical_record",
        entityId: pupilId,
        metadata,
      },
    });
  }
}
