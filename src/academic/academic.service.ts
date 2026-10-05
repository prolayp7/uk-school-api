import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateAssessmentDto,
  CreateCurriculumPlanDto,
  CreateExamCandidatesDto,
  CreateExamSeriesDto,
  CreateGradeScaleDto,
  CreatePupilTargetDto,
  CreateSchemeOfWorkDto,
  CreateTimetableSlotDto,
  UpsertAssessmentResultsDto,
  UpsertExamResultsDto,
} from "./academic.dto";

const CURRICULUM_MANAGER_ROLES = ["HEADTEACHER", "SLT"];
const EXAM_MANAGER_ROLES = ["EXAMS_OFFICER", "HEADTEACHER", "SLT"];
const CLASS_MANAGER_ROLES = ["HEADTEACHER", "SLT", "EXAMS_OFFICER"];

function dateOnly(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function assertDateRange(startsOn: string, endsOn?: string): void {
  if (endsOn && dateOnly(endsOn) < dateOnly(startsOn)) {
    throw new BadRequestException("End date cannot precede start date.");
  }
}

function ensureDistinct<T>(values: T[], message: string): void {
  if (new Set(values).size !== values.length) throw new BadRequestException(message);
}

@Injectable()
export class AcademicService {
  constructor(private readonly prisma: PrismaService) {}

  async listClasses(schoolId: string, userId: string, academicYearId?: string) {
    const roles = await this.getRoleCodes(schoolId, userId);
    const where = {
      schoolId,
      ...(academicYearId ? { academicYearId } : {}),
      ...(!roles.some((role) => CLASS_MANAGER_ROLES.includes(role))
        ? { teacher: { person: { userId } } }
        : {}),
    };
    if (!roles.some((role) => CLASS_MANAGER_ROLES.includes(role)) && !roles.includes("TEACHER")) {
      await this.auditDenied(schoolId, userId, "academic.classes.access_denied");
      throw new ForbiddenException("Teacher or academic leadership access is required.");
    }
    const classes = await this.prisma.classGroup.findMany({
      where,
      orderBy: [{ yearGroup: { sortOrder: "asc" } }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        academicYearId: true,
        yearGroup: { select: { id: true, code: true, name: true, keyStage: true } },
        subject: { select: { id: true, code: true, name: true } },
        teacher: { select: { id: true, staffNumber: true, person: { select: { legalFirstName: true, lastName: true } } } },
        _count: { select: { memberships: true, timetableSlots: true } },
      },
    });
    return { items: classes, total: classes.length };
  }

  async getParentPupilTimetable(userId: string, pupilId: string) {
    const today = dateOnly(new Date().toISOString());
    const contact = await this.prisma.pupilContact.findFirst({
      where: {
        pupilId,
        canViewPortal: true,
        startsOn: { lte: today },
        OR: [{ endsOn: null }, { endsOn: { gte: today } }],
        guardian: { person: { userId } },
      },
      select: { schoolId: true },
    });
    if (!contact) {
      throw new ForbiddenException("You do not have portal access to this pupil's timetable.");
    }

    const roles = await this.getRoleCodes(contact.schoolId, userId);
    if (!roles.includes("PARENT")) {
      await this.auditDenied(contact.schoolId, userId, "academic.parent_timetable.access_denied", pupilId);
      throw new ForbiddenException("Parent membership is required to access this timetable.");
    }

    const items = await this.getCurrentPupilTimetable(contact.schoolId, pupilId, today);
    await this.auditRead(contact.schoolId, userId, pupilId, "academic.parent_timetable.viewed", { slotCount: items.length });
    return { pupilId, items };
  }

  async getStudentTimetable(userId: string) {
    const memberships = await this.prisma.schoolMembership.findMany({
      where: {
        userId,
        status: "active",
        membershipRoles: { some: { role: { code: "STUDENT" } } },
      },
      select: { schoolId: true },
    });
    const schoolIds = memberships.map(({ schoolId }) => schoolId);
    if (schoolIds.length === 0) {
      throw new ForbiddenException("Student membership is required to access a timetable.");
    }

    const pupil = await this.prisma.pupilProfile.findFirst({
      where: { schoolId: { in: schoolIds }, person: { userId } },
      select: { id: true, schoolId: true },
    });
    if (!pupil) return { pupilId: null, items: [] };

    const today = dateOnly(new Date().toISOString());
    const items = await this.getCurrentPupilTimetable(pupil.schoolId, pupil.id, today);
    await this.auditRead(pupil.schoolId, userId, pupil.id, "academic.student_timetable.viewed", { slotCount: items.length });
    return { pupilId: pupil.id, items };
  }

  private async getCurrentPupilTimetable(schoolId: string, pupilId: string, today: Date) {
    const slots = await this.prisma.timetableSlot.findMany({
      where: {
        schoolId,
        effectiveFrom: { lte: today },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
        classGroup: {
          academicYear: { isCurrent: true },
          memberships: { some: { pupilId } },
        },
      },
      orderBy: [{ dayOfWeek: "asc" }, { startsAt: "asc" }],
      select: {
        dayOfWeek: true,
        startsAt: true,
        endsAt: true,
        room: true,
        classGroup: {
          select: {
            code: true,
            yearGroup: { select: { code: true } },
            subject: { select: { code: true, name: true } },
          },
        },
      },
    });

    return slots.map((slot) => ({
      dayOfWeek: slot.dayOfWeek,
      startsAt: slot.startsAt.toISOString().slice(11, 16),
      endsAt: slot.endsAt.toISOString().slice(11, 16),
      room: slot.room,
      classCode: slot.classGroup.code,
      yearGroup: slot.classGroup.yearGroup.code,
      subject: slot.classGroup.subject,
    }));
  }

  async listCurriculumPlans(schoolId: string, userId: string, academicYearId?: string) {
    const roles = await this.getRoleCodes(schoolId, userId);
    if (!roles.some((role) => [...CURRICULUM_MANAGER_ROLES, "TEACHER"].includes(role))) {
      await this.auditDenied(schoolId, userId, "academic.curriculum.access_denied");
      throw new ForbiddenException("Teacher or academic leadership access is required.");
    }
    const plans = await this.prisma.curriculumPlan.findMany({
      where: {
        schoolId,
        ...(academicYearId ? { academicYearId } : {}),
        ...(!roles.some((role) => CURRICULUM_MANAGER_ROLES.includes(role))
          ? { subject: { classes: { some: { teacher: { person: { userId } } } } } }
          : {}),
      },
      orderBy: [{ academicYear: { startsOn: "desc" } }, { yearGroup: { sortOrder: "asc" } }, { subject: { code: "asc" } }],
      include: {
        academicYear: { select: { code: true } },
        yearGroup: { select: { code: true, name: true, keyStage: true } },
        subject: { select: { code: true, name: true } },
        schemes: { orderBy: { sequence: "asc" } },
      },
    });
    return { items: plans, total: plans.length };
  }

  async createCurriculumPlan(schoolId: string, userId: string, input: CreateCurriculumPlanDto) {
    const roles = await this.getRoleCodes(schoolId, userId);
    const schoolScopedReferences = await Promise.all([
      this.prisma.academicYear.findFirst({ where: { schoolId, id: input.academicYearId }, select: { id: true } }),
      this.prisma.yearGroup.findFirst({ where: { schoolId, id: input.yearGroupId }, select: { id: true } }),
      this.prisma.subject.findFirst({ where: { schoolId, id: input.subjectId }, select: { id: true } }),
    ]);
    if (schoolScopedReferences.some((reference) => !reference)) {
      throw new BadRequestException("Academic year, year group, and subject must belong to this school.");
    }
    if (!roles.some((role) => CURRICULUM_MANAGER_ROLES.includes(role))) {
      if (!roles.includes("TEACHER")) {
        await this.auditDenied(schoolId, userId, "academic.curriculum.create_denied");
        throw new ForbiddenException("Curriculum manager or assigned teacher access is required.");
      }
      const assignment = await this.prisma.classGroup.findFirst({
        where: {
          schoolId,
          academicYearId: input.academicYearId,
          yearGroupId: input.yearGroupId,
          subjectId: input.subjectId,
          teacher: { person: { userId } },
        },
        select: { id: true },
      });
      if (!assignment) throw new ForbiddenException("Teachers may only edit curriculum for assigned classes.");
    }

    const plan = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.curriculumPlan.create({
        data: {
          schoolId,
          academicYearId: input.academicYearId,
          yearGroupId: input.yearGroupId,
          subjectId: input.subjectId,
          title: input.title.trim(),
          overview: input.overview.trim(),
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "academic.curriculum_plan.created",
          entityType: "curriculum_plan",
          entityId: created.id,
          metadata: { academicYearId: input.academicYearId, yearGroupId: input.yearGroupId, subjectId: input.subjectId },
        },
      });
      return created;
    });
    return plan;
  }

  async createSchemeOfWork(schoolId: string, userId: string, planId: string, input: CreateSchemeOfWorkDto) {
    const plan = await this.prisma.curriculumPlan.findFirst({
      where: { schoolId, id: planId },
      select: { id: true, subjectId: true, yearGroupId: true, academicYearId: true },
    });
    if (!plan) throw new NotFoundException("Curriculum plan not found.");
    const roles = await this.getRoleCodes(schoolId, userId);
    if (!roles.some((role) => CURRICULUM_MANAGER_ROLES.includes(role))) {
      const assignment = await this.prisma.classGroup.findFirst({
        where: {
          schoolId,
          subjectId: plan.subjectId,
          yearGroupId: plan.yearGroupId,
          academicYearId: plan.academicYearId,
          teacher: { person: { userId } },
        },
        select: { id: true },
      });
      if (!roles.includes("TEACHER") || !assignment) {
        await this.auditDenied(schoolId, userId, "academic.scheme.create_denied", planId);
        throw new ForbiddenException("Teachers may only update schemes for assigned classes.");
      }
    }
    assertDateRange(input.startsOn ?? "2000-01-01", input.endsOn);
    const scheme = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.schemeOfWork.create({
        data: {
          schoolId,
          curriculumPlanId: plan.id,
          subjectId: plan.subjectId,
          title: input.title.trim(),
          sequence: input.sortOrder,
          summary: input.summary.trim(),
          startsOn: input.startsOn ? dateOnly(input.startsOn) : null,
          endsOn: input.endsOn ? dateOnly(input.endsOn) : null,
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "academic.scheme_of_work.created",
          entityType: "scheme_of_work",
          entityId: created.id,
          metadata: { planId },
        },
      });
      return created;
    });
    return scheme;
  }

  async createTimetableSlot(schoolId: string, userId: string, input: CreateTimetableSlotDto) {
    const roles = await this.getRoleCodes(schoolId, userId);
    if (!roles.some((role) => CURRICULUM_MANAGER_ROLES.includes(role))) {
      await this.auditDenied(schoolId, userId, "academic.timetable.create_denied");
      throw new ForbiddenException("Academic leadership access is required to manage the timetable.");
    }
    if (input.endsAt <= input.startsAt) throw new BadRequestException("Timetable slot end must be after its start.");
    assertDateRange(input.effectiveFrom, input.effectiveTo);
    const [classGroup, teacher] = await Promise.all([
      this.prisma.classGroup.findFirst({ where: { schoolId, id: input.classGroupId }, select: { id: true } }),
      this.prisma.staffProfile.findFirst({ where: { schoolId, id: input.teacherStaffId }, select: { id: true } }),
    ]);
    if (!classGroup || !teacher) throw new BadRequestException("Class and teacher must belong to this school.");
    return this.prisma.$transaction(async (transaction) => {
      const slot = await transaction.timetableSlot.create({
        data: {
          schoolId,
          classGroupId: input.classGroupId,
          teacherStaffId: input.teacherStaffId,
          dayOfWeek: input.dayOfWeek,
          startsAt: new Date(`1970-01-01T${input.startsAt}:00.000Z`),
          endsAt: new Date(`1970-01-01T${input.endsAt}:00.000Z`),
          room: input.room?.trim(),
          effectiveFrom: dateOnly(input.effectiveFrom),
          effectiveTo: input.effectiveTo ? dateOnly(input.effectiveTo) : null,
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "academic.timetable_slot.created",
          entityType: "timetable_slot",
          entityId: slot.id,
          metadata: { classGroupId: input.classGroupId, teacherStaffId: input.teacherStaffId },
        },
      });
      return slot;
    });
  }

  async createGradeScale(schoolId: string, userId: string, input: CreateGradeScaleDto) {
    await this.requireRoles(schoolId, userId, EXAM_MANAGER_ROLES, "exam.grade_scale.manage");
    if (input.bands.length === 0) throw new BadRequestException("At least one grade band is required.");
    ensureDistinct(input.bands.map(({ code }) => code.toUpperCase()), "Grade band codes must be unique within a scale.");
    const ordered = [...input.bands].sort((left, right) => left.minScore - right.minScore);
    for (let index = 0; index < ordered.length; index += 1) {
      const band = ordered[index];
      if (band.minScore > band.maxScore) throw new BadRequestException("Grade band minimum cannot exceed its maximum.");
      if (index > 0 && band.minScore <= ordered[index - 1].maxScore) {
        throw new BadRequestException("Grade band score ranges cannot overlap.");
      }
    }
    return this.prisma.$transaction(async (transaction) => {
      const scale = await transaction.gradeScale.create({
        data: { schoolId, code: input.code.trim().toUpperCase(), name: input.name.trim(), scaleType: input.scaleType },
      });
      await transaction.gradeBand.createMany({
        data: input.bands.map((band) => ({
          schoolId,
          gradeScaleId: scale.id,
          code: band.code.trim().toUpperCase(),
          label: band.label.trim(),
          minScore: new Prisma.Decimal(band.minScore),
          maxScore: new Prisma.Decimal(band.maxScore),
          sortOrder: band.sortOrder,
        })),
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "academic.grade_scale.created",
          entityType: "grade_scale",
          entityId: scale.id,
          metadata: { code: scale.code, bandCount: input.bands.length },
        },
      });
      return transaction.gradeScale.findFirst({ where: { schoolId, id: scale.id }, include: { bands: { orderBy: { sortOrder: "asc" } } } });
    });
  }

  async createAssessment(schoolId: string, userId: string, input: CreateAssessmentDto) {
    const classGroup = await this.requireClassAccess(schoolId, userId, input.classGroupId);
    if (input.gradeScaleId) {
      const scale = await this.prisma.gradeScale.findFirst({ where: { schoolId, id: input.gradeScaleId }, select: { id: true } });
      if (!scale) throw new BadRequestException("Grade scale must belong to this school.");
    }
    const assessment = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.assessment.create({
        data: {
          schoolId,
          classGroupId: classGroup.id,
          gradeScaleId: input.gradeScaleId,
          createdByUserId: userId,
          title: input.title.trim(),
          assessmentType: input.assessmentType,
          maxScore: new Prisma.Decimal(input.maxScore),
          assessedOn: dateOnly(input.assessedOn),
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "academic.assessment.created",
          entityType: "assessment",
          entityId: created.id,
          metadata: { classGroupId: classGroup.id, assessmentType: input.assessmentType },
        },
      });
      return created;
    });
    return assessment;
  }

  async upsertAssessmentResults(schoolId: string, userId: string, assessmentId: string, input: UpsertAssessmentResultsDto) {
    ensureDistinct(input.results.map(({ pupilId }) => pupilId), "Each pupil may appear once per assessment update.");
    const assessment = await this.prisma.assessment.findFirst({
      where: { schoolId, id: assessmentId },
      select: { id: true, classGroupId: true, gradeScaleId: true, maxScore: true },
    });
    if (!assessment) throw new NotFoundException("Assessment not found.");
    await this.requireClassAccess(schoolId, userId, assessment.classGroupId);
    const pupilIds = input.results.map(({ pupilId }) => pupilId);
    const memberships = await this.prisma.classMembership.findMany({
      where: { schoolId, classGroupId: assessment.classGroupId, pupilId: { in: pupilIds } },
      select: { pupilId: true },
    });
    const assignedPupils = new Set(memberships.map(({ pupilId }) => pupilId));
    if (pupilIds.some((pupilId) => !assignedPupils.has(pupilId))) {
      throw new BadRequestException("Assessment results can only be entered for pupils assigned to this class.");
    }
    const gradeBands = assessment.gradeScaleId
      ? await this.prisma.gradeBand.findMany({ where: { schoolId, gradeScaleId: assessment.gradeScaleId }, orderBy: { sortOrder: "asc" } })
      : [];
    const maxScore = Number(assessment.maxScore);
    for (const result of input.results) {
      if (result.score > maxScore) throw new BadRequestException("Assessment score cannot exceed the configured maximum.");
      if (!assessment.gradeScaleId && result.gradeCode) throw new BadRequestException("A grade code requires an assessment grade scale.");
      if (assessment.gradeScaleId) {
        const band = result.gradeCode
          ? gradeBands.find(({ code }) => code === result.gradeCode!.toUpperCase())
          : gradeBands.find(({ minScore, maxScore: bandMax }) => result.score >= Number(minScore) && result.score <= Number(bandMax));
        if (!band) throw new BadRequestException("Grade code is not part of the assessment scale.");
        if (result.score < Number(band.minScore) || result.score > Number(band.maxScore)) {
          throw new BadRequestException("Score does not fall within the selected grade band.");
        }
        result.gradeCode = band.code;
      }
    }

    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.assessmentResult.findMany({
        where: { schoolId, assessmentId, pupilId: { in: pupilIds } },
      });
      const previousByPupil = new Map(existing.map((result) => [result.pupilId, result]));
      const roleCodes = await this.getRoleCodes(schoolId, userId);
      const source = roleCodes.includes("TEACHER") ? "teacher" : "staff";
      const saved = [];
      let changed = 0;
      for (const result of input.results) {
        const previous = previousByPupil.get(result.pupilId);
        const score = new Prisma.Decimal(result.score);
        const gradeCode = result.gradeCode?.toUpperCase() ?? null;
        const comments = result.comments?.trim() ?? null;
        if (previous && previous.score.equals(score) && previous.gradeCode === gradeCode && previous.comments === comments) {
          saved.push(previous);
          continue;
        }
        if (previous) {
          await transaction.assessmentResultRevision.create({
            data: {
              schoolId,
              resultId: previous.id,
              score: previous.score,
              gradeCode: previous.gradeCode,
              comments: previous.comments,
              source: previous.source,
              revision: previous.revision,
              changedByUserId: userId,
            },
          });
        }
        const current = await transaction.assessmentResult.upsert({
          where: { schoolId_assessmentId_pupilId: { schoolId, assessmentId, pupilId: result.pupilId } },
          create: {
            schoolId,
            assessmentId,
            pupilId: result.pupilId,
            score,
            gradeCode,
            comments,
            source,
            enteredByUserId: userId,
          },
          update: {
            score,
            gradeCode,
            comments,
            source,
            enteredByUserId: userId,
            recordedAt: new Date(),
            revision: { increment: 1 },
          },
        });
        saved.push(current);
        changed += 1;
      }
      if (changed > 0) {
        await transaction.auditEvent.create({
          data: {
            schoolId,
            actorUserId: userId,
            action: "academic.assessment.results_saved",
            entityType: "assessment",
            entityId: assessmentId,
            metadata: { submittedCount: input.results.length, changedCount: changed },
          },
        });
      }
      return { total: saved.length, changed, items: saved };
    });
  }

  async getPupilAssessmentResults(schoolId: string, userId: string, pupilId: string) {
    const roles = await this.getRoleCodes(schoolId, userId);
    if (!roles.some((role) => [...CLASS_MANAGER_ROLES, "TEACHER"].includes(role))) {
      await this.auditDenied(schoolId, userId, "academic.results.access_denied", pupilId);
      throw new ForbiddenException("Assigned teacher or academic leadership access is required.");
    }
    const results = await this.prisma.assessmentResult.findMany({
      where: {
        schoolId,
        pupilId,
        ...(!roles.some((role) => CLASS_MANAGER_ROLES.includes(role))
          ? {
              assessment: {
                classGroup: {
                  teacher: { person: { userId } },
                  memberships: { some: { schoolId, pupilId } },
                },
              },
            }
          : {}),
      },
      orderBy: [{ assessment: { assessedOn: "desc" } }, { recordedAt: "desc" }],
      select: {
        id: true,
        score: true,
        gradeCode: true,
        comments: true,
        source: true,
        revision: true,
        recordedAt: true,
        assessment: { select: { id: true, title: true, assessmentType: true, maxScore: true, assessedOn: true } },
      },
    });
    await this.auditRead(schoolId, userId, pupilId, "academic.pupil_results.viewed", { resultCount: results.length });
    return { items: results, total: results.length };
  }

  async createPupilTarget(schoolId: string, userId: string, pupilId: string, input: CreatePupilTargetDto) {
    const roles = await this.getRoleCodes(schoolId, userId);
    const pupil = await this.prisma.pupilProfile.findFirst({ where: { schoolId, id: pupilId }, select: { id: true } });
    if (!pupil) throw new NotFoundException("Pupil not found.");
    if (!roles.some((role) => CLASS_MANAGER_ROLES.includes(role))) {
      const assignment = await this.prisma.classMembership.findFirst({
        where: {
          schoolId,
          pupilId,
          classGroup: {
            teacher: { person: { userId } },
            ...(input.subjectId ? { subjectId: input.subjectId } : {}),
          },
        },
        select: { classGroupId: true },
      });
      if (!roles.includes("TEACHER") || !assignment) throw new ForbiddenException("Targets can only be set for assigned pupils.");
    }
    if (input.subjectId) {
      const subject = await this.prisma.subject.findFirst({ where: { schoolId, id: input.subjectId }, select: { id: true } });
      if (!subject) throw new BadRequestException("Target subject must belong to this school.");
    }
    assertDateRange(input.startsOn, input.endsOn);
    const target = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.pupilTarget.create({
        data: {
          schoolId,
          pupilId,
          subjectId: input.subjectId,
          createdByUserId: userId,
          title: input.title.trim(),
          description: input.description.trim(),
          targetGrade: input.targetGrade?.trim(),
          startsOn: dateOnly(input.startsOn),
          endsOn: input.endsOn ? dateOnly(input.endsOn) : null,
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "academic.pupil_target.created",
          entityType: "pupil_target",
          entityId: created.id,
          metadata: { pupilId, subjectId: input.subjectId ?? null },
        },
      });
      return created;
    });
    return target;
  }

  async createExamSeries(schoolId: string, userId: string, input: CreateExamSeriesDto) {
    await this.requireRoles(schoolId, userId, EXAM_MANAGER_ROLES, "exam.series.create_denied");
    assertDateRange(input.startsOn, input.endsOn);
    if (input.academicYearId) {
      const year = await this.prisma.academicYear.findFirst({ where: { schoolId, id: input.academicYearId }, select: { id: true } });
      if (!year) throw new BadRequestException("Academic year must belong to this school.");
    }
    const subjectIds = [...new Set((input.sessions ?? []).map(({ subjectId }) => subjectId))];
    if (subjectIds.length) {
      const subjects = await this.prisma.subject.findMany({ where: { schoolId, id: { in: subjectIds } }, select: { id: true } });
      if (subjects.length !== subjectIds.length) throw new BadRequestException("Every exam subject must belong to this school.");
    }
    for (const session of input.sessions ?? []) {
      if (new Date(session.endsAt) <= new Date(session.startsAt)) throw new BadRequestException("Exam session end must be after start.");
    }

    return this.prisma.$transaction(async (transaction) => {
      const series = await transaction.examSeries.create({
        data: {
          schoolId,
          academicYearId: input.academicYearId,
          createdByUserId: userId,
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          awardingBody: input.awardingBody.trim(),
          qualification: input.qualification.trim(),
          startsOn: dateOnly(input.startsOn),
          endsOn: dateOnly(input.endsOn),
        },
      });
      if (input.sessions?.length) {
        await transaction.examSession.createMany({
          data: input.sessions.map((session) => ({
            schoolId,
            examSeriesId: series.id,
            subjectId: session.subjectId,
            startsAt: new Date(session.startsAt),
            endsAt: new Date(session.endsAt),
            venue: session.venue?.trim(),
          })),
        });
      }
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "exam.series.created",
          entityType: "exam_series",
          entityId: series.id,
          metadata: { code: series.code, sessionCount: input.sessions?.length ?? 0 },
        },
      });
      return transaction.examSeries.findFirst({
        where: { schoolId, id: series.id },
        include: { sessions: { orderBy: { startsAt: "asc" } } },
      });
    });
  }

  async addExamCandidates(schoolId: string, userId: string, seriesId: string, input: CreateExamCandidatesDto) {
    await this.requireRoles(schoolId, userId, EXAM_MANAGER_ROLES, "exam.candidates.manage_denied");
    ensureDistinct(input.candidates.map(({ pupilId, subjectId }) => `${pupilId}:${subjectId}`), "A pupil/subject pair may only be entered once per request.");
    ensureDistinct(input.candidates.map(({ candidateNumber }) => candidateNumber.toUpperCase()), "Candidate numbers must be unique in the request.");
    const series = await this.prisma.examSeries.findFirst({ where: { schoolId, id: seriesId }, select: { id: true } });
    if (!series) throw new NotFoundException("Exam series not found.");
    const pupilIds = [...new Set(input.candidates.map(({ pupilId }) => pupilId))];
    const subjectIds = [...new Set(input.candidates.map(({ subjectId }) => subjectId))];
    const [pupils, subjects] = await Promise.all([
      this.prisma.pupilProfile.findMany({ where: { schoolId, id: { in: pupilIds } }, select: { id: true } }),
      this.prisma.subject.findMany({ where: { schoolId, id: { in: subjectIds } }, select: { id: true } }),
    ]);
    if (pupils.length !== pupilIds.length || subjects.length !== subjectIds.length) {
      throw new BadRequestException("Candidate pupils and subjects must belong to this school.");
    }
    return this.prisma.$transaction(async (transaction) => {
      await transaction.examCandidate.createMany({
        data: input.candidates.map((candidate) => {
          return {
            schoolId,
            examSeriesId: series.id,
            pupilId: candidate.pupilId,
            subjectId: candidate.subjectId,
            candidateNumber: candidate.candidateNumber.trim().toUpperCase(),
          };
        }),
        skipDuplicates: true,
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "exam.candidates.entered",
          entityType: "exam_series",
          entityId: series.id,
          metadata: { submittedCount: input.candidates.length },
        },
      });
      return transaction.examCandidate.findMany({
        where: { schoolId, examSeriesId: series.id },
        orderBy: [{ subject: { code: "asc" } }, { candidateNumber: "asc" }],
        select: {
          id: true,
          candidateNumber: true,
          status: true,
          pupil: { select: { admissionNumber: true, person: { select: { legalFirstName: true, lastName: true } } } },
          subject: { select: { code: true, name: true } },
        },
      });
    });
  }

  async upsertExamResults(schoolId: string, userId: string, seriesId: string, input: UpsertExamResultsDto) {
    await this.requireRoles(schoolId, userId, EXAM_MANAGER_ROLES, "exam.results.manage_denied");
    ensureDistinct(input.results.map(({ candidateId }) => candidateId), "Each candidate may appear once per result update.");
    const candidateIds = input.results.map(({ candidateId }) => candidateId);
    const candidates = await this.prisma.examCandidate.findMany({
      where: { schoolId, examSeriesId: seriesId, id: { in: candidateIds } },
      select: { id: true },
    });
    if (candidates.length !== candidateIds.length) throw new BadRequestException("Every result candidate must belong to this series and school.");
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.examResult.findMany({ where: { schoolId, candidateId: { in: candidateIds } } });
      const previousByCandidate = new Map(existing.map((result) => [result.candidateId, result]));
      const saved = [];
      let changed = 0;
      for (const result of input.results) {
        const previous = previousByCandidate.get(result.candidateId);
        const score = result.score === undefined ? null : new Prisma.Decimal(result.score);
        const grade = result.grade.trim().toUpperCase();
        if (previous && previous.grade === grade && ((previous.score === null && score === null) || previous.score?.equals(score!))) {
          saved.push(previous);
          continue;
        }
        if (previous) {
          await transaction.examResultRevision.create({
            data: {
              schoolId,
              examResultId: previous.id,
              grade: previous.grade,
              score: previous.score,
              source: previous.source,
              revision: previous.revision,
              changedByUserId: userId,
            },
          });
        }
        const current = await transaction.examResult.upsert({
          where: { schoolId_candidateId: { schoolId, candidateId: result.candidateId } },
          create: {
            schoolId,
            candidateId: result.candidateId,
            grade,
            score,
            source: "exam_office",
            enteredByUserId: userId,
          },
          update: {
            grade,
            score,
            source: "exam_office",
            enteredByUserId: userId,
            recordedAt: new Date(),
            revision: { increment: 1 },
          },
        });
        saved.push(current);
        changed += 1;
      }
      if (changed) {
        await transaction.auditEvent.create({
          data: {
            schoolId,
            actorUserId: userId,
            action: "exam.results.saved",
            entityType: "exam_series",
            entityId: seriesId,
            metadata: { submittedCount: input.results.length, changedCount: changed },
          },
        });
      }
      return { total: saved.length, changed, items: saved };
    });
  }

  async getExamResults(schoolId: string, userId: string, seriesId: string) {
    await this.requireRoles(schoolId, userId, EXAM_MANAGER_ROLES, "exam.results.read_denied");
    const series = await this.prisma.examSeries.findFirst({ where: { schoolId, id: seriesId }, select: { id: true } });
    if (!series) throw new NotFoundException("Exam series not found.");
    const results = await this.prisma.examResult.findMany({
      where: { schoolId, candidate: { examSeriesId: seriesId } },
      orderBy: [{ candidate: { subject: { code: "asc" } } }, { candidate: { candidateNumber: "asc" } }],
      select: {
        grade: true,
        score: true,
        source: true,
        revision: true,
        recordedAt: true,
        candidate: {
          select: {
            candidateNumber: true,
            pupil: { select: { admissionNumber: true, person: { select: { legalFirstName: true, lastName: true } } } },
            subject: { select: { code: true, name: true } },
          },
        },
      },
    });
    await this.auditRead(schoolId, userId, seriesId, "exam.results.viewed", { resultCount: results.length });
    return { items: results, total: results.length };
  }

  private async requireClassAccess(schoolId: string, userId: string, classGroupId: string) {
    const classGroup = await this.prisma.classGroup.findFirst({
      where: { schoolId, id: classGroupId },
      select: { id: true, teacher: { select: { person: { select: { userId: true } } } } },
    });
    if (!classGroup) throw new NotFoundException("Class group not found.");
    const roles = await this.getRoleCodes(schoolId, userId);
    if (roles.some((role) => CLASS_MANAGER_ROLES.includes(role))) return classGroup;
    if (!roles.includes("TEACHER") || classGroup.teacher.person.userId !== userId) {
      await this.auditDenied(schoolId, userId, "academic.class.access_denied", classGroupId);
      throw new ForbiddenException("Only the assigned teacher or academic leadership may access this class.");
    }
    return classGroup;
  }

  private async requireRoles(schoolId: string, userId: string, allowed: string[], action: string): Promise<string[]> {
    const roles = await this.getRoleCodes(schoolId, userId);
    if (!roles.some((role) => allowed.includes(role))) {
      await this.auditDenied(schoolId, userId, action);
      throw new ForbiddenException("This academic operation is not permitted for your school role.");
    }
    return roles;
  }

  private async getRoleCodes(schoolId: string, userId: string): Promise<string[]> {
    const membership = await this.prisma.schoolMembership.findFirst({
      where: { schoolId, userId, status: "active" },
      select: { membershipRoles: { select: { role: { select: { code: true } } } } },
    });
    return membership?.membershipRoles.map(({ role }) => role.code) ?? [];
  }

  private auditDenied(schoolId: string, userId: string, action: string, entityId?: string) {
    return this.prisma.auditEvent.create({
      data: {
        schoolId,
        actorUserId: userId,
        action,
        entityType: "academic_record",
        entityId,
        metadata: { reason: "role_or_assignment_required" },
      },
    });
  }

  private auditRead(schoolId: string, userId: string, entityId: string, action: string, metadata: object) {
    return this.prisma.auditEvent.create({
      data: { schoolId, actorUserId: userId, action, entityType: "academic_record", entityId, metadata },
    });
  }
}
