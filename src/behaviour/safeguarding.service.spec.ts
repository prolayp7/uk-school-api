import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AuthGuard, SchoolAccessGuard } from "../auth/auth.guard";
import type { PrismaService } from "../prisma/prisma.service";
import { SafeguardingController } from "./behaviour.controller";
import { SafeguardingService } from "./safeguarding.service";

describe("SafeguardingService", () => {
  it("protects all safeguarding routes with authentication and school-scope guards", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SafeguardingController))
      .toEqual([AuthGuard, SchoolAccessGuard]);
  });

  it("denies non-DSL case listing and records the denied access", async () => {
    const auditCreate = jest.fn().mockResolvedValue({});
    const caseFindMany = jest.fn();
    const service = new SafeguardingService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue(null) },
      auditEvent: { create: auditCreate },
      safeguardingCase: { findMany: caseFindMany },
    } as unknown as PrismaService);

    await expect(service.listCases("school-1", "teacher-1"))
      .rejects.toBeInstanceOf(ForbiddenException);

    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "safeguarding.case.access_denied",
        metadata: { reason: "dsl_role_required" },
      }),
    }));
    expect(caseFindMany).not.toHaveBeenCalled();
  });

  it("requires an explicit active case grant even for a DSL user", async () => {
    const auditCreate = jest.fn().mockResolvedValue({});
    const caseFindFirst = jest.fn();
    const service = new SafeguardingService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({ id: "membership-1" }) },
      safeguardingCaseAccess: { findUnique: jest.fn().mockResolvedValue(null) },
      auditEvent: { create: auditCreate },
      safeguardingCase: { findFirst: caseFindFirst },
    } as unknown as PrismaService);

    await expect(service.getCase("school-1", "dsl-1", "case-1"))
      .rejects.toBeInstanceOf(ForbiddenException);

    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "safeguarding.case.access_denied",
        metadata: { reason: "case_grant_required" },
      }),
    }));
    expect(caseFindFirst).not.toHaveBeenCalled();
  });

  it("does not allow parent memberships to submit safeguarding concerns", async () => {
    const caseCreate = jest.fn();
    const service = new SafeguardingService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue(null) },
      safeguardingCase: { create: caseCreate },
    } as unknown as PrismaService);

    await expect(service.submitConcern("school-1", "parent-1", {
      pupilId: "pupil-1",
      category: "welfare",
      details: "Sensitive report contents",
    })).rejects.toBeInstanceOf(ForbiddenException);

    expect(caseCreate).not.toHaveBeenCalled();
  });

  it("audits authorized case detail reads without copying concern details into audit metadata", async () => {
    const auditCreate = jest.fn().mockResolvedValue({});
    const caseDetails = {
      id: "case-1",
      pupilId: "pupil-1",
      status: "open",
      concerns: [{ id: "concern-1", details: "Sensitive report contents" }],
      actions: [],
      meetings: [],
    };
    const service = new SafeguardingService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({ id: "membership-1" }) },
      safeguardingCaseAccess: { findUnique: jest.fn().mockResolvedValue({ revokedAt: null }) },
      safeguardingCase: { findFirst: jest.fn().mockResolvedValue(caseDetails) },
      auditEvent: { create: auditCreate },
    } as unknown as PrismaService);

    const result = await service.getCase("school-1", "dsl-1", "case-1");

    expect(result).toBe(caseDetails);
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "safeguarding.case.viewed",
        entityId: "case-1",
        metadata: { view: "case_detail" },
      }),
    }));
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain("Sensitive report contents");
  });

  it("creates an isolated case and grants access only to active DSL memberships", async () => {
    const grantCreateMany = jest.fn().mockResolvedValue({ count: 1 });
    const auditCreateMany = jest.fn().mockResolvedValue({ count: 2 });
    const transaction = {
      safeguardingCase: { create: jest.fn().mockResolvedValue({ id: "case-1", status: "open" }) },
      safeguardingConcern: { create: jest.fn().mockResolvedValue({ id: "concern-1" }) },
      safeguardingCaseAccess: { createMany: grantCreateMany },
      auditEvent: { createMany: auditCreateMany },
    };
    const service = new SafeguardingService({
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({ id: "staff-membership" }),
        findMany: jest.fn().mockResolvedValue([{ userId: "dsl-1" }]),
      },
      pupilProfile: { findFirst: jest.fn().mockResolvedValue({ id: "pupil-1" }) },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaService);

    const result = await service.submitConcern("school-1", "teacher-1", {
      pupilId: "pupil-1",
      category: "welfare",
      details: "Sensitive report contents",
    });

    expect(result).toEqual({ concernId: "concern-1", caseId: "case-1", status: "open" });
    expect(grantCreateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ userId: "dsl-1", reason: expect.any(String) })],
      skipDuplicates: true,
    }));
    expect(JSON.stringify(auditCreateMany.mock.calls)).not.toContain("Sensitive report contents");
  });
});
