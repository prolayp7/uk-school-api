import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { hasAnySchoolPermission, requireAnySchoolPermission } from "../auth/school-permissions";
import { PrismaService } from "../prisma/prisma.service";
import {
  AttendanceMarkDto,
  AttendanceReportQueryDto,
  AttendanceSessionsQueryDto,
  CreateAttendanceInterventionDto,
  CreateAttendanceSessionDto,
} from "./attendance.dto";

const PERSISTENT_ABSENCE_THRESHOLD = 0.9;

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
    await this.requireAttendanceRole(schoolId, userId, [
      "attendance.read",
      "attendance.register",
      "attendance.manage",
    ]);
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
    const roles = await this.requireAttendanceRole(schoolId, userId, [
      "attendance.read",
      "attendance.register",
      "attendance.manage",
    ]);
    const teacherOnly =
      roles.includes("TEACHER") &&
      !(await hasAnySchoolPermission(this.prisma, schoolId, userId, ["attendance.manage"]));
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
    const canManage = await hasAnySchoolPermission(
      this.prisma,
      schoolId,
      userId,
      ["attendance.manage"],
    );
    const canRegister = await hasAnySchoolPermission(
      this.prisma,
      schoolId,
      userId,
      ["attendance.register"],
    );
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
    if (!canManage && canRegister && roles.includes("TEACHER") && isLesson && input.classGroupId) {
      await this.requireAssignedClass(schoolId, userId, input.classGroupId);
    } else if (!canManage) {
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
    const roles = await this.requireAttendanceRole(schoolId, userId, [
      "attendance.read",
      "attendance.register",
      "attendance.manage",
    ]);
    const canManage = await hasAnySchoolPermission(
      this.prisma,
      schoolId,
      userId,
      ["attendance.manage"],
    );
    let classGroupIds: string[] | undefined;
    if (roles.includes("TEACHER") && !canManage) {
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
    const roles = await this.requireAttendanceRole(schoolId, userId, [
      "attendance.read",
      "attendance.register",
      "attendance.manage",
    ]);
    const session = await this.prisma.attendanceSession.findFirst({
      where: { schoolId, id: sessionId },
      select: { id: true, sessionDate: true, sessionType: true, classGroupId: true, lessonPeriod: true },
    });
    if (!session) throw new NotFoundException("Attendance session not found.");

    const canManage = await hasAnySchoolPermission(
      this.prisma,
      schoolId,
      userId,
      ["attendance.manage"],
    );
    const teacherOnly = roles.includes("TEACHER") && !canManage;
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
            id: true,
            attendanceCode: true,
            reason: true,
            note: true,
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
        attendanceRecordId: pupil.attendanceRecords[0]?.id ?? null,
        attendanceCode: pupil.attendanceRecords[0]?.attendanceCode ?? null,
        reason: pupil.attendanceRecords[0]?.reason ?? null,
        note: pupil.attendanceRecords[0]?.note ?? null,
        authorizationStatus: pupil.attendanceRecords[0]?.authorizationStatus ?? null,
      })),
    };
  }

  async getTeacherSummary(schoolId: string, userId: string, query: AttendanceReportQueryDto) {
    const roles = await this.requireAttendanceRole(schoolId, userId, ["attendance.read"]);
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
              sessionType: "lesson",
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
    const canManage = await hasAnySchoolPermission(
      this.prisma,
      schoolId,
      actorUserId,
      ["attendance.manage"],
    );
    const canRegister = await hasAnySchoolPermission(
      this.prisma,
      schoolId,
      actorUserId,
      ["attendance.register"],
    );
    if (!canManage) {
      if (!roles.includes("TEACHER") || !canRegister) {
        return this.denyAttendanceAccess(schoolId, actorUserId);
      }
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
              guardian: {
                person: {
                  user: {
                    is: {
                      status: "active",
                      memberships: {
                        some: {
                          schoolId,
                          status: "active",
                          membershipRoles: { some: { role: { code: "PARENT" } } },
                        },
                      },
                    },
                  },
                },
              },
              startsOn: { lte: dateOnly(new Date().toISOString().slice(0, 10)) },
              OR: [
                { endsOn: null },
                { endsOn: { gte: dateOnly(new Date().toISOString().slice(0, 10)) } },
              ],
            },
            select: {
              pupilId: true,
              guardian: { select: { person: { select: { userId: true } } } },
            },
          })
        : [];
      const guardiansByPupil = new Map<string, string[]>();
      for (const guardian of guardians) {
        const recipientUserId = guardian.guardian.person.userId;
        if (!recipientUserId) continue;
        const recipients = guardiansByPupil.get(guardian.pupilId) ?? [];
        if (!recipients.includes(recipientUserId)) recipients.push(recipientUserId);
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
          for (const recipientUserId of recipients) {
            const notification = await transaction.notification.create({
              data: {
                schoolId,
                recipientUserId,
                title: "Attendance update recorded",
                body: `An attendance update for your child was recorded on ${session.sessionDate.toISOString().slice(0, 10)}. Sign in to the school portal to view the details.`,
              },
              select: { id: true },
            });
            await transaction.notificationDelivery.create({
              data: {
                schoolId,
                notificationId: notification.id,
                idempotencyKey: `attendance-email:${updated.id}:${revisionId ?? "created"}:${recipientUserId}`,
              },
            });
            await transaction.outboxEvent.create({
              data: {
                schoolId,
                eventType: "notification.email",
                aggregateType: "notification",
                aggregateId: notification.id,
                idempotencyKey: `attendance-notification:${updated.id}:${revisionId ?? "created"}:${recipientUserId}`,
                payload: { notificationId: notification.id },
              },
            });
          }
        }

        saved.push(updated);
        changedCount += 1;
      }

      return { total: saved.length, changed: changedCount, items: saved };
    });
  }

  async getPupilAttendance(schoolId: string, userId: string, pupilId: string) {
    const roles = await this.requireAttendanceRole(schoolId, userId, [
      "attendance.read",
      "attendance.register",
      "attendance.manage",
    ]);
    const canManage = await hasAnySchoolPermission(
      this.prisma,
      schoolId,
      userId,
      ["attendance.manage"],
    );
    if (roles.includes("TEACHER") && !canManage) {
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
        revisions: {
          orderBy: { changedAt: "desc" },
          take: 5,
          select: {
            attendanceCode: true,
            reason: true,
            authorizationStatus: true,
            changedAt: true,
            code: { select: { description: true } },
          },
        },
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
    if (!(await this.getSchoolRoles(contact.schoolId, userId)).includes("PARENT")) {
      await this.denyAttendanceAccess(contact.schoolId, userId);
    }

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
    await this.requireAttendanceRole(schoolId, actorUserId, ["attendance.manage"]);
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
    const roles = await this.requireAttendanceRole(schoolId, userId, [
      "attendance.read",
      "attendance.register",
      "attendance.manage",
    ]);
    const canManage = await hasAnySchoolPermission(
      this.prisma,
      schoolId,
      userId,
      ["attendance.manage"],
    );
    const isTeacherOnly = roles.includes("TEACHER") && !canManage;
    if (isTeacherOnly) {
      if (!query.classGroupId) {
        throw new BadRequestException("Teachers must select an assigned class group.");
      }
      await this.requireAssignedClass(schoolId, userId, query.classGroupId);
    }
    const { startsOn, endsOn } = reportRange(query.period, query.date);
    const reportingDate = dateOnly(query.date ?? new Date().toISOString().slice(0, 10));
    const reportEndsOn = endsOn < reportingDate ? endsOn : reportingDate;
    const currentAcademicYear = await this.prisma.academicYear.findFirst({
      where: { schoolId, startsOn: { lte: reportingDate }, endsOn: { gte: reportingDate } },
      orderBy: { startsOn: "desc" },
      select: { startsOn: true },
    });
    const fallbackStartYear = reportingDate.getUTCMonth() >= 8
      ? reportingDate.getUTCFullYear()
      : reportingDate.getUTCFullYear() - 1;
    const yearStartsOn = currentAcademicYear?.startsOn ?? dateOnly(`${fallbackStartYear}-09-01`);
    const loadRegistrationWindow = async (windowStart: Date, windowEnd: Date) => {
      const [sessions, enrolments] = await Promise.all([
        this.prisma.attendanceSession.findMany({
          where: {
            schoolId,
            sessionKey: "registration",
            classGroupId: null,
            sessionType: { in: ["morning", "afternoon"] },
            sessionDate: { gte: windowStart, lte: windowEnd },
          },
          orderBy: [{ sessionDate: "asc" }, { sessionType: "asc" }],
          select: {
            sessionDate: true,
            records: {
              select: {
                pupilId: true,
                attendanceCode: true,
                code: { select: { countsAsPresent: true } },
              },
            },
          },
        }),
        this.prisma.pupilEnrolment.findMany({
          where: {
            schoolId,
            startsOn: { lte: windowEnd },
            OR: [{ endsOn: null }, { endsOn: { gte: windowStart } }],
          },
          select: {
            pupilId: true,
            startsOn: true,
            endsOn: true,
            yearGroup: { select: { id: true, code: true, name: true } },
            form: { select: { id: true, code: true } },
            pupil: {
              select: {
                admissionNumber: true,
                person: { select: { legalFirstName: true, preferredName: true, lastName: true } },
              },
            },
          },
        }),
      ]);
      const enrolmentsByPupil = new Map<string, typeof enrolments>();
      for (const enrolment of enrolments) {
        const pupilEnrolments = enrolmentsByPupil.get(enrolment.pupilId) ?? [];
        pupilEnrolments.push(enrolment);
        enrolmentsByPupil.set(enrolment.pupilId, pupilEnrolments);
      }
      for (const pupilEnrolments of enrolmentsByPupil.values()) {
        pupilEnrolments.sort((left, right) => right.startsOn.getTime() - left.startsOn.getTime());
      }
      return { sessions, enrolmentsByPupil };
    };
    const enrollmentForDate = (
      enrolmentsByPupil: Map<string, Array<{
        startsOn: Date;
        endsOn: Date | null;
        yearGroup: { id: string; code: string; name: string };
        form: { id: string; code: string };
        pupil: {
          admissionNumber: string;
          person: { legalFirstName: string; preferredName: string | null; lastName: string };
        };
      }>>,
      pupilId: string,
      sessionDate: Date,
    ) => enrolmentsByPupil.get(pupilId)?.find(({ startsOn: enrolledFrom, endsOn: enrolledTo }) =>
      enrolledFrom <= sessionDate && (!enrolledTo || enrolledTo >= sessionDate),
    );

    const reportWindow = await loadRegistrationWindow(startsOn, reportEndsOn);
    const yearToDateWindow = await loadRegistrationWindow(yearStartsOn, reportingDate);
    const byCode = new Map<string, number>();
    const byYearGroup = new Map<string, {
      id: string;
      code: string;
      name: string;
      presentMarks: number;
      totalMarks: number;
      presentSessions: number;
      possibleSessions: number;
    }>();
    const byForm = new Map<string, {
      id: string;
      code: string;
      yearGroupCode: string;
      presentMarks: number;
      totalMarks: number;
      presentSessions: number;
      possibleSessions: number;
    }>();
    let totalMarks = 0;
    let presentSessions = 0;
    let totalPossibleSessions = 0;
    for (const session of reportWindow.sessions) {
      const marksByPupil = new Map(session.records.map((record) => [record.pupilId, record]));
      totalMarks += session.records.length;
      for (const record of session.records) {
        byCode.set(record.attendanceCode, (byCode.get(record.attendanceCode) ?? 0) + 1);
      }
      for (const pupilId of reportWindow.enrolmentsByPupil.keys()) {
        const enrolment = enrollmentForDate(reportWindow.enrolmentsByPupil, pupilId, session.sessionDate);
        if (!enrolment) continue;
        const mark = marksByPupil.get(pupilId);
        const wasPresent = mark?.code.countsAsPresent ?? false;
        totalPossibleSessions += 1;
        if (wasPresent) presentSessions += 1;

        const yearGroup = byYearGroup.get(enrolment.yearGroup.id) ?? {
          id: enrolment.yearGroup.id,
          code: enrolment.yearGroup.code,
          name: enrolment.yearGroup.name,
          presentMarks: 0,
          totalMarks: 0,
          presentSessions: 0,
          possibleSessions: 0,
        };
        yearGroup.possibleSessions += 1;
        if (mark) yearGroup.totalMarks += 1;
        if (wasPresent) {
          yearGroup.presentSessions += 1;
          if (mark) yearGroup.presentMarks += 1;
        }
        byYearGroup.set(yearGroup.id, yearGroup);

        const form = byForm.get(enrolment.form.id) ?? {
          id: enrolment.form.id,
          code: enrolment.form.code,
          yearGroupCode: enrolment.yearGroup.code,
          presentMarks: 0,
          totalMarks: 0,
          presentSessions: 0,
          possibleSessions: 0,
        };
        form.possibleSessions += 1;
        if (mark) form.totalMarks += 1;
        if (wasPresent) {
          form.presentSessions += 1;
          if (mark) form.presentMarks += 1;
        }
        byForm.set(form.id, form);
      }
    }

    const byPupil = new Map<string, {
      pupilId: string;
      admissionNumber: string;
      name: string;
      present: number;
      total: number;
    }>();
    for (const session of yearToDateWindow.sessions) {
      const marksByPupil = new Map(session.records.map((record) => [record.pupilId, record]));
      for (const [pupilId] of yearToDateWindow.enrolmentsByPupil) {
        const enrolment = enrollmentForDate(yearToDateWindow.enrolmentsByPupil, pupilId, session.sessionDate);
        if (!enrolment) continue;
        const pupil = byPupil.get(pupilId) ?? {
          pupilId,
          admissionNumber: enrolment.pupil.admissionNumber,
          name: this.personName(enrolment.pupil.person),
          present: 0,
          total: 0,
        };
        pupil.total += 1;
        if (marksByPupil.get(pupilId)?.code.countsAsPresent) pupil.present += 1;
        byPupil.set(pupilId, pupil);
      }
    }

    const persistentAbsence = Array.from(byPupil.values())
      .map((pupil) => ({
        ...pupil,
        possibleSessions: pupil.total,
        attendanceRate: pupil.total ? pupil.present / pupil.total : 1,
      }))
      .filter((pupil) => pupil.attendanceRate < PERSISTENT_ABSENCE_THRESHOLD)
      .sort((left, right) => left.attendanceRate - right.attendanceRate);

    return {
      period: query.period,
      startsOn: startsOn.toISOString().slice(0, 10),
      endsOn: reportEndsOn.toISOString().slice(0, 10),
      totalMarks,
      presentSessions,
      totalPossibleSessions,
      byCode: Array.from(byCode, ([code, count]) => ({ code, count })).sort((left, right) => left.code.localeCompare(right.code)),
      byYearGroup: Array.from(byYearGroup.values()).map((group) => ({
        ...group,
        attendanceRate: group.possibleSessions ? group.presentSessions / group.possibleSessions : 0,
      })).sort((left, right) => left.code.localeCompare(right.code)),
      byForm: Array.from(byForm.values()).map((form) => ({
        ...form,
        attendanceRate: form.possibleSessions ? form.presentSessions / form.possibleSessions : 0,
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

  private async requireAttendanceRole(
    schoolId: string,
    userId: string,
    permissionCodes: readonly string[],
  ): Promise<string[]> {
    const roles = await this.getSchoolRoles(schoolId, userId);
    try {
      await requireAnySchoolPermission(this.prisma, schoolId, userId, permissionCodes);
    } catch (error) {
      if (error instanceof ForbiddenException) {
        await this.denyAttendanceAccess(schoolId, userId);
      }
      throw error;
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
