import { ForbiddenException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { BehaviourService } from "./behaviour.service";

describe("BehaviourService", () => {
  it("denies parent-only memberships from creating staff behaviour records", async () => {
    const incidentCreate = jest.fn();
    const service = new BehaviourService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue(null) },
      behaviourIncident: { create: incidentCreate },
    } as unknown as PrismaService);

    await expect(service.createIncident("school-1", "parent-1", {
      pupilId: "pupil-1",
      category: "minor",
      title: "Classroom reminder",
      details: "Expectations reviewed.",
    })).rejects.toBeInstanceOf(ForbiddenException);

    expect(incidentCreate).not.toHaveBeenCalled();
  });

  it("audits parent-visible incidents and queues a content-limited outbox event", async () => {
    const incident = {
      id: "incident-1",
      title: "Classroom reminder",
      details: "Internal details stay in the ERP record.",
    };
    const outboxCreate = jest.fn().mockResolvedValue({});
    const auditCreate = jest.fn().mockResolvedValue({});
    const transaction = {
      behaviourIncident: { create: jest.fn().mockResolvedValue(incident) },
      auditEvent: { create: auditCreate },
      pupilContact: {
        findMany: jest.fn().mockResolvedValue([{ guardianPersonId: "guardian-1" }]),
      },
      outboxEvent: { create: outboxCreate },
    };
    const service = new BehaviourService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({ id: "staff-membership" }) },
      pupilProfile: { findFirst: jest.fn().mockResolvedValue({ id: "pupil-1" }) },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaService);

    await service.createIncident("school-1", "teacher-1", {
      pupilId: "pupil-1",
      category: "minor",
      title: "Classroom reminder",
      details: "Internal details stay in the ERP record.",
      parentVisible: true,
    });

    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "behaviour.incident.created",
        metadata: { pupilId: "pupil-1", category: "minor", parentVisible: true },
      }),
    }));
    expect(outboxCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: "behaviour.parent_notification.requested",
        payload: expect.objectContaining({ recipientPersonIds: ["guardian-1"] }),
      }),
    }));
    expect(JSON.stringify(outboxCreate.mock.calls)).not.toContain("Internal details stay");
  });

  it("builds a school behaviour summary for the management dashboard", async () => {
    const service = new BehaviourService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({ id: "staff-membership" }) },
      behaviourIncident: {
        findMany: jest.fn().mockResolvedValue([
          { id: "incident-1", category: "minor", title: "Disruption", points: -1, occurredAt: new Date("2026-10-01T09:00:00Z"), pupilId: "pupil-1" },
          { id: "incident-2", category: "disruption", title: "Persistent talking", points: -3, occurredAt: new Date("2026-10-03T09:00:00Z"), pupilId: "pupil-2" },
        ]),
      },
      behaviourReward: {
        findMany: jest.fn().mockResolvedValue([
          { id: "reward-1", category: "merit", title: "Helpful support", points: 2, occurredAt: new Date("2026-10-04T09:00:00Z"), pupilId: "pupil-3" },
        ]),
      },
      behaviourSanction: {
        findMany: jest.fn().mockResolvedValue([
          { id: "sanction-1", sanctionType: "detention", status: "assigned", parentVisible: true, dueAt: new Date("2026-10-08T09:00:00Z") },
        ]),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService);

    const summary = await service.getSchoolBehaviourSummary("school-1", "teacher-1");

    expect(summary.totalIncidents).toBe(2);
    expect(summary.totalRewards).toBe(1);
    expect(summary.activeSanctions).toBe(1);
    expect(summary.recentIncidents[0].category).toBe("minor");
    expect(summary.categoryBreakdown[0].category).toBe("minor");
  });
});
