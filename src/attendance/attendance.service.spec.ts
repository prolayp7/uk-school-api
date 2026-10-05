import {
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { AttendanceService } from "./attendance.service";

describe("AttendanceService", () => {
  it("creates a session idempotently using its school/date/type key", async () => {
    const upsert = jest.fn().mockResolvedValue({ id: "session-1" });
    const service = new AttendanceService({
      attendanceSession: { upsert },
    } as unknown as PrismaService);

    await service.createSession("school-1", {
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
    } as unknown as PrismaService);

    await service.createSession("school-1", {
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

  it("makes identical bulk marks idempotent and queues one guardian event", async () => {
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
          { pupilId: "pupil-1", guardianPersonId: "guardian-person-1" },
        ]),
      },
      auditEvent: { create: auditCreate },
      outboxEvent: { create: outboxCreate },
    };
    const prisma = {
      attendanceSession: {
        findFirst: jest.fn().mockResolvedValue({ id: "session-1", sessionDate: new Date("2026-09-30T00:00:00.000Z") }),
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
    expect(outboxCreate).toHaveBeenCalledTimes(1);
  });

  it("uses the approved denominator and flags attendance below 90 percent", async () => {
    const records = [
      ...Array.from({ length: 9 }, () => ({
        pupilId: "pupil-at-threshold",
        attendanceCode: "P",
        code: { countsAsPresent: true },
        session: { sessionDate: new Date("2026-09-30T00:00:00.000Z"), sessionType: "morning" },
        pupil: { admissionNumber: "A1", person: { legalFirstName: "Alex", preferredName: null, lastName: "Able" } },
      })),
      {
        pupilId: "pupil-at-threshold",
        attendanceCode: "I",
        code: { countsAsPresent: false },
        session: { sessionDate: new Date("2026-09-30T00:00:00.000Z"), sessionType: "afternoon" },
        pupil: { admissionNumber: "A1", person: { legalFirstName: "Alex", preferredName: null, lastName: "Able" } },
      },
      ...Array.from({ length: 8 }, () => ({
        pupilId: "pupil-below-threshold",
        attendanceCode: "P",
        code: { countsAsPresent: true },
        session: { sessionDate: new Date("2026-09-30T00:00:00.000Z"), sessionType: "morning" },
        pupil: { admissionNumber: "B1", person: { legalFirstName: "Blair", preferredName: null, lastName: "Baker" } },
      })),
      ...Array.from({ length: 2 }, () => ({
        pupilId: "pupil-below-threshold",
        attendanceCode: "N",
        code: { countsAsPresent: false },
        session: { sessionDate: new Date("2026-09-30T00:00:00.000Z"), sessionType: "afternoon" },
        pupil: { admissionNumber: "B1", person: { legalFirstName: "Blair", preferredName: null, lastName: "Baker" } },
      })),
    ];
    const service = new AttendanceService({
      attendanceRecord: { findMany: jest.fn().mockResolvedValue(records) },
    } as unknown as PrismaService);

    const report = await service.getReport("school-1", { period: "day", date: "2026-09-30" });

    expect(report.totalMarks).toBe(20);
    expect(report.persistentAbsence.map(({ pupilId }) => pupilId)).toEqual(["pupil-below-threshold"]);
    expect(report.persistentAbsenceThreshold).toBe(0.9);
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
