import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { AdmissionsService } from "./admissions.service";

describe("AdmissionsService", () => {
  it("accepts public intake without creating a pupil or automatically linking an account", async () => {
    const applicationCreate = jest.fn().mockResolvedValue({
      id: "application-1",
      reference: "APP-123",
      status: "submitted",
      submittedAt: new Date(),
    });
    const transaction = {
      application: { create: applicationCreate },
      applicationStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      person: { create: jest.fn() },
      pupilProfile: { create: jest.fn() },
    };
    const service = new AdmissionsService({
      school: { findFirst: jest.fn().mockResolvedValue({ id: "school-1" }) },
      yearGroup: { findFirst: jest.fn().mockResolvedValue({ id: "year-7" }) },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaService);

    const result = await service.createPublicApplication("school-1", {
      targetYearGroupId: "year-7",
      applicantName: "Parent Example",
      applicantEmail: "parent@example.test",
      applicantPhone: "07123456789",
      pupilFirstName: "Child",
      pupilLastName: "Example",
      pupilDateOfBirth: "2016-05-01",
    });

    expect(result.status).toBe("submitted");
    expect(applicationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ applicantUserId: expect.anything(), enrolledPupilId: expect.anything() }),
    }));
    expect(transaction.person.create).not.toHaveBeenCalled();
    expect(transaction.pupilProfile.create).not.toHaveBeenCalled();
  });

  it("rejects staff status changes that bypass offer acceptance or verified enrolment", async () => {
    const transaction = jest.fn();
    const service = new AdmissionsService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({ id: "admissions-membership" }) },
      $transaction: transaction,
    } as unknown as PrismaService);

    await expect(service.updateStatus("school-1", "admissions-1", "application-1", {
      status: "accepted",
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(transaction).not.toHaveBeenCalled();
  });

  it("denies offer responses when the application is not linked to the current parent", async () => {
    const transaction = {
      application: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new AdmissionsService({
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaService);

    await expect(service.respondToOffer("parent-1", "application-1", "offer-1", { response: "accepted" }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it("requires an accepted application before the verified enrolment handoff", async () => {
    const transaction = jest.fn();
    const service = new AdmissionsService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({ id: "admissions-membership" }) },
      application: { findFirst: jest.fn().mockResolvedValue({ id: "application-1", status: "reviewing" }) },
      academicYear: { findFirst: jest.fn().mockResolvedValue({ id: "year-1" }) },
      yearGroup: { findFirst: jest.fn().mockResolvedValue({ id: "group-1" }) },
      form: { findFirst: jest.fn().mockResolvedValue({ id: "form-1" }) },
      $transaction: transaction,
    } as unknown as PrismaService);

    await expect(service.createEnrolmentHandoff("school-1", "admissions-1", "application-1", {
      academicYearId: "year-1",
      yearGroupId: "group-1",
      formId: "form-1",
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(transaction).not.toHaveBeenCalled();
  });

  it("creates a pupil, dated enrolment, and portal contact only after accepted offer verification", async () => {
    const pupilContactCreate = jest.fn().mockResolvedValue({});
    const pupilEnrolmentCreate = jest.fn().mockResolvedValue({});
    const handoffCreate = jest.fn().mockResolvedValue({ id: "handoff-1" });
    const transaction = {
      person: { create: jest.fn().mockResolvedValue({ id: "person-1" }) },
      pupilProfile: { create: jest.fn().mockResolvedValue({ id: "pupil-1", admissionNumber: "ADM-NEW" }) },
      pupilEnrolment: { create: pupilEnrolmentCreate },
      pupilContact: { create: pupilContactCreate },
      enrolmentHandoff: { create: handoffCreate },
      application: { update: jest.fn().mockResolvedValue({}) },
      applicationStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new AdmissionsService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({ id: "admissions-membership" }) },
      application: { findFirst: jest.fn().mockResolvedValue({
        id: "application-1",
        status: "accepted",
        applicantUserId: "parent-1",
        pupilFirstName: "Child",
        pupilLastName: "Example",
        pupilDateOfBirth: new Date("2016-05-01T00:00:00.000Z"),
      }) },
      academicYear: { findFirst: jest.fn().mockResolvedValue({ id: "year-1" }) },
      yearGroup: { findFirst: jest.fn().mockResolvedValue({ id: "group-1" }) },
      form: { findFirst: jest.fn().mockResolvedValue({ id: "form-1" }) },
      offer: { findFirst: jest.fn().mockResolvedValue({ id: "offer-1" }) },
      person: { findFirst: jest.fn().mockResolvedValue({ id: "parent-person", parentProfile: { id: "parent-profile" } }) },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaService);

    const result = await service.createEnrolmentHandoff("school-1", "admissions-1", "application-1", {
      academicYearId: "year-1",
      yearGroupId: "group-1",
      formId: "form-1",
    });

    expect(result.pupilId).toBe("pupil-1");
    expect(pupilEnrolmentCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ pupilId: "pupil-1", academicYearId: "year-1", yearGroupId: "group-1", formId: "form-1" }),
    }));
    expect(pupilContactCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ guardianPersonId: "parent-person", canViewPortal: true, hasParentalResponsibility: true }),
    }));
    expect(handoffCreate).toHaveBeenCalled();
  });
});
