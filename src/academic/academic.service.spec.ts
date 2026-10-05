import "reflect-metadata";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Prisma } from "@prisma/client";
import { AuthGuard, SchoolAccessGuard } from "../auth/auth.guard";
import type { PrismaService } from "../prisma/prisma.service";
import { AcademicController } from "./academic.controller";
import { AcademicService } from "./academic.service";

describe("AcademicService", () => {
  it("protects academic routes with authentication and school scope", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AcademicController))
      .toEqual([AuthGuard, SchoolAccessGuard]);
  });

  it("denies teachers from creating assessments for another teacher's class", async () => {
    const transaction = jest.fn();
    const service = new AcademicService({
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({ membershipRoles: [{ role: { code: "TEACHER" } }] }),
      },
      classGroup: {
        findFirst: jest.fn().mockResolvedValue({ id: "class-1", teacher: { person: { userId: "teacher-2" } } }),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      $transaction: transaction,
    } as unknown as PrismaService);

    await expect(service.createAssessment("school-1", "teacher-1", {
      classGroupId: "class-1",
      title: "Algebra test",
      assessmentType: "summative",
      maxScore: 20,
      assessedOn: "2026-10-01",
    })).rejects.toBeInstanceOf(ForbiddenException);

    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects assessment results for pupils outside the assigned class", async () => {
    const transaction = jest.fn();
    const service = new AcademicService({
      assessment: { findFirst: jest.fn().mockResolvedValue({ id: "assessment-1", classGroupId: "class-1", gradeScaleId: null, maxScore: 20 }) },
      classGroup: { findFirst: jest.fn().mockResolvedValue({ id: "class-1", teacher: { person: { userId: "teacher-1" } } }) },
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({ membershipRoles: [{ role: { code: "TEACHER" } }] }) },
      classMembership: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: transaction,
    } as unknown as PrismaService);

    await expect(service.upsertAssessmentResults("school-1", "teacher-1", "assessment-1", {
      results: [{ pupilId: "pupil-not-assigned", score: 14 }],
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects scores outside the selected configurable grade band", async () => {
    const transaction = jest.fn();
    const service = new AcademicService({
      assessment: { findFirst: jest.fn().mockResolvedValue({ id: "assessment-1", classGroupId: "class-1", gradeScaleId: "scale-1", maxScore: new Prisma.Decimal(10) }) },
      classGroup: { findFirst: jest.fn().mockResolvedValue({ id: "class-1", teacher: { person: { userId: "teacher-1" } } }) },
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({ membershipRoles: [{ role: { code: "TEACHER" } }] }) },
      classMembership: { findMany: jest.fn().mockResolvedValue([{ pupilId: "pupil-1" }]) },
      gradeBand: { findMany: jest.fn().mockResolvedValue([{ code: "B", minScore: new Prisma.Decimal(6), maxScore: new Prisma.Decimal(10) }]) },
      $transaction: transaction,
    } as unknown as PrismaService);

    await expect(service.upsertAssessmentResults("school-1", "teacher-1", "assessment-1", {
      results: [{ pupilId: "pupil-1", score: 5, gradeCode: "B" }],
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(transaction).not.toHaveBeenCalled();
  });

  it("snapshots previous assessment results before a correction", async () => {
    const revisionCreate = jest.fn().mockResolvedValue({ id: "revision-1" });
    const resultUpsert = jest.fn().mockResolvedValue({ id: "result-1", revision: 2, score: new Prisma.Decimal(8) });
    const auditCreate = jest.fn().mockResolvedValue({});
    const transaction = {
      assessmentResult: {
        findMany: jest.fn().mockResolvedValue([{
          id: "result-1",
          pupilId: "pupil-1",
          score: new Prisma.Decimal(5),
          gradeCode: "A",
          comments: null,
          source: "teacher",
          revision: 1,
        }]),
        upsert: resultUpsert,
      },
      assessmentResultRevision: { create: revisionCreate },
      auditEvent: { create: auditCreate },
    };
    const service = new AcademicService({
      assessment: { findFirst: jest.fn().mockResolvedValue({ id: "assessment-1", classGroupId: "class-1", gradeScaleId: "scale-1", maxScore: new Prisma.Decimal(10) }) },
      classGroup: { findFirst: jest.fn().mockResolvedValue({ id: "class-1", teacher: { person: { userId: "teacher-1" } } }) },
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({ membershipRoles: [{ role: { code: "TEACHER" } }] }) },
      classMembership: { findMany: jest.fn().mockResolvedValue([{ pupilId: "pupil-1" }]) },
      gradeBand: { findMany: jest.fn().mockResolvedValue([
        { code: "A", minScore: new Prisma.Decimal(0), maxScore: new Prisma.Decimal(5) },
        { code: "B", minScore: new Prisma.Decimal(5.01), maxScore: new Prisma.Decimal(10) },
      ]) },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaService);

    const result = await service.upsertAssessmentResults("school-1", "teacher-1", "assessment-1", {
      results: [{ pupilId: "pupil-1", score: 8, gradeCode: "B" }],
    });

    expect(result.changed).toBe(1);
    expect(revisionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ resultId: "result-1", score: new Prisma.Decimal(5), gradeCode: "A", revision: 1 }),
    }));
    expect(resultUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ revision: { increment: 1 } }),
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "academic.assessment.results_saved" }),
    }));
  });

  it("requires exam-office or leadership roles to create exam series", async () => {
    const transaction = jest.fn();
    const auditCreate = jest.fn().mockResolvedValue({});
    const service = new AcademicService({
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({ membershipRoles: [{ role: { code: "TEACHER" } }] }),
      },
      auditEvent: { create: auditCreate },
      $transaction: transaction,
    } as unknown as PrismaService);

    await expect(service.createExamSeries("school-1", "teacher-1", {
      code: "SUM26",
      name: "Summer 2026",
      awardingBody: "Example Board",
      qualification: "GCSE",
      startsOn: "2026-06-01",
      endsOn: "2026-06-30",
    })).rejects.toBeInstanceOf(ForbiddenException);

    expect(auditCreate).toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
