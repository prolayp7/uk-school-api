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
});
