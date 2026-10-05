import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateBehaviourIncidentDto,
  CreateBehaviourRewardDto,
  CreateBehaviourSanctionDto,
} from "./behaviour.dto";

function dateOnlyToday(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

@Injectable()
export class BehaviourService {
  constructor(private readonly prisma: PrismaService) {}

  async createIncident(schoolId: string, userId: string, input: CreateBehaviourIncidentDto) {
    await this.requireStaffMember(schoolId, userId);
    await this.requirePupil(schoolId, input.pupilId);
    const parentVisible = input.parentVisible ?? false;

    return this.prisma.$transaction(async (transaction) => {
      const incident = await transaction.behaviourIncident.create({
        data: {
          schoolId,
          pupilId: input.pupilId,
          seedKey: `api:${randomUUID()}`,
          category: input.category,
          title: input.title.trim(),
          details: input.details.trim(),
          points: input.points ?? -1,
          parentVisible,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "behaviour.incident.created",
          entityType: "behaviour_incident",
          entityId: incident.id,
          metadata: { pupilId: input.pupilId, category: input.category, parentVisible },
        },
      });
      if (parentVisible) {
        await this.queueParentNotification(transaction, {
          schoolId,
          pupilId: input.pupilId,
          aggregateId: incident.id,
          activityType: "incident",
          title: incident.title,
        });
      }
      return incident;
    });
  }

  async createReward(schoolId: string, userId: string, input: CreateBehaviourRewardDto) {
    await this.requireStaffMember(schoolId, userId);
    await this.requirePupil(schoolId, input.pupilId);
    const parentVisible = input.parentVisible ?? true;

    return this.prisma.$transaction(async (transaction) => {
      const reward = await transaction.behaviourReward.create({
        data: {
          schoolId,
          pupilId: input.pupilId,
          category: input.category,
          title: input.title.trim(),
          details: input.details.trim(),
          points: input.points ?? 1,
          parentVisible,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "behaviour.reward.created",
          entityType: "behaviour_reward",
          entityId: reward.id,
          metadata: { pupilId: input.pupilId, category: input.category, parentVisible },
        },
      });
      if (parentVisible) {
        await this.queueParentNotification(transaction, {
          schoolId,
          pupilId: input.pupilId,
          aggregateId: reward.id,
          activityType: "reward",
          title: reward.title,
        });
      }
      return reward;
    });
  }

  async createSanction(
    schoolId: string,
    userId: string,
    incidentId: string,
    input: CreateBehaviourSanctionDto,
  ) {
    await this.requireStaffMember(schoolId, userId);
    const incident = await this.prisma.behaviourIncident.findFirst({
      where: { schoolId, id: incidentId },
      select: { id: true, pupilId: true },
    });
    if (!incident) {
      throw new NotFoundException("Behaviour incident not found.");
    }
    if (input.sanctionType === "detention" && !input.detentionAt) {
      throw new BadRequestException("A scheduled date is required for detention sanctions.");
    }
    if (input.sanctionType !== "detention" && input.detentionAt) {
      throw new BadRequestException("A detention date is only valid for a detention sanction.");
    }
    const parentVisible = input.parentVisible ?? false;

    return this.prisma.$transaction(async (transaction) => {
      const sanction = await transaction.behaviourSanction.create({
        data: {
          schoolId,
          pupilId: incident.pupilId,
          incidentId,
          sanctionType: input.sanctionType,
          details: input.details?.trim(),
          parentVisible,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          ...(input.detentionAt
            ? {
                detention: {
                  create: {
                    school: { connect: { id: schoolId } },
                    pupil: {
                      connect: {
                        schoolId_id: { schoolId, id: incident.pupilId },
                      },
                    },
                    scheduledAt: new Date(input.detentionAt),
                  },
                },
              }
            : {}),
        },
        include: { detention: true },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "behaviour.sanction.created",
          entityType: "behaviour_sanction",
          entityId: sanction.id,
          metadata: { pupilId: incident.pupilId, incidentId, sanctionType: input.sanctionType },
        },
      });
      if (parentVisible) {
        await this.queueParentNotification(transaction, {
          schoolId,
          pupilId: incident.pupilId,
          aggregateId: sanction.id,
          activityType: "sanction",
          title: sanction.sanctionType,
        });
      }
      return sanction;
    });
  }

  async getPupilBehaviour(schoolId: string, userId: string, pupilId: string) {
    await this.requireStaffMember(schoolId, userId);
    await this.requirePupil(schoolId, pupilId);
    const [incidents, rewards, sanctions] = await Promise.all([
      this.prisma.behaviourIncident.findMany({
        where: { schoolId, pupilId },
        orderBy: { occurredAt: "desc" },
        select: {
          id: true,
          category: true,
          title: true,
          details: true,
          points: true,
          occurredAt: true,
          parentVisible: true,
          sanctions: {
            select: { id: true, sanctionType: true, status: true, dueAt: true },
          },
        },
      }),
      this.prisma.behaviourReward.findMany({
        where: { schoolId, pupilId },
        orderBy: { occurredAt: "desc" },
        select: {
          id: true,
          category: true,
          title: true,
          details: true,
          points: true,
          occurredAt: true,
          parentVisible: true,
        },
      }),
      this.prisma.behaviourSanction.findMany({
        where: { schoolId, pupilId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          sanctionType: true,
          details: true,
          status: true,
          parentVisible: true,
          dueAt: true,
          detention: { select: { scheduledAt: true, status: true } },
        },
      }),
    ]);
    await this.prisma.auditEvent.create({
      data: {
        schoolId,
        actorUserId: userId,
        action: "behaviour.pupil.viewed",
        entityType: "pupil_behaviour",
        entityId: pupilId,
        metadata: { incidentCount: incidents.length, rewardCount: rewards.length, sanctionCount: sanctions.length },
      },
    });
    return { incidents, rewards, sanctions };
  }

  private async requireStaffMember(schoolId: string, userId: string): Promise<void> {
    const membership = await this.prisma.schoolMembership.findFirst({
      where: {
        schoolId,
        userId,
        status: "active",
        membershipRoles: {
          some: { role: { code: { notIn: ["PARENT", "STUDENT"] } } },
        },
      },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenException("Staff membership is required for behaviour records.");
    }
  }

  private async requirePupil(schoolId: string, pupilId: string): Promise<void> {
    const pupil = await this.prisma.pupilProfile.findFirst({
      where: { schoolId, id: pupilId },
      select: { id: true },
    });
    if (!pupil) {
      throw new NotFoundException("Pupil not found.");
    }
  }

  private async queueParentNotification(
    transaction: Prisma.TransactionClient,
    input: {
      schoolId: string;
      pupilId: string;
      aggregateId: string;
      activityType: string;
      title: string;
    },
  ): Promise<void> {
    const today = dateOnlyToday();
    const contacts = await transaction.pupilContact.findMany({
      where: {
        schoolId: input.schoolId,
        pupilId: input.pupilId,
        canViewPortal: true,
        startsOn: { lte: today },
        OR: [{ endsOn: null }, { endsOn: { gte: today } }],
      },
      select: { guardianPersonId: true },
    });
    if (contacts.length === 0) return;

    await transaction.outboxEvent.create({
      data: {
        schoolId: input.schoolId,
        eventType: "behaviour.parent_notification.requested",
        aggregateType: `behaviour_${input.activityType}`,
        aggregateId: input.aggregateId,
        idempotencyKey: `behaviour:${input.activityType}:${input.aggregateId}`,
        payload: {
          pupilId: input.pupilId,
          recipientPersonIds: contacts.map(({ guardianPersonId }) => guardianPersonId),
          activityType: input.activityType,
          title: input.title,
        },
      },
    });
  }
}
