import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateSafeguardingActionDto,
  CreateSafeguardingConcernDto,
  CreateSafeguardingMeetingDto,
  GrantSafeguardingCaseAccessDto,
  UpdateSafeguardingCaseStatusDto,
} from "./behaviour.dto";

const DSL_ROLE_CODES = ["DSL", "DEPUTY_DSL"];

@Injectable()
export class SafeguardingService {
  constructor(private readonly prisma: PrismaService) {}

  async submitConcern(schoolId: string, userId: string, input: CreateSafeguardingConcernDto) {
    await this.requireStaffMember(schoolId, userId);
    const pupil = await this.prisma.pupilProfile.findFirst({
      where: { schoolId, id: input.pupilId },
      select: { id: true },
    });
    if (!pupil) {
      throw new NotFoundException("Pupil not found.");
    }

    const dslMemberships = await this.prisma.schoolMembership.findMany({
      where: {
        schoolId,
        status: "active",
        membershipRoles: { some: { role: { code: { in: DSL_ROLE_CODES } } } },
      },
      select: { userId: true },
    });
    if (dslMemberships.length === 0) {
      throw new ConflictException("No active DSL or deputy DSL membership is configured for this school.");
    }

    return this.prisma.$transaction(async (transaction) => {
      const safeguardingCase = await transaction.safeguardingCase.create({
        data: { schoolId, pupilId: input.pupilId },
        select: { id: true, status: true },
      });
      const concern = await transaction.safeguardingConcern.create({
        data: {
          schoolId,
          caseId: safeguardingCase.id,
          pupilId: input.pupilId,
          category: input.category,
          details: input.details.trim(),
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : null,
          reportedByUserId: userId,
        },
        select: { id: true },
      });
      await transaction.safeguardingCaseAccess.createMany({
        data: dslMemberships.map(({ userId: granteeId }) => ({
          schoolId,
          caseId: safeguardingCase.id,
          userId: granteeId,
          grantedByUserId: userId,
          reason: "DSL access assigned on concern intake.",
        })),
        skipDuplicates: true,
      });
      await transaction.auditEvent.createMany({
        data: [
          {
            schoolId,
            actorUserId: userId,
            action: "safeguarding.concern.submitted",
            entityType: "safeguarding_concern",
            entityId: concern.id,
            metadata: { category: input.category },
          },
          {
            schoolId,
            actorUserId: userId,
            action: "safeguarding.case.created",
            entityType: "safeguarding_case",
            entityId: safeguardingCase.id,
            metadata: { source: "concern_intake" },
          },
          ...dslMemberships.map(({ userId: granteeId }) => ({
            schoolId,
            actorUserId: userId,
            action: "safeguarding.case.access_granted",
            entityType: "safeguarding_case",
            entityId: safeguardingCase.id,
            metadata: { granteeUserId: granteeId, reason: "concern_intake" },
          })),
        ],
      });
      return { concernId: concern.id, caseId: safeguardingCase.id, status: safeguardingCase.status };
    });
  }

  async listCases(schoolId: string, userId: string) {
    await this.requireDslRole(schoolId, userId, null);
    const cases = await this.prisma.safeguardingCase.findMany({
      where: {
        schoolId,
        access: { some: { userId, revokedAt: null } },
      },
      orderBy: { openedAt: "desc" },
      select: { id: true, pupilId: true, status: true, openedAt: true, closedAt: true },
    });
    if (cases.length > 0) {
      await this.prisma.auditEvent.createMany({
        data: cases.map((safeguardingCase) => ({
          schoolId,
          actorUserId: userId,
          action: "safeguarding.case.viewed",
          entityType: "safeguarding_case",
          entityId: safeguardingCase.id,
          metadata: { view: "case_list" },
        })),
      });
    }
    return { items: cases, total: cases.length };
  }

  async getCase(schoolId: string, userId: string, caseId: string) {
    await this.requireCaseAccess(schoolId, userId, caseId);
    const safeguardingCase = await this.prisma.safeguardingCase.findFirst({
      where: { schoolId, id: caseId },
      select: {
        id: true,
        pupilId: true,
        status: true,
        openedAt: true,
        closedAt: true,
        pupil: {
          select: {
            admissionNumber: true,
            person: { select: { legalFirstName: true, lastName: true } },
          },
        },
        concerns: {
          orderBy: { reportedAt: "desc" },
          select: {
            id: true,
            category: true,
            details: true,
            occurredAt: true,
            reportedByUserId: true,
            reportedAt: true,
          },
        },
        actions: {
          orderBy: { createdAt: "desc" },
          select: { id: true, actionType: true, details: true, dueAt: true, completedAt: true, createdAt: true },
        },
        meetings: {
          orderBy: { scheduledAt: "desc" },
          select: { id: true, meetingType: true, scheduledAt: true, details: true, createdAt: true },
        },
      },
    });
    if (!safeguardingCase) {
      await this.auditDenied(schoolId, userId, caseId, "case_not_found");
      throw new NotFoundException("Safeguarding case not found.");
    }

    await this.prisma.auditEvent.create({
      data: {
        schoolId,
        actorUserId: userId,
        action: "safeguarding.case.viewed",
        entityType: "safeguarding_case",
        entityId: caseId,
        metadata: { view: "case_detail" },
      },
    });
    return safeguardingCase;
  }

  async createAction(
    schoolId: string,
    userId: string,
    caseId: string,
    input: CreateSafeguardingActionDto,
  ) {
    await this.requireCaseAccess(schoolId, userId, caseId);
    return this.prisma.$transaction(async (transaction) => {
      const action = await transaction.safeguardingAction.create({
        data: {
          schoolId,
          caseId,
          actionType: input.actionType,
          details: input.details.trim(),
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "safeguarding.action.created",
          entityType: "safeguarding_action",
          entityId: action.id,
          metadata: { caseId, actionType: input.actionType },
        },
      });
      return action;
    });
  }

  async createMeeting(
    schoolId: string,
    userId: string,
    caseId: string,
    input: CreateSafeguardingMeetingDto,
  ) {
    await this.requireCaseAccess(schoolId, userId, caseId);
    return this.prisma.$transaction(async (transaction) => {
      const meeting = await transaction.safeguardingMeeting.create({
        data: {
          schoolId,
          caseId,
          meetingType: input.meetingType,
          scheduledAt: new Date(input.scheduledAt),
          details: input.details?.trim(),
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "safeguarding.meeting.created",
          entityType: "safeguarding_meeting",
          entityId: meeting.id,
          metadata: { caseId, meetingType: input.meetingType },
        },
      });
      return meeting;
    });
  }

  async updateCaseStatus(
    schoolId: string,
    userId: string,
    caseId: string,
    input: UpdateSafeguardingCaseStatusDto,
  ) {
    await this.requireCaseAccess(schoolId, userId, caseId);
    return this.prisma.$transaction(async (transaction) => {
      const safeguardingCase = await transaction.safeguardingCase.update({
        where: { schoolId_id: { schoolId, id: caseId } },
        data: {
          status: input.status,
          closedAt: input.status === "closed" ? new Date() : null,
        },
        select: { id: true, status: true, closedAt: true },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "safeguarding.case.status_changed",
          entityType: "safeguarding_case",
          entityId: caseId,
          metadata: { status: input.status },
        },
      });
      return safeguardingCase;
    });
  }

  async grantCaseAccess(
    schoolId: string,
    actorUserId: string,
    caseId: string,
    input: GrantSafeguardingCaseAccessDto,
  ) {
    await this.requireCaseAccess(schoolId, actorUserId, caseId);
    const targetIsDsl = await this.hasDslRole(schoolId, input.userId);
    if (!targetIsDsl) {
      await this.auditDenied(schoolId, actorUserId, caseId, "grant_target_not_dsl");
      throw new ForbiddenException("Case access can only be granted to an active DSL or deputy DSL.");
    }

    return this.prisma.$transaction(async (transaction) => {
      const grant = await transaction.safeguardingCaseAccess.upsert({
        where: { schoolId_caseId_userId: { schoolId, caseId, userId: input.userId } },
        create: {
          schoolId,
          caseId,
          userId: input.userId,
          grantedByUserId: actorUserId,
          reason: input.reason.trim(),
        },
        update: {
          grantedByUserId: actorUserId,
          grantedAt: new Date(),
          revokedAt: null,
          reason: input.reason.trim(),
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId,
          action: "safeguarding.case.access_granted",
          entityType: "safeguarding_case",
          entityId: caseId,
          metadata: { granteeUserId: input.userId },
        },
      });
      return { caseId: grant.caseId, userId: grant.userId, grantedAt: grant.grantedAt };
    });
  }

  async revokeCaseAccess(schoolId: string, actorUserId: string, caseId: string, userId: string) {
    await this.requireCaseAccess(schoolId, actorUserId, caseId);
    return this.prisma.$transaction(async (transaction) => {
      const result = await transaction.safeguardingCaseAccess.updateMany({
        where: { schoolId, caseId, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (result.count === 0) {
        throw new NotFoundException("Active case access grant not found.");
      }
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId,
          action: "safeguarding.case.access_revoked",
          entityType: "safeguarding_case",
          entityId: caseId,
          metadata: { granteeUserId: userId },
        },
      });
      return { caseId, userId, revoked: true };
    });
  }

  private async requireStaffMember(schoolId: string, userId: string): Promise<void> {
    const membership = await this.prisma.schoolMembership.findFirst({
      where: {
        schoolId,
        userId,
        status: "active",
        membershipRoles: { some: { role: { code: { notIn: ["PARENT", "STUDENT"] } } } },
      },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenException("Active staff membership is required to submit a safeguarding concern.");
    }
  }

  private async hasDslRole(schoolId: string, userId: string): Promise<boolean> {
    const membership = await this.prisma.schoolMembership.findFirst({
      where: {
        schoolId,
        userId,
        status: "active",
        membershipRoles: { some: { role: { code: { in: DSL_ROLE_CODES } } } },
      },
      select: { id: true },
    });
    return Boolean(membership);
  }

  private async requireDslRole(schoolId: string, userId: string, caseId: string | null): Promise<void> {
    if (await this.hasDslRole(schoolId, userId)) return;
    await this.auditDenied(schoolId, userId, caseId, "dsl_role_required");
    throw new ForbiddenException("DSL or deputy DSL membership is required for safeguarding casework.");
  }

  private async requireCaseAccess(schoolId: string, userId: string, caseId: string): Promise<void> {
    await this.requireDslRole(schoolId, userId, caseId);
    const grant = await this.prisma.safeguardingCaseAccess.findUnique({
      where: { schoolId_caseId_userId: { schoolId, caseId, userId } },
      select: { revokedAt: true },
    });
    if (!grant || grant.revokedAt) {
      await this.auditDenied(schoolId, userId, caseId, "case_grant_required");
      throw new ForbiddenException("Explicit active access to this safeguarding case is required.");
    }
  }

  private auditDenied(schoolId: string, userId: string, caseId: string | null, reason: string) {
    return this.prisma.auditEvent.create({
      data: {
        schoolId,
        actorUserId: userId,
        action: "safeguarding.case.access_denied",
        entityType: "safeguarding_case",
        entityId: caseId,
        metadata: { reason },
      },
    });
  }
}
