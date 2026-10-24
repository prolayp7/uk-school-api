import {
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { AttendanceService } from "./attendance.service";
import { schoolMembershipRole } from "../auth/school-permissions.test-utils";

describe("AttendanceService", () => {
  it("creates a session idempotently using its school/date/type key", async () => {
    const upsert = jest.fn().mockResolvedValue({ id: "session-1" });
    const service = new AttendanceService({
      attendanceSession: { upsert },
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({ membershipRoles: [schoolMembershipRole("ATTENDANCE_OFFICER")] }),
      },
    } as unknown as PrismaService);

    await service.createSession("school-1", "user-1", {
      sessionDate: "2026-09-30",
      sessionType: "morning",
    });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        schoolId_sessionDate_sessionType_sessionKey: {
          schoolId: "school-1",
          sessionDate: new Date("2026-09-30T00:00:00.000Z"),
          sessionType: "morning",
          sessionKey: "registration",
        },
      },
      update: {},
    }));
  });

  it("keys lesson sessions by school class and period", async () => {
    const upsert = jest.fn().mockResolvedValue({ id: "lesson-session-1" });
    const service = new AttendanceService({
      classGroup: { findFirst: jest.fn().mockResolvedValue({ id: "class-1" }) },
      attendanceSession: { upsert },
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({ membershipRoles: [schoolMembershipRole("ATTENDANCE_OFFICER")] }),
      },
    } as unknown as PrismaService);

    await service.createSession("school-1", "user-1", {
      sessionDate: "2026-09-30",
      sessionType: "lesson",
      classGroupId: "class-1",
      lessonPeriod: "period-1",
    });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        schoolId_sessionDate_sessionType_sessionKey: {
          schoolId: "school-1",
          sessionDate: new Date("2026-09-30T00:00:00.000Z"),
          sessionType: "lesson",
          sessionKey: "lesson:class-1:period-1",
        },
      },
    }));
  });

  it("rejects duplicate pupil IDs in a bulk session update", async () => {
    const service = new AttendanceService({} as PrismaService);

    await expect(service.upsertSessionRecords("school-1", "session-1", "user-1", [
      { pupilId: "pupil-1", attendanceCode: "P" },
      { pupilId: "pupil-1", attendanceCode: "L" },
    ])).rejects.toBeInstanceOf(BadRequestException);
  });

  it("makes identical bulk marks idempotent and queues one parent notification", async () => {
    const persisted: Array<{
      id: string;
      pupilId: string;
      attendanceCode: string;
      reason: string | null;
      note: string | null;
      authorizationStatus: string;
      [key: string]: unknown;
    }> = [];
    const auditCreate = jest.fn().mockResolvedValue({});
    const noteCreate = jest.fn().mockResolvedValue({});
    const notificationCreate = jest.fn().mockResolvedValue({ id: "notification-1" });
    const notificationDeliveryCreate = jest.fn().mockResolvedValue({});
    const outboxCreate = jest.fn().mockResolvedValue({});
    const transaction = {
      attendanceRecord: {
        findMany: jest.fn().mockImplementation(async () => [...persisted]),
        upsert: jest.fn().mockImplementation(async ({ create, update }) => {
          const previous = persisted.find((record) => record.pupilId === create.pupilId);
          if (previous) {
            Object.assign(previous, update);
            return previous;
          }
          const created = { id: "record-1", ...create, markedAt: new Date() };
          persisted.push(created);
          return created;
        }),
      },
      attendanceRecordRevision: { create: jest.fn() },
      attendanceNote: { create: noteCreate },
      pupilContact: {
        findMany: jest.fn().mockResolvedValue([
          { pupilId: "pupil-1", guardian: { person: { userId: "parent-user-1" } } },
        ]),
      },
      notification: { create: notificationCreate },
      notificationDelivery: { create: notificationDeliveryCreate },
      auditEvent: { create: auditCreate },
      outboxEvent: { create: outboxCreate },
    };
    const prisma = {
      attendanceSession: {
        findFirst: jest.fn().mockResolvedValue({ id: "session-1", sessionDate: new Date("2026-09-30T00:00:00.000Z") }),
      },
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({ membershipRoles: [schoolMembershipRole("ATTENDANCE_OFFICER")] }),
      },
      attendanceCode: {
        findMany: jest.fn().mockResolvedValue([
          { code: "I", markType: "authorised_absence", countsAsPresent: false },
        ]),
      },
      pupilProfile: { findMany: jest.fn().mockResolvedValue([{ id: "pupil-1" }]) },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaService;
    const service = new AttendanceService(prisma);
    const input = [{
      pupilId: "pupil-1",
      attendanceCode: "I",
      reason: "Illness",
      note: "Parent called",
    }];

    const first = await service.upsertSessionRecords("school-1", "session-1", "user-1", input);
    const second = await service.upsertSessionRecords("school-1", "session-1", "user-1", input);

    expect(first.changed).toBe(1);
    expect(second.changed).toBe(0);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(noteCreate).toHaveBeenCalledTimes(1);
    expect(notificationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        schoolId: "school-1",
        recipientUserId: "parent-user-1",
      }),
    }));
    expect(notificationDeliveryCreate).toHaveBeenCalledTimes(1);
    expect(outboxCreate).toHaveBeenCalledTimes(1);
    expect(outboxCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: "notification.email" }),
    }));
  });

  it("uses opened AM/PM sessions as the denominator and counts unmarked sessions as absent", async () => {
    const pupilNames = {
      "pupil-at-threshold": {
        admissionNumber: "A1",
        person: { legalFirstName: "Alex", preferredName: null, lastName: "Able" },
      },
      "pupil-below-threshold": {
        admissionNumber: "B1",
        person: { legalFirstName: "Blair", preferredName: null, lastName: "Baker" },
      },
    };
    const sessions = Array.from({ length: 10 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 8, 28 + Math.floor(index / 2)));
      const records = [];
      if (index < 9) {
        records.push({
          pupilId: "pupil-at-threshold",
          attendanceCode: "P",
          code: { countsAsPresent: true },
        });
      } else {
        records.push({
          pupilId: "pupil-at-threshold",
          attendanceCode: "I",
          code: { countsAsPresent: false },
        });
      }
      if (index < 8) {
        records.push({
          pupilId: "pupil-below-threshold",
          attendanceCode: "P",
          code: { countsAsPresent: true },
        });
      } else if (index === 8) {
        records.push({
          pupilId: "pupil-below-threshold",
          attendanceCode: "N",
          code: { countsAsPresent: false },
        });
      }
      return { sessionDate: date, records };
    });
    const enrolments = Object.entries(pupilNames).map(([pupilId, pupil]) => ({
      pupilId,
      startsOn: new Date("2026-09-01T00:00:00.000Z"),
      endsOn: null,
      yearGroup: { id: "year-7", code: "7", name: "Year 7" },
      form: { id: "form-7a", code: "7A" },
      pupil,
    }));
    const service = new AttendanceService({
      academicYear: { findFirst: jest.fn().mockResolvedValue(null) },
      attendanceSession: { findMany: jest.fn().mockResolvedValue(sessions) },
      pupilEnrolment: { findMany: jest.fn().mockResolvedValue(enrolments) },
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({ membershipRoles: [schoolMembershipRole("HEADTEACHER")] }),
      },
    } as unknown as PrismaService);

    const report = await service.getReport("school-1", "user-1", { period: "week", date: "2026-10-04" });

    expect(report.totalMarks).toBe(19);
    expect(report.totalPossibleSessions).toBe(20);
    expect(report.persistentAbsence.map(({ pupilId }) => pupilId)).toEqual(["pupil-below-threshold"]);
    expect(report.persistentAbsence[0]).toMatchObject({
      present: 8,
      possibleSessions: 10,
      attendanceRate: 0.8,
    });
    expect(report.persistentAbsenceThreshold).toBe(0.9);
  });

  it("reports attendance by active year group and form", async () => {
    const service = new AttendanceService({
      academicYear: { findFirst: jest.fn().mockResolvedValue(null) },
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({ membershipRoles: [schoolMembershipRole("HEADTEACHER")] }),
      },
      attendanceSession: {
        findMany: jest.fn().mockResolvedValue([{
          sessionDate: new Date("2026-09-30T00:00:00.000Z"),
          records: [{
            pupilId: "pupil-1",
            attendanceCode: "P",
            code: { countsAsPresent: true },
          }],
        }]),
      },
      pupilEnrolment: {
        findMany: jest.fn().mockResolvedValue([{
          pupilId: "pupil-1",
          startsOn: new Date("2026-09-01T00:00:00.000Z"),
          endsOn: null,
          yearGroup: { id: "year-7", code: "7", name: "Year 7" },
          form: { id: "form-7a", code: "7A" },
          pupil: {
            admissionNumber: "A1",
            person: { legalFirstName: "Alex", preferredName: null, lastName: "Able" },
          },
        }]),
      },
    } as unknown as PrismaService);

    const report = await service.getReport("school-1", "user-1", { period: "day", date: "2026-09-30" });

    expect(report.byYearGroup).toEqual([expect.objectContaining({
      code: "7",
      attendanceRate: 1,
      totalMarks: 1,
      possibleSessions: 1,
    })]);
    expect(report.byForm).toEqual([expect.objectContaining({
      code: "7A",
      yearGroupCode: "7",
      attendanceRate: 1,
      possibleSessions: 1,
    })]);
  });

  it("uses academic-year attendance rather than one reporting day for persistent absence", async () => {
    const yearToDateSessions = Array.from({ length: 10 }, (_, index) => ({
      sessionDate: new Date(Date.UTC(2026, 8, 21 + index)),
      records: [{
        pupilId: "pupil-1",
        attendanceCode: index === 9 ? "I" : "P",
        code: { countsAsPresent: index !== 9 },
      }],
    }));
    const enrolment = {
      pupilId: "pupil-1",
      startsOn: new Date("2026-09-01T00:00:00.000Z"),
      endsOn: null,
      yearGroup: { id: "year-7", code: "7", name: "Year 7" },
      form: { id: "form-7a", code: "7A" },
      pupil: {
        admissionNumber: "A1",
        person: { legalFirstName: "Alex", preferredName: null, lastName: "Able" },
      },
    };
    const service = new AttendanceService({
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({ membershipRoles: [schoolMembershipRole("HEADTEACHER")] }),
      },
      academicYear: { findFirst: jest.fn().mockResolvedValue({ startsOn: new Date("2026-09-01T00:00:00.000Z") }) },
      attendanceSession: {
        findMany: jest.fn()
          .mockResolvedValueOnce([yearToDateSessions[9]])
          .mockResolvedValueOnce(yearToDateSessions),
      },
      pupilEnrolment: {
        findMany: jest.fn().mockResolvedValue([enrolment]),
      },
    } as unknown as PrismaService);

    const report = await service.getReport("school-1", "user-1", { period: "day", date: "2026-09-30" });

    expect(report.totalMarks).toBe(1);
    expect(report.totalPossibleSessions).toBe(1);
    expect(report.persistentAbsence).toEqual([]);
  });

  it("requires teacher attendance reports to select a class group", async () => {
    const service = new AttendanceService({
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({ membershipRoles: [schoolMembershipRole("TEACHER")] }),
      },
      attendanceRecord: { findMany: jest.fn() },
    } as unknown as PrismaService);

    await expect(service.getReport("school-1", "teacher-1", { period: "week" }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it("limits teacher summaries to assigned classes and their pupils", async () => {
    const attendanceFindMany = jest.fn().mockResolvedValue([{
      pupilId: "pupil-1",
      attendanceCode: "P",
      code: { countsAsPresent: true },
      session: { classGroupId: "class-1" },
      pupil: {
        admissionNumber: "A1",
        person: { legalFirstName: "Alex", preferredName: null, lastName: "Able" },
      },
    }]);
    const service = new AttendanceService({
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({ membershipRoles: [schoolMembershipRole("TEACHER")] }),
      },
      classGroup: {
        findMany: jest.fn().mockResolvedValue([{
          id: "class-1",
          code: "7A-MATHS",
          yearGroup: { code: "7", name: "Year 7" },
          subject: { code: "MATHS", name: "Maths" },
        }]),
      },
      attendanceRecord: { findMany: attendanceFindMany },
    } as unknown as PrismaService);

    const report = await service.getTeacherSummary("school-1", "teacher-1", {
      period: "week",
      date: "2026-09-30",
    });

    expect(attendanceFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        schoolId: "school-1",
        session: expect.objectContaining({ classGroupId: { in: ["class-1"] } }),
      }),
    }));
    expect(report.classes[0]).toMatchObject({
      id: "class-1",
      attendanceRate: 1,
      pupils: [{ pupilId: "pupil-1", attendanceRate: 1 }],
    });
  });

  it("lists only assigned lesson sessions for teachers", async () => {
    const sessionFindMany = jest.fn().mockResolvedValue([]);
    const service = new AttendanceService({
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({ membershipRoles: [schoolMembershipRole("TEACHER")] }),
      },
      classGroup: { findMany: jest.fn().mockResolvedValue([{ id: "class-assigned" }]) },
      attendanceSession: { findMany: sessionFindMany },
    } as unknown as PrismaService);

    await service.listSessions("school-1", "teacher-1", { date: "2026-09-30" });

    expect(sessionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        schoolId: "school-1",
        classGroupId: { in: ["class-assigned"] },
      }),
    }));
  });

  it("returns only pupils in the authorized class session register", async () => {
    const pupilFindMany = jest.fn().mockResolvedValue([{
      id: "pupil-1",
      admissionNumber: "A1",
      person: { legalFirstName: "Alex", preferredName: null, lastName: "Able" },
      attendanceRecords: [{ attendanceCode: "P", reason: null, authorizationStatus: "not_required" }],
    }]);
    const service = new AttendanceService({
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({ membershipRoles: [schoolMembershipRole("TEACHER")] }),
      },
      attendanceSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: "session-1",
          sessionDate: new Date("2026-09-30T00:00:00.000Z"),
          sessionType: "lesson",
          classGroupId: "class-1",
          lessonPeriod: "P1",
        }),
      },
      classGroup: { findFirst: jest.fn().mockResolvedValue({ id: "class-1" }) },
      pupilProfile: { findMany: pupilFindMany },
    } as unknown as PrismaService);

    const register = await service.getSessionRegister("school-1", "teacher-1", "session-1");

    expect(pupilFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        schoolId: "school-1",
        status: "enrolled",
        classMemberships: { some: { classGroupId: "class-1" } },
      },
    }));
    expect(register.items).toEqual([expect.objectContaining({ pupilId: "pupil-1", attendanceCode: "P" })]);
  });

  it("returns student attendance only for the pupil profile linked to the student account", async () => {
    const attendanceFindMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      schoolMembership: {
        findMany: jest.fn().mockResolvedValue([{ schoolId: "school-1" }]),
      },
      pupilProfile: {
        findFirst: jest.fn().mockResolvedValue({ id: "pupil-self", schoolId: "school-1" }),
      },
      attendanceRecord: { findMany: attendanceFindMany },
    } as unknown as PrismaService;
    const service = new AttendanceService(prisma);

    await service.getStudentAttendance("student-user");

    expect(prisma.pupilProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { schoolId: { in: ["school-1"] }, person: { userId: "student-user" } },
    }));
    expect(attendanceFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { schoolId: "school-1", pupilId: "pupil-self" },
      take: 30,
      select: expect.not.objectContaining({ reason: true, notes: expect.anything() }),
    }));
  });

  it("denies parent attendance access without an active viewable contact link", async () => {
    const prisma = {
      pupilContact: { findFirst: jest.fn().mockResolvedValue(null) },
      attendanceRecord: { findMany: jest.fn() },
    } as unknown as PrismaService;
    const service = new AttendanceService(prisma);

    await expect(service.getParentPupilAttendance("user-1", "pupil-1"))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled();
  });

  it("returns only portal-safe attendance fields to a linked parent", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      pupilContact: { findFirst: jest.fn().mockResolvedValue({ schoolId: "school-1" }) },
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({ membershipRoles: [schoolMembershipRole("PARENT")] }),
      },
      attendanceRecord: { findMany },
    } as unknown as PrismaService;
    const service = new AttendanceService(prisma);

    await service.getParentPupilAttendance("user-1", "pupil-1");

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.not.objectContaining({ reason: true, authorizationStatus: true, notes: expect.anything() }),
    }));
    expect(prisma.pupilContact.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        canViewPortal: true,
        startsOn: { lte: expect.any(Date) },
        OR: expect.any(Array),
      }),
    }));
  });
});
