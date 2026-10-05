import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  AttendanceMarkDto,
  AttendanceReportQueryDto,
  AttendanceSessionsQueryDto,
  CreateAttendanceInterventionDto,
  CreateAttendanceSessionDto,
} from "./attendance.dto";

const PERSISTENT_ABSENCE_THRESHOLD = 0.9;
const ATTENDANCE_MANAGEMENT_ROLES = ["SUPER_ADMIN", "HEADTEACHER", "SLT", "ADMIN", "ATTENDANCE_OFFICER"];
const ATTENDANCE_READ_ROLES = [...ATTENDANCE_MANAGEMENT_ROLES, "TEACHER"];

type SessionRecordInput = AttendanceMarkDto & {
  authorizationStatus?: "not_required" | "pending" | "authorized" | "unauthorized";
};

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function reportRange(period: "day" | "week" | "month", value?: string) {
  const reference = dateOnly(value ?? new Date().toISOString().slice(0, 10));
  const startsOn = new Date(reference);
  const endsOn = new Date(reference);

  if (period === "week") {
    const daysSinceMonday = (reference.getUTCDay() + 6) % 7;
    startsOn.setUTCDate(reference.getUTCDate() - daysSinceMonday);
    endsOn.setUTCDate(startsOn.getUTCDate() + 6);
  } else if (period === "month") {
    startsOn.setUTCDate(1);
    endsOn.setUTCMonth(endsOn.getUTCMonth() + 1, 0);
  }

  return { startsOn, endsOn };
}

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  async listCodes(schoolId: string, userId: string) {
    await this.requireAttendanceRole(schoolId, userId, ATTENDANCE_READ_ROLES);
    return this.prisma.attendanceCode.findMany({
      where: { schoolId },
      orderBy: { code: "asc" },
      select: {
        code: true,
        description: true,
        markType: true,
        countsAsPresent: true,
      },
    });
  }

  async listClassGroups(schoolId: string, userId: string) {
    const roles = await this.requireAttendanceRole(schoolId, userId, ATTENDANCE_READ_ROLES);
    const teacherOnly = roles.includes("TEACHER") && !roles.some((role) => ATTENDANCE_MANAGEMENT_ROLES.includes(role));
    const items = await this.prisma.classGroup.findMany({
      where: {
        schoolId,
        ...(teacherOnly ? { teacher: { person: { userId } } } : {}),
      },
      orderBy: [{ yearGroup: { sortOrder: "asc" } }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        yearGroup: { select: { code: true, name: true } },
        subject: { select: { code: true, name: true } },
      },
    });
    return { items, total: items.length };
  }

  async createSession(schoolId: string, userId: string, input: CreateAttendanceSessionDto) {
    const roles = await this.getSchoolRoles(schoolId, userId);
    const sessionDate = dateOnly(input.sessionDate);
    const isLesson = input.sessionType === "lesson";
    if (isLesson !== Boolean(input.classGroupId && input.lessonPeriod)) {
      throw new BadRequestException("Lesson sessions require a class group and period; registration sessions must not include them.");
    }
    if (!isLesson && (input.classGroupId || input.lessonPeriod)) {
      throw new BadRequestException("Class group and period are only valid for lesson sessions.");
    }

    if (input.classGroupId) {
      const classGroup = await this.prisma.classGroup.findFirst({
        where: { schoolId, id: input.classGroupId },
        select: { id: true },
      });
      if (!classGroup) {
        throw new BadRequestException("Lesson class group must belong to this school.");
      }
    }
    if (roles.some((role) => ATTENDANCE_MANAGEMENT_ROLES.includes(role))) {
      // Leadership, administrators and attendance officers can create registration or lesson sessions.
    } else if (roles.includes("TEACHER") && isLesson && input.classGroupId) {
      await this.requireAssignedClass(schoolId, userId, input.classGroupId);
    } else {
      await this.denyAttendanceAccess(schoolId, userId);
    }
    const sessionKey = isLesson
      ? `lesson:${input.classGroupId}:${input.lessonPeriod}`
      : "registration";

    return this.prisma.attendanceSession.upsert({
      where: {
        schoolId_sessionDate_sessionType_sessionKey: {
          schoolId,
          sessionDate,
          sessionType: input.sessionType,
          sessionKey,
        },
      },
      create: {
        schoolId,
        sessionDate,
        sessionType: input.sessionType,
        sessionKey,
        classGroupId: input.classGroupId,
        lessonPeriod: input.lessonPeriod,
      },
      update: {},
    });
  }

  async listSessions(schoolId: string, userId: string, query: AttendanceSessionsQueryDto) {
    const roles = await this.requireAttendanceRole(schoolId, userId, ATTENDANCE_READ_ROLES);
    let classGroupIds: string[] | undefined;
    if (roles.includes("TEACHER") && !roles.some((role) => ATTENDANCE_MANAGEMENT_ROLES.includes(role))) {
      if (query.classGroupId) {
        await this.requireAssignedClass(schoolId, userId, query.classGroupId);
        classGroupIds = [query.classGroupId];
      } else {
        const assignedClasses = await this.prisma.classGroup.findMany({
          where: { schoolId, teacher: { person: { userId } } },
          select: { id: true },
        });
        classGroupIds = assignedClasses.map(({ id }) => id);
        if (classGroupIds.length === 0) return [];
      }
    }

    return this.prisma.attendanceSession.findMany({
      where: {
        schoolId,
        ...(query.date ? { sessionDate: dateOnly(query.date) } : {}),
        ...(query.classGroupId ? { classGroupId: query.classGroupId } : {}),
        ...(classGroupIds ? { classGroupId: { in: classGroupIds } } : {}),
        ...(query.yearGroupId
          ? {
              records: {
                some: {
                  pupil: {
                    enrolments: {
                      some: { schoolId, yearGroupId: query.yearGroupId, status: "active" },
                    },
                  },
                },
              },
            }
          : {}),
      },
      orderBy: [{ sessionDate: "desc" }, { sessionType: "asc" }],
      include: { _count: { select: { records: true } } },
    });
  }

  async getSessionRegister(schoolId: string, userId: string, sessionId: string) {
    const roles = await this.requireAttendanceRole(schoolId, userId, ATTENDANCE_READ_ROLES);
    const session = await this.prisma.attendanceSession.findFirst({
      where: { schoolId, id: sessionId },
      select: { id: true, sessionDate: true, sessionType: true, classGroupId: true, lessonPeriod: true },
    });
    if (!session) throw new NotFoundException("Attendance session not found.");

    const teacherOnly = roles.includes("TEACHER") && !roles.some((role) => ATTENDANCE_MANAGEMENT_ROLES.includes(role));
    if (teacherOnly) {
      if (!session.classGroupId) return this.denyAttendanceAccess(schoolId, userId);
      await this.requireAssignedClass(schoolId, userId, session.classGroupId);
    }

    const pupils = await this.prisma.pupilProfile.findMany({
      where: {
        schoolId,
        status: "enrolled",
        ...(session.classGroupId
          ? { classMemberships: { some: { classGroupId: session.classGroupId } } }
          : {}),
      },
      orderBy: [{ person: { lastName: "asc" } }, { person: { legalFirstName: "asc" } }],
      select: {
        id: true,
        admissionNumber: true,
        person: { select: { legalFirstName: true, preferredName: true, lastName: true } },
        attendanceRecords: {
          where: { attendanceSessionId: session.id },
          take: 1,
          select: {
            attendanceCode: true,
            reason: true,
            authorizationStatus: true,
          },
        },
      },
    });

    return {
      session,
      items: pupils.map((pupil) => ({
        pupilId: pupil.id,
        admissionNumber: pupil.admissionNumber,
        name: this.personName(pupil.person),
        attendanceCode: pupil.attendanceRecords[0]?.attendanceCode ?? null,
        reason: pupil.attendanceRecords[0]?.reason ?? null,
        authorizationStatus: pupil.attendanceRecords[0]?.authorizationStatus ?? null,
      })),
    };
  }

  async getTeacherSummary(schoolId: string, userId: string, query: AttendanceReportQueryDto) {
    const roles = await this.requireAttendanceRole(schoolId, userId, ["TEACHER"]);
    if (!roles.includes("TEACHER")) {
      await this.denyAttendanceAccess(schoolId, userId);
    }
    const classes = await this.prisma.classGroup.findMany({
      where: { schoolId, teacher: { person: { userId } } },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        yearGroup: { select: { code: true, name: true } },
        subject: { select: { code: true, name: true } },
      },
    });
    const { startsOn, endsOn } = reportRange(query.period, query.date);
    const records = classes.length
      ? await this.prisma.attendanceRecord.findMany({
          where: {
            schoolId,
            session: {
              classGroupId: { in: classes.map(({ id }) => id) },
              sessionDate: { gte: startsOn, lte: endsOn },
            },
          },
          select: {
            pupilId: true,
            attendanceCode: true,
            code: { select: { countsAsPresent: true } },
            session: { select: { classGroupId: true } },
            pupil: {
              select: {
                admissionNumber: true,
                person: { select: { legalFirstName: true, preferredName: true, lastName: true } },
              },
            },
          },
        })
      : [];

    const classSummaries = new Map(classes.map((classGroup) => [classGroup.id, {
      ...classGroup,
      totalMarks: 0,
      presentMarks: 0,
      pupils: new Map<string, {
        pupilId: string;
        admissionNumber: string;
        name: string;
        totalMarks: number;
        presentMarks: number;
      }>(),
    }]));

    for (const record of records) {
      const classSummary = classSummaries.get(record.session.classGroupId ?? "");
      if (!classSummary) continue;
      classSummary.totalMarks += 1;
      if (record.code.countsAsPresent) classSummary.presentMarks += 1;
      const pupil = classSummary.pupils.get(record.pupilId) ?? {
        pupilId: record.pupilId,
        admissionNumber: record.pupil.admissionNumber,
        name: this.personName(record.pupil.person),
        totalMarks: 0,
        presentMarks: 0,
      };
      pupil.totalMarks += 1;
      if (record.code.countsAsPresent) pupil.presentMarks += 1;
      classSummary.pupils.set(record.pupilId, pupil);
    }

    return {
      period: query.period,
      startsOn: startsOn.toISOString().slice(0, 10),
      endsOn: endsOn.toISOString().slice(0, 10),
      classes: Array.from(classSummaries.values()).map((classSummary) => ({
        id: classSummary.id,
        code: classSummary.code,
        yearGroup: classSummary.yearGroup,
        subject: classSummary.subject,
        totalMarks: classSummary.totalMarks,
        presentMarks: classSummary.presentMarks,
        attendanceRate: classSummary.totalMarks ? classSummary.presentMarks / classSummary.totalMarks : null,
        pupils: Array.from(classSummary.pupils.values())
          .map((pupil) => ({
            ...pupil,
            attendanceRate: pupil.totalMarks ? pupil.presentMarks / pupil.totalMarks : null,
          }))
          .sort((left, right) => left.attendanceRate! - right.attendanceRate!),
      })),
    };
  }

  async upsertSessionRecords(
    schoolId: string,
    sessionId: string,
    actorUserId: string,
    records: SessionRecordInput[],
  ) {
    if (new Set(records.map(({ pupilId }) => pupilId)).size !== records.length) {
      throw new BadRequestException("A pupil may only appear once in a session update.");
    }

    const session = await this.prisma.attendanceSession.findFirst({
      where: { schoolId, id: sessionId },
      select: { id: true, sessionDate: true, classGroupId: true },
    });
    if (!session) {
      throw new NotFoundException("Attendance session not found.");
    }
    const roles = await this.getSchoolRoles(schoolId, actorUserId);
    if (!roles.some((role) => ATTENDANCE_MANAGEMENT_ROLES.includes(role))) {
      if (!roles.includes("TEACHER")) return this.denyAttendanceAccess(schoolId, actorUserId);
      if (!session.classGroupId) return this.denyAttendanceAccess(schoolId, actorUserId);
      await this.requireAssignedClass(schoolId, actorUserId, session.classGroupId);
    }

    const pupilIds = records.map(({ pupilId }) => pupilId);
    const codes = await this.prisma.attendanceCode.findMany({
      where: { schoolId, code: { in: records.map(({ attendanceCode }) => attendanceCode) } },
      select: { code: true, markType: true, countsAsPresent: true },
    });
    const codesByValue = new Map(codes.map((code) => [code.code, code]));
    const pupils = await this.prisma.pupilProfile.findMany({
      where: { schoolId, id: { in: pupilIds } },
      select: { id: true },
    });
    const validPupils = new Set(pupils.map(({ id }) => id));
    if (session.classGroupId) {
      const memberships = await this.prisma.classMembership.findMany({
        where: { schoolId, classGroupId: session.classGroupId, pupilId: { in: pupilIds } },
        select: { pupilId: true },
      });
      const classPupilIds = new Set(memberships.map(({ pupilId }) => pupilId));
      if (pupilIds.some((pupilId) => !classPupilIds.has(pupilId))) {
        throw new BadRequestException("Every pupil must belong to the lesson class group.");
      }
    }

    for (const record of records) {
      const code = codesByValue.get(record.attendanceCode);
      if (!code) {
        throw new BadRequestException(`Attendance code ${record.attendanceCode} is not configured for this school.`);
      }
      if (!validPupils.has(record.pupilId)) {
        throw new BadRequestException("Every pupil must belong to the selected school.");
      }
      if (!["present", "late", "authorised_absence", "unauthorised_absence"].includes(code.markType)) {
        throw new BadRequestException(`Attendance mark type ${code.markType} is not supported.`);
      }
      if ((code.markType === "present" || code.markType === "late") !== code.countsAsPresent) {
        throw new BadRequestException("Attendance code mark type and present-counting rule do not match.");
      }
      const authorizationStatus = this.resolveAuthorizationStatus(code, record.authorizationStatus);
      if (code.countsAsPresent && authorizationStatus !== "not_required") {
        throw new BadRequestException("Present and late marks cannot have an absence authorization status.");
      }
      if (code.markType === "unauthorised_absence" && authorizationStatus !== "unauthorized") {
        throw new BadRequestException("Unauthorised absence codes require unauthorized status.");
      }
      if (code.markType === "authorised_absence" && !["pending", "authorized"].includes(authorizationStatus)) {
        throw new BadRequestException("Authorised absence codes require pending or authorized status.");
      }
    }

    return this.prisma.$transaction(async (transaction) => {
      const existingRecords = await transaction.attendanceRecord.findMany({
        where: { schoolId, attendanceSessionId: sessionId, pupilId: { in: pupilIds } },
        include: { notes: { orderBy: { createdAt: "desc" }, take: 1 } },
      });
      const existingByPupil = new Map(existingRecords.map((record) => [record.pupilId, record]));
      const guardians = pupilIds.length
        ? await transaction.pupilContact.findMany({
            where: {
              schoolId,
              pupilId: { in: pupilIds },
              canViewPortal: true,
              startsOn: { lte: dateOnly(new Date().toISOString().slice(0, 10)) },
              OR: [
                { endsOn: null },
                { endsOn: { gte: dateOnly(new Date().toISOString().slice(0, 10)) } },
              ],
            },
            select: { pupilId: true, guardianPersonId: true },
          })
        : [];
      const guardiansByPupil = new Map<string, string[]>();
      for (const guardian of guardians) {
        const recipients = guardiansByPupil.get(guardian.pupilId) ?? [];
        recipients.push(guardian.guardianPersonId);
        guardiansByPupil.set(guardian.pupilId, recipients);
      }

      const saved = [];
      let changedCount = 0;
      for (const input of records) {
        const code = codesByValue.get(input.attendanceCode)!;
        const previous = existingByPupil.get(input.pupilId);
        const authorizationStatus = this.resolveAuthorizationStatus(code, input.authorizationStatus);
        const note = input.note?.trim() || null;
        const reason = input.reason?.trim() || null;
        const changed = !previous ||
          previous.attendanceCode !== input.attendanceCode ||
          previous.reason !== reason ||
          previous.note !== note ||
          previous.authorizationStatus !== authorizationStatus;

        if (!changed && previous) {
          saved.push(previous);
          continue;
        }

        let revisionId: string | undefined;
        if (previous) {
          const revision = await transaction.attendanceRecordRevision.create({
            data: {
              schoolId,
              attendanceRecordId: previous.id,
              attendanceCode: previous.attendanceCode,
              reason: previous.reason,
              note: previous.note,
              authorizationStatus: previous.authorizationStatus,
              changedByUserId: actorUserId,
            },
            select: { id: true },
          });
          revisionId = revision.id;
        }

        const updated = await transaction.attendanceRecord.upsert({
          where: {
            schoolId_attendanceSessionId_pupilId: {
              schoolId,
              attendanceSessionId: sessionId,
              pupilId: input.pupilId,
            },
          },
          create: {
            schoolId,
            attendanceSessionId: sessionId,
            pupilId: input.pupilId,
            attendanceCode: input.attendanceCode,
            reason,
            note,
            authorizationStatus,
            markedByUserId: actorUserId,
          },
          update: {
            attendanceCode: input.attendanceCode,
            reason,
            note,
            authorizationStatus,
            markedByUserId: actorUserId,
            markedAt: new Date(),
          },
        });
        if (note) {
          await transaction.attendanceNote.create({
            data: {
              schoolId,
              attendanceRecordId: updated.id,
              authorUserId: actorUserId,
              body: note,
            },
          });
        }

        await transaction.auditEvent.create({
          data: {
            schoolId,
            actorUserId,
            action: previous ? "attendance.record.corrected" : "attendance.record.marked",
            entityType: "attendance_record",
            entityId: updated.id,
            metadata: {
              before: previous
                ? {
                    attendanceCode: previous.attendanceCode,
                    authorizationStatus: previous.authorizationStatus,
                  }
                : null,
              after: { attendanceCode: input.attendanceCode, authorizationStatus },
            },
          },
        });

        const recipients = guardiansByPupil.get(input.pupilId) ?? [];
        if (
          recipients.length > 0 &&
          (!code.countsAsPresent || (previous && previous.attendanceCode !== input.attendanceCode))
        ) {
          await transaction.outboxEvent.create({
            data: {
              schoolId,
              eventType: "attendance.record.changed",
              aggregateType: "attendance_record",
              aggregateId: updated.id,
              idempotencyKey: `attendance:${updated.id}:${revisionId ?? "created"}`,
              payload: {
                pupilId: input.pupilId,
                sessionId,
                sessionDate: session.sessionDate.toISOString().slice(0, 10),
                attendanceCode: input.attendanceCode,
                authorizationStatus,
                recipientPersonIds: recipients,
              },
            },
          });
        }

        saved.push(updated);
        changedCount += 1;
      }

      return { total: saved.length, changed: changedCount, items: saved };
    });
  }

  async getPupilAttendance(schoolId: string, userId: string, pupilId: string) {
    const roles = await this.requireAttendanceRole(schoolId, userId, ATTENDANCE_READ_ROLES);
    if (roles.includes("TEACHER") && !roles.some((role) => ATTENDANCE_MANAGEMENT_ROLES.includes(role))) {
      await this.requireAssignedPupil(schoolId, userId, pupilId);
    }
    const pupil = await this.prisma.pupilProfile.findFirst({
      where: { schoolId, id: pupilId },
      select: { id: true },
    });
    if (!pupil) {
      throw new NotFoundException("Pupil not found.");
    }

    return this.prisma.attendanceRecord.findMany({
      where: { schoolId, pupilId },
      orderBy: { session: { sessionDate: "desc" } },
      select: {
        id: true,
        attendanceCode: true,
        reason: true,
        authorizationStatus: true,
        markedAt: true,
        session: { select: { sessionDate: true, sessionType: true } },
        code: { select: { description: true, markType: true, countsAsPresent: true } },
        notes: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, createdAt: true } },
      },
    });
  }

  async getParentPupilAttendance(userId: string, pupilId: string) {
    const contact = await this.prisma.pupilContact.findFirst({
      where: {
        pupilId,
        canViewPortal: true,
        startsOn: { lte: dateOnly(new Date().toISOString().slice(0, 10)) },
        OR: [
          { endsOn: null },
          { endsOn: { gte: dateOnly(new Date().toISOString().slice(0, 10)) } },
        ],
        guardian: { person: { userId } },
      },
      select: { schoolId: true },
    });
    if (!contact) {
      throw new ForbiddenException("You do not have portal access to this pupil's attendance.");
    }
    await this.requireAttendanceRole(contact.schoolId, userId, ["PARENT"]);

    return this.prisma.attendanceRecord.findMany({
      where: { schoolId: contact.schoolId, pupilId },
      orderBy: { session: { sessionDate: "desc" } },
      take: 30,
      select: {
        attendanceCode: true,
        markedAt: true,
        session: { select: { sessionDate: true, sessionType: true } },
        code: { select: { description: true, markType: true } },
      },
    });
  }

  async getStudentAttendance(userId: string) {
    const memberships = await this.prisma.schoolMembership.findMany({
      where: {
        userId,
        status: "active",
        membershipRoles: { some: { role: { code: "STUDENT" } } },
      },
      select: { schoolId: true },
    });
    if (memberships.length === 0) {
      throw new ForbiddenException("Student membership is required to view personal attendance.");
    }

    const schoolIds = memberships.map(({ schoolId }) => schoolId);
    const pupil = await this.prisma.pupilProfile.findFirst({
      where: { schoolId: { in: schoolIds }, person: { userId } },
      select: { id: true, schoolId: true },
    });
    if (!pupil) {
      return { pupilId: null, items: [] };
    }

    const items = await this.prisma.attendanceRecord.findMany({
      where: { schoolId: pupil.schoolId, pupilId: pupil.id },
      orderBy: { session: { sessionDate: "desc" } },
      take: 30,
      select: {
        attendanceCode: true,
        markedAt: true,
        session: { select: { sessionDate: true, sessionType: true } },
        code: { select: { description: true, markType: true } },
      },
    });
    return { pupilId: pupil.id, items };
  }

  async createIntervention(
    schoolId: string,
    pupilId: string,
    actorUserId: string,
    input: CreateAttendanceInterventionDto,
  ) {
    await this.requireAttendanceRole(schoolId, actorUserId, ATTENDANCE_MANAGEMENT_ROLES);
    const startsOn = dateOnly(input.startsOn);
    const endsOn = input.endsOn ? dateOnly(input.endsOn) : null;
    if (endsOn && endsOn < startsOn) {
      throw new BadRequestException("Intervention end date cannot precede its start date.");
    }

    const pupil = await this.prisma.pupilProfile.findFirst({
      where: { schoolId, id: pupilId },
      select: { id: true },
    });
    if (!pupil) {
      throw new NotFoundException("Pupil not found.");
    }

    const intervention = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.attendanceIntervention.create({
        data: { schoolId, pupilId, startsOn, endsOn, reason: input.reason.trim(), createdByUserId: actorUserId },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId,
          action: "attendance.intervention.created",
          entityType: "attendance_intervention",
          entityId: created.id,
          metadata: { pupilId, startsOn: input.startsOn, endsOn: input.endsOn ?? null },
        },
      });
      return created;
    });
    return intervention;
  }

  async getReport(schoolId: string, userId: string, query: AttendanceReportQueryDto) {
    const roles = await this.requireAttendanceRole(schoolId, userId, ATTENDANCE_READ_ROLES);
    const isTeacherOnly = roles.includes("TEACHER") && !roles.some((role) => ATTENDANCE_MANAGEMENT_ROLES.includes(role));
    if (isTeacherOnly) {
      if (!query.classGroupId) {
        throw new BadRequestException("Teachers must select an assigned class group.");
      }
      await this.requireAssignedClass(schoolId, userId, query.classGroupId);
    }
    const { startsOn, endsOn } = reportRange(query.period, query.date);
    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        schoolId,
        ...(query.classGroupId ? { session: { classGroupId: query.classGroupId, sessionDate: { gte: startsOn, lte: endsOn } } } : {
          session: { sessionDate: { gte: startsOn, lte: endsOn } },
        }),
      },
      select: {
        pupilId: true,
        attendanceCode: true,
        code: { select: { countsAsPresent: true } },
        session: { select: { sessionDate: true, sessionType: true } },
        pupil: {
          select: {
            admissionNumber: true,
            person: { select: { legalFirstName: true, preferredName: true, lastName: true } },
            enrolments: {
              where: { status: "active" },
              orderBy: { startsOn: "desc" },
              take: 1,
              select: {
                yearGroup: { select: { id: true, code: true, name: true } },
                form: { select: { id: true, code: true } },
              },
            },
          },
        },
      },
    });

    const reportingDate = dateOnly(query.date ?? new Date().toISOString().slice(0, 10));
    const currentAcademicYear = await this.prisma.academicYear.findFirst({
      where: { schoolId, startsOn: { lte: reportingDate }, endsOn: { gte: reportingDate } },
      orderBy: { startsOn: "desc" },
      select: { startsOn: true },
    });
    const fallbackStartYear = reportingDate.getUTCMonth() >= 8
      ? reportingDate.getUTCFullYear()
      : reportingDate.getUTCFullYear() - 1;
    const yearStartsOn = currentAcademicYear?.startsOn ?? dateOnly(`${fallbackStartYear}-09-01`);
    const yearToDateRecords = await this.prisma.attendanceRecord.findMany({
      where: {
        schoolId,
        ...(query.classGroupId ? { session: { classGroupId: query.classGroupId, sessionDate: { gte: yearStartsOn, lte: reportingDate } } } : {
          session: { sessionDate: { gte: yearStartsOn, lte: reportingDate } },
        }),
      },
      select: {
        pupilId: true,
        code: { select: { countsAsPresent: true } },
        pupil: {
          select: {
            admissionNumber: true,
            person: { select: { legalFirstName: true, preferredName: true, lastName: true } },
          },
        },
      },
    });

    const byCode = new Map<string, number>();
    const byYearGroup = new Map<string, { id: string; code: string; name: string; presentMarks: number; totalMarks: number }>();
    const byForm = new Map<string, { id: string; code: string; yearGroupCode: string; presentMarks: number; totalMarks: number }>();
    const byPupil = new Map<string, { pupilId: string; admissionNumber: string; name: string; present: number; total: number }>();
    for (const record of records) {
      byCode.set(record.attendanceCode, (byCode.get(record.attendanceCode) ?? 0) + 1);

      const enrolment = record.pupil.enrolments[0];
      if (enrolment) {
        const yearGroup = byYearGroup.get(enrolment.yearGroup.id) ?? {
          id: enrolment.yearGroup.id,
          code: enrolment.yearGroup.code,
          name: enrolment.yearGroup.name,
          presentMarks: 0,
          totalMarks: 0,
        };
        yearGroup.totalMarks += 1;
        if (record.code.countsAsPresent) yearGroup.presentMarks += 1;
        byYearGroup.set(yearGroup.id, yearGroup);

        const form = byForm.get(enrolment.form.id) ?? {
          id: enrolment.form.id,
          code: enrolment.form.code,
          yearGroupCode: enrolment.yearGroup.code,
          presentMarks: 0,
          totalMarks: 0,
        };
        form.totalMarks += 1;
        if (record.code.countsAsPresent) form.presentMarks += 1;
        byForm.set(form.id, form);
      }
    }

    for (const record of yearToDateRecords) {
      const pupil = byPupil.get(record.pupilId) ?? {
        pupilId: record.pupilId,
        admissionNumber: record.pupil.admissionNumber,
        name: this.personName(record.pupil.person),
        present: 0,
        total: 0,
      };
      pupil.total += 1;
      if (record.code.countsAsPresent) pupil.present += 1;
      byPupil.set(record.pupilId, pupil);
    }

    const persistentAbsence = Array.from(byPupil.values())
      .map((pupil) => ({
        ...pupil,
        attendanceRate: pupil.total ? pupil.present / pupil.total : 1,
      }))
      .filter((pupil) => pupil.attendanceRate < PERSISTENT_ABSENCE_THRESHOLD)
      .sort((left, right) => left.attendanceRate - right.attendanceRate);

    return {
      period: query.period,
      startsOn: startsOn.toISOString().slice(0, 10),
      endsOn: endsOn.toISOString().slice(0, 10),
      totalMarks: records.length,
      byCode: Array.from(byCode, ([code, count]) => ({ code, count })).sort((left, right) => left.code.localeCompare(right.code)),
      byYearGroup: Array.from(byYearGroup.values()).map((group) => ({
        ...group,
        attendanceRate: group.totalMarks ? group.presentMarks / group.totalMarks : 0,
      })).sort((left, right) => left.code.localeCompare(right.code)),
      byForm: Array.from(byForm.values()).map((form) => ({
        ...form,
        attendanceRate: form.totalMarks ? form.presentMarks / form.totalMarks : 0,
      })).sort((left, right) => left.code.localeCompare(right.code)),
      persistentAbsenceThreshold: PERSISTENT_ABSENCE_THRESHOLD,
      persistentAbsence,
    };
  }

  private async getSchoolRoles(schoolId: string, userId: string): Promise<string[]> {
    const membership = await this.prisma.schoolMembership.findFirst({
      where: { schoolId, userId, status: "active" },
      select: { membershipRoles: { select: { role: { select: { code: true } } } } },
    });
    return membership?.membershipRoles.map(({ role }) => role.code) ?? [];
  }

  private personName(person: { legalFirstName: string; preferredName: string | null; lastName: string }) {
    return `${person.preferredName || person.legalFirstName} ${person.lastName}`.trim();
  }

  private async requireAttendanceRole(schoolId: string, userId: string, allowedRoles: string[]): Promise<string[]> {
    const roles = await this.getSchoolRoles(schoolId, userId);
    if (!roles.some((role) => allowedRoles.includes(role))) {
      await this.denyAttendanceAccess(schoolId, userId);
    }
    return roles;
  }

  private async requireAssignedClass(schoolId: string, userId: string, classGroupId: string): Promise<void> {
    const assignment = await this.prisma.classGroup.findFirst({
      where: { schoolId, id: classGroupId, teacher: { person: { userId } } },
      select: { id: true },
    });
    if (!assignment) {
      await this.denyAttendanceAccess(schoolId, userId);
    }
  }

  private async requireAssignedPupil(schoolId: string, userId: string, pupilId: string): Promise<void> {
    const assignment = await this.prisma.classMembership.findFirst({
      where: { schoolId, pupilId, classGroup: { teacher: { person: { userId } } } },
      select: { pupilId: true },
    });
    if (!assignment) {
      await this.denyAttendanceAccess(schoolId, userId);
    }
  }

  private async denyAttendanceAccess(schoolId: string, userId: string): Promise<never> {
    await this.prisma.auditEvent.create({
      data: {
        schoolId,
        actorUserId: userId,
        action: "attendance.access.denied",
        entityType: "attendance",
        metadata: { reason: "role_or_assignment_required" },
      },
    });
    throw new ForbiddenException("Attendance access is not permitted for your school role or class assignment.");
  }

  private resolveAuthorizationStatus(
    code: { markType: string; countsAsPresent: boolean },
    requested?: SessionRecordInput["authorizationStatus"],
  ): "not_required" | "pending" | "authorized" | "unauthorized" {
    if (requested) return requested;
    if (code.markType === "unauthorised_absence") return "unauthorized";
    if (code.markType === "authorised_absence") return "pending";
    return "not_required";
  }
}
