import { ForbiddenException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { CensusService } from "./census.service";
import type { UpdateStaffComplianceDto } from "./census.dto";

function membershipRole(code: string, permissions: string[]) {
  return {
    role: {
      code,
      rolePermissions: permissions.map((permissionCode) => ({ permissionCode })),
    },
  };
}

describe("CensusService", () => {
  it("derives readiness checks from a school-scoped pupil cohort without claiming an official return", async () => {
    const membershipFindFirst = jest.fn().mockResolvedValue({
      membershipRoles: [membershipRole("HEADTEACHER", ["census.manage", "scr.manage"])],
    });
    const pupilFindMany = jest.fn().mockResolvedValue([
      {
        id: "pupil-1",
        upn: "A123456789012",
        admissionNumber: "A1",
        gender: "female",
        person: {
          legalFirstName: "Aisha",
          preferredName: null,
          lastName: "Khan",
          dateOfBirth: new Date("2014-02-03T00:00:00.000Z"),
        },
        enrolments: [{ id: "enrolment-1", yearGroupId: "year-1", formId: "form-1" }],
      },
      {
        id: "pupil-2",
        upn: null,
        admissionNumber: "A2",
        gender: "not_recorded",
        person: {
          legalFirstName: "Noah",
          preferredName: null,
          lastName: "Reed",
          dateOfBirth: null,
        },
        enrolments: [],
      },
    ]);
    const auditCreate = jest.fn().mockResolvedValue({});
    const service = new CensusService({
      schoolMembership: { findFirst: membershipFindFirst },
      pupilProfile: { findMany: pupilFindMany },
      auditEvent: { create: auditCreate },
    } as unknown as PrismaService);

    const result = await service.getReadiness("school-1", "leader-1", {
      censusDate: "2027-01-14",
    });

    expect(pupilFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { schoolId: "school-1", status: "enrolled", admissionDate: { lte: new Date("2027-01-14T00:00:00.000Z") } },
    }));
    expect(result).toMatchObject({
      censusDate: "2027-01-14",
      cohortCount: 1,
      status: "needs_attention",
      checks: [
        { key: "date_of_birth", missingCount: 1, status: "attention" },
        { key: "upn", missingCount: 1, status: "attention" },
        { key: "gender", missingCount: 1, status: "attention" },
        { key: "enrolment", missingCount: 1, status: "attention" },
      ],
      limitation: expect.stringContaining("create an official census return"),
    });
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "census.readiness.viewed",
        schoolId: "school-1",
      }),
    }));
  });

  it("does not grant SCR access to every ADMIN membership", async () => {
    const membershipFindFirst = jest.fn().mockResolvedValue({
      membershipRoles: [membershipRole("ADMIN", ["finance.manage"])],
    });
    const staffFindMany = jest.fn();
    const service = new CensusService({
      schoolMembership: { findFirst: membershipFindFirst },
      staffProfile: { findMany: staffFindMany },
    } as unknown as PrismaService);

    await expect(service.listStaffCompliance("school-1", "admin-1", {
      page: 1,
      pageSize: 25,
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(staffFindMany).not.toHaveBeenCalled();
  });

  it("upserts school-scoped SCR dates and audits field names without storing certificate numbers", async () => {
    const membershipFindFirst = jest.fn().mockResolvedValue({
      membershipRoles: [membershipRole("SCR_ADMIN", ["census.manage", "scr.manage"])],
    });
    const record = {
      id: "scr-1",
      staffProfileId: "staff-1",
      dbsCheckStatus: "clear",
      dbsCheckedOn: new Date("2026-09-01T00:00:00.000Z"),
    };
    const upsert = jest.fn().mockResolvedValue(record);
    const auditCreate = jest.fn().mockResolvedValue({});
    const transaction = {
      staffComplianceRecord: { upsert },
      auditEvent: { create: auditCreate },
    };
    const service = new CensusService({
      schoolMembership: { findFirst: membershipFindFirst },
      staffProfile: { findFirst: jest.fn().mockResolvedValue({ id: "staff-1" }) },
      staffComplianceRecord: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaService);
    const input: UpdateStaffComplianceDto = {
      dbsCheckStatus: "clear",
      identityVerifiedOn: "2026-08-01",
      dbsCheckedOn: "2026-09-01",
    };

    const result = await service.updateStaffCompliance("school-1", "scr-admin-1", "staff-1", input);

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { schoolId_staffProfileId: { schoolId: "school-1", staffProfileId: "staff-1" } },
      create: expect.objectContaining({
        schoolId: "school-1",
        staffProfileId: "staff-1",
        dbsCheckStatus: "clear",
        identityVerifiedOn: new Date("2026-08-01T00:00:00.000Z"),
        dbsCheckedOn: new Date("2026-09-01T00:00:00.000Z"),
      }),
    }));
    expect(result).toBe(record);
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "scr.record.created",
        metadata: expect.objectContaining({ staffProfileId: "staff-1" }),
      }),
    }));
    expect(JSON.stringify(upsert.mock.calls)).not.toMatch(/certificate(number)?/i);
  });
});
