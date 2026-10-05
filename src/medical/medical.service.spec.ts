import "reflect-metadata";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
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

  it("requires an active medication authorization before recording administration", async () => {
    const transaction = { medicationAdministration: { create: jest.fn() } };
    const service = new MedicalService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({ id: "medical-membership" }) },
      medicationAuthorization: { findFirst: jest.fn().mockResolvedValue(null) },
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

  it("records administration corrections as new linked rows, never updates", async () => {
    const created = { id: "correction-1", correctionOfId: "administration-1" };
    const create = jest.fn().mockResolvedValue(created);
    const auditCreate = jest.fn().mockResolvedValue({});
    const transaction = {
      medicationAdministration: { create },
      auditEvent: { create: auditCreate },
    };
    const service = new MedicalService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({ id: "medical-membership" }) },
      medicationAuthorization: { findFirst: jest.fn().mockResolvedValue({ id: "authorization-1", pupilId: "pupil-1" }) },
      medicationAdministration: { findFirst: jest.fn().mockResolvedValue({ id: "administration-1" }) },
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
