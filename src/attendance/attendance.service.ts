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

  listCodes(schoolId: string) {
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

  async createSession(schoolId: string, input: CreateAttendanceSessionDto) {
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

  listSessions(schoolId: string, query: AttendanceSessionsQueryDto) {
    return this.prisma.attendanceSession.findMany({
      where: {
        schoolId,
        ...(query.date ? { sessionDate: dateOnly(query.date) } : {}),
        ...(query.classGroupId ? { classGroupId: query.classGroupId } : {}),
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

  async getPupilAttendance(schoolId: string, pupilId: string) {
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

    return this.prisma.attendanceRecord.findMany({
      where: { schoolId: contact.schoolId, pupilId },
      orderBy: { session: { sessionDate: "desc" } },
      select: {
        attendanceCode: true,
        markedAt: true,
        session: { select: { sessionDate: true, sessionType: true } },
        code: { select: { description: true, markType: true } },
      },
    });
  }

  async createIntervention(
    schoolId: string,
    pupilId: string,
    actorUserId: string,
    input: CreateAttendanceInterventionDto,
  ) {
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

  async getReport(schoolId: string, query: AttendanceReportQueryDto) {
    const { startsOn, endsOn } = reportRange(query.period, query.date);
    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        schoolId,
        session: { sessionDate: { gte: startsOn, lte: endsOn } },
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
          },
        },
      },
    });

    const byCode = new Map<string, number>();
    const byPupil = new Map<string, { pupilId: string; admissionNumber: string; name: string; present: number; total: number }>();
    for (const record of records) {
      byCode.set(record.attendanceCode, (byCode.get(record.attendanceCode) ?? 0) + 1);
      const pupil = byPupil.get(record.pupilId) ?? {
        pupilId: record.pupilId,
        admissionNumber: record.pupil.admissionNumber,
        name: `${record.pupil.person.preferredName || record.pupil.person.legalFirstName} ${record.pupil.person.lastName}`.trim(),
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
      persistentAbsenceThreshold: PERSISTENT_ABSENCE_THRESHOLD,
      persistentAbsence,
    };
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
