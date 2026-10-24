import "reflect-metadata";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { schoolMembershipRole } from "../auth/school-permissions.test-utils";
import { AuthGuard, SchoolAccessGuard } from "../auth/auth.guard";
import type { PrismaService } from "../prisma/prisma.service";
import { MedicalController, ParentMedicalController } from "./medical.controller";
import { MedicalService } from "./medical.service";

describe("MedicalService", () => {
  it("protects staff medical routes and requires authentication for parent summaries", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, MedicalController))
      .toEqual([AuthGuard, SchoolAccessGuard]);
    expect(Reflect.getMetadata(GUARDS_METADATA, ParentMedicalController))
      .toEqual([AuthGuard]);
  });

  it("calculates due medication occurrences using the school's local date and time", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-30T12:00:00.000Z"));
    const service = new MedicalService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({
        membershipRoles: [schoolMembershipRole("MEDICAL")],
      }) },
      school: { findFirst: jest.fn().mockResolvedValue({ timezone: "Europe/London" }) },
      pupilProfile: { findMany: jest.fn().mockResolvedValue([]) },
      medicationAdministration: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([]),
      },
      medicationSchedule: {
        findMany: jest.fn().mockResolvedValue([{
          id: "schedule-1",
          pupilId: "pupil-1",
          authorizationId: "authorization-1",
          daysOfWeek: [3],
          scheduledTime: "08:00",
          doseInstructions: "One tablet",
          authorization: {
            status: "active",
            startsOn: new Date("2026-09-01T00:00:00.000Z"),
            endsOn: null,
            medication: { name: "Medication" },
          },
          pupil: {
            id: "pupil-1",
            admissionNumber: "P001",
            person: { legalFirstName: "Sam", preferredName: null, lastName: "Turner" },
            enrolments: [{ yearGroup: { name: "Year 6" }, form: { code: "6A" } }],
          },
        }]),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService);

    try {
      const overview = await service.getOverview("school-1", "nurse-1");

      expect(overview.metrics).toMatchObject({
        medicationDueToday: 1,
        medicationGivenToday: 0,
        medicationPendingToday: 0,
        medicationOverdueToday: 1,
      });
      expect(overview.medicationQueue[0]).toMatchObject({
        pupilId: "pupil-1",
        scheduledTime: "08:00",
        status: "overdue",
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("denies non-medical roles before querying pupil clinical data", async () => {
    const auditCreate = jest.fn().mockResolvedValue({});
    const conditionFindMany = jest.fn();
    const service = new MedicalService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue(null) },
      auditEvent: { create: auditCreate },
      pupilMedicalCondition: { findMany: conditionFindMany },
    } as unknown as PrismaService);

    await expect(service.getPupilMedical("school-1", "teacher-1", "pupil-1"))
      .rejects.toBeInstanceOf(ForbiddenException);

    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "medical.access_denied" }),
    }));
    expect(conditionFindMany).not.toHaveBeenCalled();
  });

  it("returns pupil-scoped medical audit events without exposing event metadata", async () => {
    const pupilId = "11111111-1111-4111-8111-111111111111";
    const auditEvent = {
      id: "22222222-2222-4222-8222-222222222222",
      action: "medical.profile.viewed",
      occurredAt: new Date("2026-10-11T08:30:00.000Z"),
      actor: { emailNormalized: "nurse@example.test" },
    };
    const auditFindMany = jest.fn().mockResolvedValue([auditEvent]);
    const service = new MedicalService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({
        membershipRoles: [schoolMembershipRole("MEDICAL")],
      }) },
      pupilProfile: { findFirst: jest.fn().mockResolvedValue({
        id: pupilId,
        admissionNumber: "P001",
        upn: "123456789012",
        person: {
          legalFirstName: "Aisha",
          preferredName: null,
          lastName: "Khan",
          dateOfBirth: new Date("2014-02-01T00:00:00.000Z"),
        },
        enrolments: [],
        contacts: [],
      }) },
      pupilMedicalCondition: { findMany: jest.fn().mockResolvedValue([]) },
      medicationAuthorization: { findMany: jest.fn().mockResolvedValue([]) },
      medicationAdministration: { findMany: jest.fn().mockResolvedValue([]) },
      medicationSchedule: { findMany: jest.fn().mockResolvedValue([]) },
      healthcarePlan: { findMany: jest.fn().mockResolvedValue([]) },
      medicalIncident: { findMany: jest.fn().mockResolvedValue([]) },
      auditEvent: {
        create: jest.fn().mockResolvedValue({}),
        findMany: auditFindMany,
      },
    } as unknown as PrismaService);

    const record = await service.getPupilMedical("school-1", "nurse-1", pupilId);

    expect(auditFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        schoolId: "school-1",
        OR: expect.arrayContaining([
          { entityType: "medical_record", entityId: pupilId },
          expect.objectContaining({
            entityType: "healthcare_plan",
            metadata: { path: ["pupilId"], equals: pupilId },
          }),
        ]),
      }),
      take: 8,
    }));
    expect(record.auditEvents).toEqual([{
      id: auditEvent.id,
      action: auditEvent.action,
      occurredAt: auditEvent.occurredAt,
      actorEmail: "nurse@example.test",
    }]);
    expect(record.auditEvents[0]).not.toHaveProperty("metadata");
  });

  it("requires an active medication authorization before recording administration", async () => {
    const transaction = { medicationAdministration: { create: jest.fn() } };
    const service = new MedicalService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({
        membershipRoles: [schoolMembershipRole("MEDICAL")],
      }) },
      school: { findFirst: jest.fn().mockResolvedValue({ timezone: "Europe/London" }) },
      medicationAuthorization: { findFirst: jest.fn().mockResolvedValue(null) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaService);

    await expect(service.createMedicationAdministration("school-1", "nurse-1", "pupil-1", {
      authorizationId: "authorization-1",
      administeredAt: "2026-09-30T09:00:00.000Z",
      doseGiven: "5ml",
      status: "administered",
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(transaction.medicationAdministration.create).not.toHaveBeenCalled();
  });

  it("creates a medication schedule only for a current authorization belonging to the pupil", async () => {
    const schedule = { id: "schedule-1" };
    const create = jest.fn().mockResolvedValue(schedule);
    const auditCreate = jest.fn().mockResolvedValue({});
    const transaction = {
      medicationSchedule: { create },
      auditEvent: { create: auditCreate },
    };
    const service = new MedicalService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({
        membershipRoles: [schoolMembershipRole("MEDICAL")],
      }) },
      pupilProfile: { findFirst: jest.fn().mockResolvedValue({ id: "pupil-1" }) },
      medicationAuthorization: { findFirst: jest.fn().mockResolvedValue({
        id: "authorization-1",
        startsOn: new Date("2026-09-01T00:00:00.000Z"),
        endsOn: new Date("2026-12-31T00:00:00.000Z"),
      }) },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaService);

    const result = await service.createMedicationSchedule("school-1", "nurse-1", "pupil-1", {
      authorizationId: "authorization-1",
      scheduledTime: "08:30",
      daysOfWeek: [1, 3, 5],
      doseInstructions: "One tablet",
      startsOn: "2026-09-01",
      endsOn: "2026-12-31",
    });

    expect(result).toBe(schedule);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        schoolId: "school-1",
        pupilId: "pupil-1",
        authorizationId: "authorization-1",
        daysOfWeek: [1, 3, 5],
      }),
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "medical.medication.schedule.created" }),
    }));
  });

  it("stores the healthcare plan emergency location with the plan", async () => {
    const create = jest.fn().mockResolvedValue({ id: "plan-1" });
    const transaction = {
      healthcarePlan: { create },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new MedicalService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({
        membershipRoles: [schoolMembershipRole("MEDICAL")],
      }) },
      pupilProfile: { findFirst: jest.fn().mockResolvedValue({ id: "pupil-1" }) },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaService);

    await service.createHealthcarePlan("school-1", "nurse-1", "pupil-1", {
      title: "Asthma plan",
      instructions: "Keep the inhaler accessible.",
      emergencyActions: "Follow the emergency procedure.",
      emergencyLocation: "Room Locker A + 10B PE Kit",
      startsOn: "2026-09-01",
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        emergencyLocation: "Room Locker A + 10B PE Kit",
      }),
    }));
  });

  it("rejects duplicate weekdays in a medication schedule", async () => {
    const service = new MedicalService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({
        membershipRoles: [schoolMembershipRole("MEDICAL")],
      }) },
      pupilProfile: { findFirst: jest.fn().mockResolvedValue({ id: "pupil-1" }) },
    } as unknown as PrismaService);

    await expect(service.createMedicationSchedule("school-1", "nurse-1", "pupil-1", {
      authorizationId: "authorization-1",
      scheduledTime: "08:30",
      daysOfWeek: [1, 1],
      doseInstructions: "One tablet",
      startsOn: "2026-09-01",
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("links a scheduled administration only to its pupil's active scheduled authorization", async () => {
    const create = jest.fn().mockResolvedValue({ id: "administration-1" });
    const transaction = {
      medicationAdministration: { create },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new MedicalService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({
        membershipRoles: [schoolMembershipRole("MEDICAL")],
      }) },
      medicationAuthorization: { findFirst: jest.fn().mockResolvedValue({ id: "authorization-1", pupilId: "pupil-1" }) },
      medicationSchedule: { findFirst: jest.fn().mockResolvedValue({
        id: "schedule-1",
        startsOn: new Date("2026-09-01T00:00:00.000Z"),
        endsOn: null,
        daysOfWeek: [3],
      }) },
      school: { findFirst: jest.fn().mockResolvedValue({ timezone: "Europe/London" }) },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaService);

    await service.createMedicationAdministration("school-1", "nurse-1", "pupil-1", {
      authorizationId: "authorization-1",
      scheduleId: "schedule-1",
      administeredAt: "2026-09-30T09:00:00.000Z",
      doseGiven: "One tablet",
      status: "administered",
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ scheduleId: "schedule-1" }),
    }));
  });

  it("records administration corrections as new linked rows, never updates", async () => {
    const created = { id: "correction-1", correctionOfId: "administration-1" };
    const create = jest.fn().mockResolvedValue(created);
    const auditCreate = jest.fn().mockResolvedValue({});
    const transaction = {
      medicationAdministration: { create },
      auditEvent: { create: auditCreate },
    };
    const service = new MedicalService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({
        membershipRoles: [schoolMembershipRole("MEDICAL")],
      }) },
      school: { findFirst: jest.fn().mockResolvedValue({ timezone: "Europe/London" }) },
      medicationAuthorization: { findFirst: jest.fn().mockResolvedValue({ id: "authorization-1", pupilId: "pupil-1" }) },
      medicationAdministration: { findFirst: jest.fn().mockResolvedValue({ id: "administration-1" }) },
      auditEvent: { create: auditCreate },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaService);

    const result = await service.createMedicationAdministration("school-1", "nurse-1", "pupil-1", {
      authorizationId: "authorization-1",
      administeredAt: "2026-09-30T09:00:00.000Z",
      doseGiven: "5ml",
      status: "administered",
      correctionOfId: "administration-1",
      correctionReason: "Recorded dose was entered incorrectly.",
    });

    expect(result).toBe(created);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        correctionOfId: "administration-1",
        correctionReason: "Recorded dose was entered incorrectly.",
      }),
    }));
    expect("update" in transaction.medicationAdministration).toBe(false);
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "medical.medication.administration.corrected" }),
    }));
  });

  it("returns only parent-visible condition and medication fields", async () => {
    const contactFindFirst = jest.fn().mockResolvedValue({ schoolId: "school-1", guardianPersonId: "guardian-1" });
    const conditionFindMany = jest.fn().mockResolvedValue([]);
    const authorizationFindMany = jest.fn().mockResolvedValue([]);
    const service = new MedicalService({
      pupilContact: { findFirst: contactFindFirst },
      pupilMedicalCondition: { findMany: conditionFindMany },
      medicationAuthorization: { findMany: authorizationFindMany },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService);

    await service.getParentMedical("parent-1", "pupil-1");

    expect(conditionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ parentVisible: true }),
      select: expect.not.objectContaining({ careNote: true, severity: true }),
    }));
    expect(authorizationFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ guardianPersonId: "guardian-1" }),
      select: expect.not.objectContaining({ dosageInstructions: true, administrations: expect.anything() }),
    }));
    expect(contactFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ canViewPortal: true, hasParentalResponsibility: true }),
    }));
  });
});
