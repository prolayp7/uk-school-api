import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { requireAnySchoolPermission } from "../auth/school-permissions";
import { PrismaService } from "../prisma/prisma.service";
import {
  AddPupilMedicalConditionDto,
  CreateMedicalConditionDto,
  CreateHealthcarePlanDto,
  CreateMedicalIncidentDto,
  CreateMedicationAdministrationDto,
  CreateMedicationAuthorizationDto,
  CreateMedicationDto,
  CreateMedicationScheduleDto,
} from "../support/support.dto";

function dateOnly(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function getSchoolDateTime(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const fields = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const weekdays: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const weekday = weekdays[fields.weekday ?? ""];
  if (!weekday) throw new BadRequestException("School timezone could not be resolved.");
  return {
    date: `${fields.year}-${fields.month}-${fields.day}`,
    weekday,
    time: `${fields.hour}:${fields.minute}`,
  };
}

function localDateTimeToUtc(date: string, time: string, timezone: string): Date {
  const target = Date.parse(`${date}T${time}:00.000Z`);
  let guess = target;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const actual = getSchoolDateTime(new Date(guess), timezone);
    const actualAsUtc = Date.parse(`${actual.date}T${actual.time}:00.000Z`);
    guess += target - actualAsUtc;
  }
  return new Date(guess);
}

function validateDateRange(startsOn: string, endsOn?: string): void {
  if (endsOn && dateOnly(endsOn) < dateOnly(startsOn)) {
    throw new BadRequestException("End date cannot precede start date.");
  }
}

@Injectable()
export class MedicalService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(schoolId: string, userId: string) {
    await this.requireMedicalRole(schoolId, userId);
    const now = new Date();
    const school = await this.prisma.school.findFirst({
      where: { id: schoolId },
      select: { timezone: true },
    });
    if (!school) throw new NotFoundException("School not found.");
    const localNow = getSchoolDateTime(now, school.timezone);
    const today = dateOnly(localNow.date);
    const todayText = localNow.date;
    const tomorrowText = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
    const startOfSchoolDay = localDateTimeToUtc(todayText, "00:00", school.timezone);
    const startOfNextSchoolDay = localDateTimeToUtc(tomorrowText, "00:00", school.timezone);
    const reviewCutoff = new Date(today.getTime() + 30 * 86400000);
    const pupils = await this.prisma.pupilProfile.findMany({
      where: { schoolId, status: "enrolled" },
      orderBy: [{ person: { lastName: "asc" } }, { person: { legalFirstName: "asc" } }],
      select: {
        id: true,
        admissionNumber: true,
        person: { select: { legalFirstName: true, preferredName: true, lastName: true } },
        enrolments: {
          where: { status: "active" },
          orderBy: { startsOn: "desc" },
          take: 1,
          select: { yearGroup: { select: { name: true } }, form: { select: { code: true } } },
        },
        medicalConditions: {
          where: {
            startsOn: { lte: today },
            OR: [{ endsOn: null }, { endsOn: { gte: today } }],
          },
          select: { severity: true, condition: { select: { code: true, name: true, category: true } } },
        },
        medicationAuthorizations: {
          where: {
            status: "active",
            startsOn: { lte: today },
            OR: [{ endsOn: null }, { endsOn: { gte: today } }],
          },
          select: {
            id: true,
            medication: { select: { name: true, strength: true, form: true } },
          },
        },
        healthcarePlans: {
          where: { status: "active" },
          select: { id: true, title: true, reviewDue: true },
        },
        medicalIncidents: {
          select: { id: true, incidentType: true, occurredAt: true, followUpRequired: true },
        },
      },
    });
    const [administrationsToday, recentAdministrations] = await Promise.all([
      this.prisma.medicationAdministration.count({
        where: { schoolId, administeredAt: { gte: startOfSchoolDay, lt: startOfNextSchoolDay } },
      }),
      this.prisma.medicationAdministration.findMany({
        where: { schoolId },
        orderBy: { administeredAt: "desc" },
        take: 20,
        select: {
          id: true,
          administeredAt: true,
          doseGiven: true,
          status: true,
          authorization: { select: { medication: { select: { name: true } } } },
          pupil: {
            select: {
              id: true,
              admissionNumber: true,
              person: { select: { legalFirstName: true, preferredName: true, lastName: true } },
            },
          },
          administeredBy: { select: { emailNormalized: true } },
        },
      }),
    ]);
    const schedules = await this.prisma.medicationSchedule.findMany({
      where: {
        schoolId,
        status: "active",
        startsOn: { lte: today },
        OR: [{ endsOn: null }, { endsOn: { gte: today } }],
        authorization: {
          is: {
            status: "active",
            startsOn: { lte: today },
            OR: [{ endsOn: null }, { endsOn: { gte: today } }],
          },
        },
      },
      orderBy: [{ scheduledTime: "asc" }, { pupil: { person: { lastName: "asc" } } }],
      select: {
        id: true,
        pupilId: true,
        authorizationId: true,
        daysOfWeek: true,
        scheduledTime: true,
        doseInstructions: true,
        authorization: {
          select: {
            status: true,
            startsOn: true,
            endsOn: true,
            medication: { select: { name: true } },
          },
        },
        pupil: {
          select: {
            id: true,
            admissionNumber: true,
            person: { select: { legalFirstName: true, preferredName: true, lastName: true } },
            enrolments: {
              where: { status: "active" },
              orderBy: { startsOn: "desc" },
              take: 1,
              select: { yearGroup: { select: { name: true } }, form: { select: { code: true } } },
            },
          },
        },
      },
    });
    const possibleScheduledAdministrations = await this.prisma.medicationAdministration.findMany({
      where: {
        schoolId,
        scheduleId: { not: null },
        administeredAt: {
          gte: startOfSchoolDay,
          lt: startOfNextSchoolDay,
        },
      },
      orderBy: { recordedAt: "desc" },
      select: { id: true, scheduleId: true, administeredAt: true, status: true },
    });
    const scheduledAdministrationsById = new Map<string, (typeof possibleScheduledAdministrations)[number]>();
    for (const administration of possibleScheduledAdministrations) {
      if (
        administration.scheduleId &&
        getSchoolDateTime(administration.administeredAt, school.timezone).date === todayText &&
        !scheduledAdministrationsById.has(administration.scheduleId)
      ) {
        scheduledAdministrationsById.set(administration.scheduleId, administration);
      }
    }
    const medicationQueue = schedules
      .filter((schedule) => schedule.daysOfWeek.includes(localNow.weekday))
      .map((schedule) => {
        const administration = scheduledAdministrationsById.get(schedule.id);
        const status = administration
          ? administration.status
          : schedule.scheduledTime < localNow.time
            ? "overdue"
            : "pending";
        return {
          id: schedule.id,
          pupilId: schedule.pupil.id,
          pupilName: [
            schedule.pupil.person.preferredName ?? schedule.pupil.person.legalFirstName,
            schedule.pupil.person.lastName,
          ].join(" "),
          admissionNumber: schedule.pupil.admissionNumber,
          yearGroup: schedule.pupil.enrolments[0]?.yearGroup.name ?? "Unplaced",
          form: schedule.pupil.enrolments[0]?.form.code ?? "",
          medication: schedule.authorization.medication.name,
          authorizationId: schedule.authorizationId,
          authorizationValid: true,
          doseInstructions: schedule.doseInstructions,
          scheduledTime: schedule.scheduledTime,
          status,
          administrationId: administration?.id ?? null,
        };
      });
    const reviewDueCount = pupils.reduce(
      (count, pupil) =>
        count +
        pupil.healthcarePlans.filter(
          (plan) => plan.reviewDue && plan.reviewDue <= reviewCutoff,
        ).length,
      0,
    );
    const followUpCount = pupils.reduce(
      (count, pupil) => count + pupil.medicalIncidents.filter((incident) => incident.followUpRequired).length,
      0,
    );
    const overview = {
      pupils: pupils.map((pupil) => ({
        id: pupil.id,
        name: [pupil.person.preferredName ?? pupil.person.legalFirstName, pupil.person.lastName].join(" "),
        admissionNumber: pupil.admissionNumber,
        yearGroup: pupil.enrolments[0]?.yearGroup.name ?? "Unplaced",
        form: pupil.enrolments[0]?.form.code ?? "",
        conditions: pupil.medicalConditions,
        authorizations: pupil.medicationAuthorizations,
        healthcarePlans: pupil.healthcarePlans,
        followUpIncidents: pupil.medicalIncidents.filter((incident) => incident.followUpRequired),
      })),
      metrics: {
        pupilsWithMedicalRecords: pupils.filter(
          (pupil) =>
            pupil.medicalConditions.length > 0 ||
            pupil.medicationAuthorizations.length > 0 ||
            pupil.healthcarePlans.length > 0 ||
            pupil.medicalIncidents.length > 0,
        ).length,
        activeAlerts: pupils.reduce((count, pupil) => count + pupil.medicalConditions.length, 0),
        activeAuthorizations: pupils.reduce((count, pupil) => count + pupil.medicationAuthorizations.length, 0),
        administrationsToday,
        medicationDueToday: medicationQueue.length,
        medicationGivenToday: medicationQueue.filter((item) => item.status === "administered").length,
        medicationPendingToday: medicationQueue.filter((item) => item.status === "pending").length,
        medicationOverdueToday: medicationQueue.filter((item) => item.status === "overdue").length,
        plansDueForReview: reviewDueCount,
        incidentsNeedingFollowUp: followUpCount,
      },
      medicationQueue,
      recentAdministrations: recentAdministrations.map((administration) => ({
        id: administration.id,
        pupilId: administration.pupil.id,
        pupilName: [
          administration.pupil.person.preferredName ?? administration.pupil.person.legalFirstName,
          administration.pupil.person.lastName,
        ].join(" "),
        admissionNumber: administration.pupil.admissionNumber,
        medication: administration.authorization.medication.name,
        administeredAt: administration.administeredAt,
        doseGiven: administration.doseGiven,
        status: administration.status,
        recordedBy: administration.administeredBy.emailNormalized,
      })),
    };
    await this.auditRead(schoolId, userId, null, "medical.overview.viewed", {
      pupilCount: overview.pupils.length,
      ...overview.metrics,
    });
    return overview;
  }

  async getConditionCatalog(schoolId: string, userId: string) {
    await this.requireMedicalRole(schoolId, userId);
    return this.prisma.medicalCondition.findMany({
      where: { schoolId },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: { id: true, code: true, name: true, category: true },
    });
  }

  async getMedicationCatalog(schoolId: string, userId: string) {
    await this.requireMedicalRole(schoolId, userId);
    return this.prisma.medication.findMany({
      where: { schoolId },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, strength: true, form: true },
    });
  }

  async getPupilMedical(schoolId: string, userId: string, pupilId: string) {
    await this.requireMedicalRole(schoolId, userId);
    await this.requirePupil(schoolId, pupilId);
    const [pupil, conditions, authorizations, administrations, schedules, healthcarePlans, incidents] = await Promise.all([
      this.prisma.pupilProfile.findFirst({
        where: { schoolId, id: pupilId },
        select: {
          id: true,
          admissionNumber: true,
          upn: true,
          person: {
            select: {
              legalFirstName: true,
              preferredName: true,
              lastName: true,
              dateOfBirth: true,
            },
          },
          enrolments: {
            where: { status: "active" },
            orderBy: { startsOn: "desc" },
            take: 1,
            select: {
              yearGroup: { select: { name: true } },
              form: {
                select: {
                  code: true,
                  tutor: {
                    select: {
                      person: {
                        select: {
                          legalFirstName: true,
                          preferredName: true,
                          lastName: true,
                        },
                      },
                    },
                  },
                },
              },
              house: { select: { name: true } },
            },
          },
          contacts: {
            where: {
              startsOn: { lte: dateOnly(new Date().toISOString()) },
              OR: [{ endsOn: null }, { endsOn: { gte: dateOnly(new Date().toISOString()) } }],
            },
            orderBy: { isPrimary: "desc" },
            select: {
              relationship: true,
              isPrimary: true,
              canCollect: true,
              hasParentalResponsibility: true,
              canViewPortal: true,
              guardianPersonId: true,
              guardian: {
                select: {
                  phone: true,
                  landline: true,
                  person: { select: { legalFirstName: true, preferredName: true, lastName: true } },
                },
              },
            },
          },
        },
      }),
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
          guardian: {
            select: {
              person: { select: { legalFirstName: true, preferredName: true, lastName: true } },
            },
          },
          medication: { select: { id: true, code: true, name: true, strength: true, form: true } },
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
          scheduleId: true,
          correctionReason: true,
          recordedAt: true,
          authorization: { select: { medication: { select: { name: true } } } },
          administeredBy: { select: { emailNormalized: true } },
        },
      }),
      this.prisma.medicationSchedule.findMany({
        where: { schoolId, pupilId },
        orderBy: [{ startsOn: "desc" }, { scheduledTime: "asc" }],
        select: {
          id: true,
          authorizationId: true,
          doseInstructions: true,
          scheduledTime: true,
          daysOfWeek: true,
          startsOn: true,
          endsOn: true,
          status: true,
          authorization: { select: { medication: { select: { name: true } } } },
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
    const auditEvents = await this.prisma.auditEvent.findMany({
      where: {
        schoolId,
        OR: [
          { entityType: "medical_record", entityId: pupilId },
          { entityType: "pupil_medical_condition", entityId: pupilId },
          ...["medication_authorization", "medication_schedule", "healthcare_plan", "medical_incident"].map((entityType) => ({
            entityType,
            metadata: { path: ["pupilId"], equals: pupilId },
          })),
        ],
      },
      orderBy: { occurredAt: "desc" },
      take: 8,
      select: {
        id: true,
        action: true,
        occurredAt: true,
        actor: { select: { emailNormalized: true } },
      },
    });
    return {
      pupil: pupil
        ? {
            id: pupil.id,
            name: [pupil.person.preferredName ?? pupil.person.legalFirstName, pupil.person.lastName].join(" "),
            dateOfBirth: pupil.person.dateOfBirth,
            upn: pupil.upn,
            admissionNumber: pupil.admissionNumber,
            yearGroup: pupil.enrolments[0]?.yearGroup.name ?? "Unplaced",
            form: pupil.enrolments[0]?.form.code ?? "",
            tutor: pupil.enrolments[0]?.form.tutor
              ? [
                  pupil.enrolments[0].form.tutor.person.preferredName ??
                    pupil.enrolments[0].form.tutor.person.legalFirstName,
                  pupil.enrolments[0].form.tutor.person.lastName,
                ].join(" ")
              : null,
            house: pupil.enrolments[0]?.house?.name ?? null,
            contacts: pupil.contacts.map((contact) => ({
              guardianPersonId: contact.guardianPersonId,
              name: [
                contact.guardian.person.preferredName ?? contact.guardian.person.legalFirstName,
                contact.guardian.person.lastName,
              ].join(" "),
              phone: contact.guardian.phone,
              landline: contact.guardian.landline,
              relationship: contact.relationship,
              isPrimary: contact.isPrimary,
              canCollect: contact.canCollect,
              hasParentalResponsibility: contact.hasParentalResponsibility,
              canViewPortal: contact.canViewPortal,
            })),
          }
        : null,
      conditions,
      authorizations,
      administrations,
      schedules,
      healthcarePlans,
      incidents,
      auditEvents: auditEvents.map((event) => ({
        id: event.id,
        action: event.action,
        occurredAt: event.occurredAt,
        actorEmail: event.actor?.emailNormalized ?? null,
      })),
    };
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

  async createMedicationSchedule(
    schoolId: string,
    userId: string,
    pupilId: string,
    input: CreateMedicationScheduleDto,
  ) {
    await this.requireMedicalRole(schoolId, userId);
    await this.requirePupil(schoolId, pupilId);
    validateDateRange(input.startsOn, input.endsOn);
    if (new Set(input.daysOfWeek).size !== input.daysOfWeek.length) {
      throw new BadRequestException("Each weekday can only be selected once.");
    }
    const authorization = await this.prisma.medicationAuthorization.findFirst({
      where: {
        schoolId,
        id: input.authorizationId,
        pupilId,
        status: "active",
        startsOn: { lte: dateOnly(input.startsOn) },
        OR: [{ endsOn: null }, { endsOn: { gte: dateOnly(input.startsOn) } }],
      },
      select: { id: true, startsOn: true, endsOn: true },
    });
    if (!authorization) {
      throw new BadRequestException("A current medication authorization for this pupil is required.");
    }
    if (authorization.endsOn && (!input.endsOn || authorization.endsOn < dateOnly(input.endsOn))) {
      throw new BadRequestException("The schedule dates must be within the medication authorization dates.");
    }

    return this.prisma.$transaction(async (transaction) => {
      const schedule = await transaction.medicationSchedule.create({
        data: {
          schoolId,
          pupilId,
          authorizationId: authorization.id,
          scheduledTime: input.scheduledTime,
          daysOfWeek: input.daysOfWeek,
          doseInstructions: input.doseInstructions.trim(),
          startsOn: dateOnly(input.startsOn),
          endsOn: input.endsOn ? dateOnly(input.endsOn) : null,
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "medical.medication.schedule.created",
          entityType: "medication_schedule",
          entityId: schedule.id,
          metadata: { pupilId, authorizationId: authorization.id, daysOfWeek: input.daysOfWeek },
        },
      });
      return schedule;
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
    const school = await this.prisma.school.findFirst({
      where: { id: schoolId },
      select: { timezone: true },
    });
    if (!school) throw new NotFoundException("School not found.");
    const localAdministration = getSchoolDateTime(administeredAt, school.timezone);
    const administeredDate = dateOnly(localAdministration.date);
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
    let scheduleId: string | undefined;
    if (input.scheduleId) {
      const schedule = await this.prisma.medicationSchedule.findFirst({
        where: {
          schoolId,
          id: input.scheduleId,
          pupilId,
          authorizationId: authorization.id,
          status: "active",
        },
        select: { id: true, startsOn: true, endsOn: true, daysOfWeek: true },
      });
      if (
        !schedule ||
        schedule.startsOn > administeredDate ||
        (schedule.endsOn && schedule.endsOn < administeredDate) ||
        !schedule.daysOfWeek.includes(localAdministration.weekday)
      ) {
        throw new BadRequestException("The scheduled dose must belong to this pupil's active authorization and scheduled date.");
      }
      scheduleId = schedule.id;
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
          scheduleId,
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
          scheduleId,
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
            scheduleId: scheduleId ?? null,
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
          emergencyLocation: input.emergencyLocation?.trim() || null,
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
          condition: { select: { code: true, name: true, category: true } },
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
    try {
      await requireAnySchoolPermission(
        this.prisma,
        schoolId,
        userId,
        ["medical.manage"],
        "Medical staff authorization is required.",
      );
    } catch (error) {
      if (!(error instanceof ForbiddenException)) throw error;
      await this.auditRead(schoolId, userId, null, "medical.access_denied", {});
      throw error;
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
