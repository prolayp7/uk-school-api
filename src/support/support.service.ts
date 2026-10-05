import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateSendTargetReviewDto,
  CreateSupportPlanDto,
} from "./support.dto";

const SEND_ROLE_CODES = ["SENCO", "DEPUTY_SENCO", "HEADTEACHER"];

function dateOnly(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function validateDateRange(startsOn: string, endsOn?: string): void {
  if (endsOn && dateOnly(endsOn) < dateOnly(startsOn)) {
    throw new BadRequestException("End date cannot precede start date.");
  }
}

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async getPupilSend(schoolId: string, userId: string, pupilId: string) {
    await this.requireSendRole(schoolId, userId);
    await this.requirePupil(schoolId, pupilId);
    const [profile, plans] = await Promise.all([
      this.prisma.sendProfile.findUnique({
        where: { schoolId_pupilId: { schoolId, pupilId } },
        select: {
          status: true,
          primaryNeed: true,
          supportLevel: true,
          reviewDue: true,
        },
      }),
      this.prisma.supportPlan.findMany({
        where: { schoolId, pupilId },
        orderBy: [{ startsOn: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          title: true,
          summary: true,
          status: true,
          startsOn: true,
          endsOn: true,
          targets: {
            orderBy: { startsOn: "desc" },
            select: {
              id: true,
              title: true,
              description: true,
              successCriteria: true,
              status: true,
              startsOn: true,
              reviewDue: true,
              reviews: {
                orderBy: { reviewedAt: "desc" },
                select: { outcome: true, note: true, reviewedAt: true },
              },
            },
          },
          interventions: { orderBy: { startsOn: "desc" } },
          provisions: { orderBy: { startsOn: "desc" } },
        },
      }),
    ]);
    await this.auditRead(schoolId, userId, pupilId, "send.profile.viewed", { planCount: plans.length });
    return { profile, plans };
  }

  async createSupportPlan(
    schoolId: string,
    userId: string,
    pupilId: string,
    input: CreateSupportPlanDto,
  ) {
    await this.requireSendRole(schoolId, userId);
    await this.requirePupil(schoolId, pupilId);
    validateDateRange(input.startsOn, input.endsOn);
    for (const row of [...(input.interventions ?? []), ...(input.provisions ?? [])]) {
      validateDateRange(row.startsOn, row.endsOn);
    }
    for (const target of input.targets ?? []) {
      validateDateRange(target.startsOn, target.reviewDue);
    }

    return this.prisma.$transaction(async (transaction) => {
      const profile = await transaction.sendProfile.upsert({
        where: { schoolId_pupilId: { schoolId, pupilId } },
        create: {
          schoolId,
          pupilId,
          status: input.senStatus ?? "sen_support",
          primaryNeed: input.primaryNeed?.trim() ?? "Not recorded",
          supportLevel: input.supportLevel?.trim() ?? "universal",
          reviewDue: input.reviewDue ? dateOnly(input.reviewDue) : null,
        },
        update: {
          ...(input.senStatus ? { status: input.senStatus } : {}),
          ...(input.primaryNeed ? { primaryNeed: input.primaryNeed.trim() } : {}),
          ...(input.supportLevel ? { supportLevel: input.supportLevel.trim() } : {}),
          ...(input.reviewDue ? { reviewDue: dateOnly(input.reviewDue) } : {}),
        },
      });
      const plan = await transaction.supportPlan.create({
        data: {
          schoolId,
          pupilId,
          title: input.title.trim(),
          summary: input.summary.trim(),
          startsOn: dateOnly(input.startsOn),
          endsOn: input.endsOn ? dateOnly(input.endsOn) : null,
          parentVisible: input.parentVisible ?? false,
        },
      });
      const targets = [];
      for (const target of input.targets ?? []) {
        targets.push(await transaction.sendTarget.create({
          data: {
            schoolId,
            supportPlanId: plan.id,
            title: target.title.trim(),
            description: target.description.trim(),
            successCriteria: target.successCriteria.trim(),
            startsOn: dateOnly(target.startsOn),
            reviewDue: target.reviewDue ? dateOnly(target.reviewDue) : null,
            parentVisible: target.parentVisible ?? false,
          },
        }));
      }
      const interventions = [];
      for (const intervention of input.interventions ?? []) {
        interventions.push(await transaction.sendIntervention.create({
          data: {
            schoolId,
            pupilId,
            supportPlanId: plan.id,
            interventionType: intervention.interventionType.trim(),
            description: intervention.description.trim(),
            startsOn: dateOnly(intervention.startsOn),
            endsOn: intervention.endsOn ? dateOnly(intervention.endsOn) : null,
          },
        }));
      }
      const provisions = [];
      for (const provision of input.provisions ?? []) {
        provisions.push(await transaction.provisionRecord.create({
          data: {
            schoolId,
            pupilId,
            supportPlanId: plan.id,
            provisionType: provision.provisionType.trim(),
            description: provision.description.trim(),
            frequency: provision.frequency.trim(),
            startsOn: dateOnly(provision.startsOn),
            endsOn: provision.endsOn ? dateOnly(provision.endsOn) : null,
          },
        }));
      }
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "send.support_plan.created",
          entityType: "support_plan",
          entityId: plan.id,
          metadata: {
            pupilId,
            targetCount: targets.length,
            interventionCount: interventions.length,
            provisionCount: provisions.length,
          },
        },
      });
      return { profile, plan, targets, interventions, provisions };
    });
  }

  async createPlanReview(
    schoolId: string,
    userId: string,
    planId: string,
    input: CreateSendTargetReviewDto,
  ) {
    await this.requireSendRole(schoolId, userId);
    const target = await this.prisma.sendTarget.findFirst({
      where: { schoolId, id: input.targetId, supportPlanId: planId },
      select: { id: true, status: true },
    });
    if (!target) {
      throw new NotFoundException("SEND target not found in this plan.");
    }

    return this.prisma.$transaction(async (transaction) => {
      const review = await transaction.sendTargetReview.create({
        data: {
          schoolId,
          targetId: target.id,
          outcome: input.outcome,
          note: input.note.trim(),
          reviewedAt: input.reviewedAt ? new Date(input.reviewedAt) : new Date(),
        },
      });
      await transaction.sendTarget.update({
        where: { schoolId_id: { schoolId, id: target.id } },
        data: { status: input.outcome },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "send.target.reviewed",
          entityType: "send_target",
          entityId: target.id,
          metadata: { planId, outcome: input.outcome },
        },
      });
      return review;
    });
  }

  async getParentSend(userId: string, pupilId: string) {
    const contact = await this.findParentLink(userId, pupilId);
    if (!contact) {
      throw new ForbiddenException("You do not have portal access to this pupil's SEND summary.");
    }
    const [profile, plans] = await Promise.all([
      this.prisma.sendProfile.findUnique({
        where: { schoolId_pupilId: { schoolId: contact.schoolId, pupilId } },
        select: { status: true, primaryNeed: true, supportLevel: true, reviewDue: true },
      }),
      this.prisma.supportPlan.findMany({
        where: { schoolId: contact.schoolId, pupilId, parentVisible: true },
        orderBy: { startsOn: "desc" },
        select: {
          title: true,
          startsOn: true,
          endsOn: true,
          targets: {
            where: { parentVisible: true },
            select: { title: true, status: true, reviewDue: true },
          },
        },
      }),
    ]);
    await this.auditRead(contact.schoolId, userId, pupilId, "send.parent_summary.viewed", { planCount: plans.length });
    return { profile, plans };
  }

  private async requireSendRole(schoolId: string, userId: string): Promise<void> {
    const membership = await this.prisma.schoolMembership.findFirst({
      where: {
        schoolId,
        userId,
        status: "active",
        membershipRoles: { some: { role: { code: { in: SEND_ROLE_CODES } } } },
      },
      select: { id: true },
    });
    if (!membership) {
      await this.auditRead(schoolId, userId, null, "send.access_denied", {});
      throw new ForbiddenException("SENCO or deputy SENCO authorization is required.");
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
        entityType: "send_record",
        entityId: pupilId,
        metadata,
      },
    });
  }
}
