import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AuthGuard, SchoolAccessGuard } from "../auth/auth.guard";
import type { PrismaService } from "../prisma/prisma.service";
import { ParentSupportController, SupportController } from "./support.controller";
import { SupportService } from "./support.service";

describe("SupportService", () => {
  it("protects staff SEND routes and requires authentication for parent summaries", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SupportController))
      .toEqual([AuthGuard, SchoolAccessGuard]);
    const guards = Reflect.getMetadata(GUARDS_METADATA, ParentSupportController);
    expect(guards).toEqual([AuthGuard]);
  });

  it("denies users without a SENCO role before querying SEND records", async () => {
    const auditCreate = jest.fn().mockResolvedValue({});
    const profileFindUnique = jest.fn();
    const service = new SupportService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue(null) },
      auditEvent: { create: auditCreate },
      sendProfile: { findUnique: profileFindUnique },
    } as unknown as PrismaService);

    await expect(service.getPupilSend("school-1", "teacher-1", "pupil-1"))
      .rejects.toBeInstanceOf(ForbiddenException);

    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "send.access_denied" }),
    }));
    expect(profileFindUnique).not.toHaveBeenCalled();
  });

  it("creates a SEND profile and plan atomically for a newly identified pupil", async () => {
    const sendProfileUpsert = jest.fn().mockResolvedValue({ status: "ehcp" });
    const supportPlanCreate = jest.fn().mockResolvedValue({ id: "plan-1" });
    const auditCreate = jest.fn().mockResolvedValue({});
    const transaction = {
      sendProfile: { upsert: sendProfileUpsert },
      supportPlan: { create: supportPlanCreate },
      sendTarget: { create: jest.fn().mockResolvedValue({ id: "target-1" }) },
      sendIntervention: { create: jest.fn().mockResolvedValue({ id: "intervention-1" }) },
      provisionRecord: { create: jest.fn().mockResolvedValue({ id: "provision-1" }) },
      auditEvent: { create: auditCreate },
    };
    const service = new SupportService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({ id: "senco-membership" }) },
      pupilProfile: { findFirst: jest.fn().mockResolvedValue({ id: "pupil-1" }) },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaService);

    const result = await service.createSupportPlan("school-1", "senco-1", "pupil-1", {
      title: "Communication support",
      summary: "Internal support details",
      startsOn: "2026-10-01",
      senStatus: "ehcp",
      primaryNeed: "Communication and interaction",
      targets: [{
        title: "Use a visual timetable",
        description: "Target details",
        successCriteria: "Uses it on four of five days",
        startsOn: "2026-10-01",
        parentVisible: true,
      }],
    });

    expect(sendProfileUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ status: "ehcp", primaryNeed: "Communication and interaction" }),
    }));
    expect(supportPlanCreate).toHaveBeenCalled();
    expect(result.profile).toEqual({ status: "ehcp" });
  });

  it("returns only explicitly visible SEND fields to an authorized parent", async () => {
    const profileFindUnique = jest.fn().mockResolvedValue({ status: "sen_support" });
    const plansFindMany = jest.fn().mockResolvedValue([{ title: "Shared plan" }]);
    const auditCreate = jest.fn().mockResolvedValue({});
    const contactFindFirst = jest.fn().mockResolvedValue({ schoolId: "school-1", guardianPersonId: "guardian-1" });
    const service = new SupportService({
      pupilContact: { findFirst: contactFindFirst },
      sendProfile: { findUnique: profileFindUnique },
      supportPlan: { findMany: plansFindMany },
      auditEvent: { create: auditCreate },
    } as unknown as PrismaService);

    await service.getParentSend("parent-1", "pupil-1");

    expect(contactFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ canViewPortal: true, hasParentalResponsibility: true }),
    }));
    expect(plansFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ parentVisible: true }),
      select: expect.not.objectContaining({ summary: true, interventions: expect.anything(), provisions: expect.anything() }),
    }));
  });
});
