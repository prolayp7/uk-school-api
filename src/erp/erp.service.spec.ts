import { ErpService } from "./erp.service";
import type { PrismaService } from "../prisma/prisma.service";

function membershipWithRole(roleCode: string, permissionCodes: string[] = []) {
  return {
    id: "membership-1",
    membershipRoles: [{
      role: {
        code: roleCode,
        rolePermissions: permissionCodes.map((permissionCode) => ({ permissionCode })),
      },
    }],
  };
}

describe("ErpService", () => {
  it("lists configurable staff roles and permission definitions without the built-in roles", async () => {
    const roleFindMany = jest.fn().mockResolvedValue([
      {
        code: "TEACHER",
        name: "Teacher",
        rolePermissions: [{ permissionCode: "attendance.read" }],
      },
    ]);
    const permissionFindMany = jest.fn().mockResolvedValue([
      { code: "attendance.read", description: "View attendance records" },
    ]);
    const service = new ErpService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue(membershipWithRole("SUPER_ADMIN")) },
      role: { findMany: roleFindMany },
      permission: { findMany: permissionFindMany },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService);

    await expect(service.listSchoolRolePermissions("school-1", "admin-user")).resolves.toEqual({
      roles: [{
        code: "TEACHER",
        name: "Teacher",
        permissionCodes: ["attendance.read"],
      }],
      permissions: [{ code: "attendance.read", description: "View attendance records" }],
    });
    expect(roleFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        schoolId: "school-1",
        code: { notIn: ["SUPER_ADMIN", "PARENT", "STUDENT"] },
      },
    }));
  });

  it("replaces a configurable role's permissions and audits the change atomically", async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const createMany = jest.fn().mockResolvedValue({ count: 2 });
    const auditCreate = jest.fn().mockResolvedValue({});
    const service = new ErpService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue(membershipWithRole("SUPER_ADMIN")) },
      role: {
        findUnique: jest.fn().mockResolvedValue({
          id: "role-1",
          code: "TEACHER",
          name: "Teacher",
        }),
      },
      permission: { findMany: jest.fn().mockResolvedValue([{ code: "pupils.read" }, { code: "attendance.read" }]) },
      rolePermission: {
        findMany: jest.fn().mockResolvedValue([{ permissionCode: "attendance.read" }]),
      },
      $transaction: jest.fn(async (callback) => callback({
        rolePermission: { deleteMany, createMany },
        auditEvent: { create: auditCreate },
      })),
    } as unknown as PrismaService);

    await expect(service.updateSchoolRolePermissions(
      "school-1",
      "admin-user",
      "TEACHER",
      ["pupils.read", "attendance.read"],
    )).resolves.toEqual({
      role: { code: "TEACHER", name: "Teacher" },
      permissionCodes: ["attendance.read", "pupils.read"],
    });
    expect(deleteMany).toHaveBeenCalledWith({ where: { schoolId: "school-1", roleId: "role-1" } });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { schoolId: "school-1", roleId: "role-1", permissionCode: "attendance.read" },
        { schoolId: "school-1", roleId: "role-1", permissionCode: "pupils.read" },
      ],
    });
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "school.role_permissions.updated",
        metadata: {
          roleCode: "TEACHER",
          granted: ["pupils.read"],
          removed: [],
        },
      }),
    }));
  });

  it("does not allow editing Superadmin or portal roles", async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: "super-role", code: "SUPER_ADMIN", name: "Super administrator" });
    const service = new ErpService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue(membershipWithRole("SUPER_ADMIN")) },
      role: { findUnique },
    } as unknown as PrismaService);

    await expect(service.updateSchoolRolePermissions(
      "school-1",
      "admin-user",
      "SUPER_ADMIN",
      ["pupils.read"],
    )).rejects.toThrow("Configurable staff role not found.");
  });

  it("grants a school role only to a school super administrator and audits the change", async () => {
    const membershipRoleCreate = jest.fn().mockResolvedValue({ count: 1 });
    const auditCreate = jest.fn().mockResolvedValue({});
    const findFirst = jest.fn()
      .mockResolvedValueOnce({ id: "admin-membership" })
      .mockResolvedValueOnce({ id: "target-membership" });
    const service = new ErpService({
      schoolMembership: { findFirst },
      role: { findUnique: jest.fn().mockResolvedValue({ id: "role-1" }) },
      $transaction: jest.fn(async (callback) => callback({
        membershipRole: { createMany: membershipRoleCreate },
        auditEvent: { create: auditCreate },
      })),
    } as unknown as PrismaService);

    await expect(service.grantMembershipRole(
      "school-1",
      "admin-user",
      "target-membership",
      "TEACHER",
    )).resolves.toEqual({
      membershipId: "target-membership",
      roleCode: "TEACHER",
      granted: true,
    });
    expect(findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        schoolId: "school-1",
        userId: "admin-user",
        membershipRoles: { some: { role: { code: { in: ["SUPER_ADMIN"] } } } },
      }),
    }));
    expect(membershipRoleCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: [{ schoolId: "school-1", membershipId: "target-membership", roleId: "role-1" }],
      skipDuplicates: true,
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "school.membership_role.granted",
        metadata: { roleCode: "TEACHER" },
      }),
    }));
  });

  it("denies role grants when the actor lacks a super-administrator role in that school", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const transaction = jest.fn();
    const service = new ErpService({
      schoolMembership: { findFirst },
      $transaction: transaction,
    } as unknown as PrismaService);

    await expect(service.grantMembershipRole(
      "school-1",
      "non-admin",
      "target-membership",
      "TEACHER",
    )).rejects.toThrow("This operation is not permitted for your school role.");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("lists only active school members for super administrators and audits the directory read", async () => {
    const findFirst = jest.fn().mockResolvedValue(membershipWithRole("SUPER_ADMIN"));
    const findMany = jest.fn().mockResolvedValue([
      {
        id: "member-1",
        userId: "user-1",
        status: "active",
        user: { emailNormalized: "staff@example.test" },
        membershipRoles: [{ role: { code: "TEACHER", name: "Teacher" } }],
      },
    ]);
    const auditCreate = jest.fn().mockResolvedValue({});
    const service = new ErpService({
      schoolMembership: { findFirst, findMany },
      auditEvent: { create: auditCreate },
    } as unknown as PrismaService);

    await expect(service.listSchoolMembers("school-1", "admin-user")).resolves.toEqual({
      total: 1,
      items: [{
        id: "member-1",
        userId: "user-1",
        email: "staff@example.test",
        status: "active",
        roles: [{ code: "TEACHER", name: "Teacher" }],
      }],
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { schoolId: "school-1", status: "active" },
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "school.members.viewed",
        metadata: { resultCount: 1 },
      }),
    }));
  });

  it("denies the school member directory to non-super-administrators", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const findMany = jest.fn();
    const service = new ErpService({
      schoolMembership: { findFirst, findMany },
    } as unknown as PrismaService);

    await expect(service.listSchoolMembers("school-1", "teacher-user"))
      .rejects.toThrow("This operation is not permitted for your school role.");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("lists pupils in a school with active membership and summary fields", async () => {
    const personFindMany = jest.fn().mockResolvedValue([
      {
        id: "person-1",
        legalFirstName: "Aisha",
        lastName: "Ahmed",
        pupilProfile: {
          id: "pupil-1",
          admissionNumber: "ADM0001",
          upn: "UPN0001",
          status: "enrolled",
          enrolments: [],
        },
      },
      {
        id: "person-2",
        legalFirstName: "Ben",
        lastName: "Bennett",
        pupilProfile: {
          id: "pupil-2",
          admissionNumber: "ADM0002",
          status: "enrolled",
          enrolments: [],
        },
      },
    ]);
    const prisma = {
      person: {
        findMany: personFindMany,
        count: jest.fn().mockResolvedValue(2),
      },
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue(membershipWithRole("SUPER_ADMIN")),
      },
    } as unknown as PrismaService;

    const service = new ErpService(prisma);
    const pupils = await service.listPupils("school-1", "user-1");

    expect(pupils.total).toBe(2);
    expect(pupils.items[0]).toMatchObject({
      pupilId: "pupil-1",
      admissionNumber: "ADM0001",
      upn: "UPN0001",
      name: "Aisha Ahmed",
    });
    expect(pupils).toMatchObject({ page: 1, pageSize: 50, totalPages: 1 });
  });

  it("filters and paginates the school pupil directory", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(125);
    const service = new ErpService({
      person: { findMany, count },
      schoolMembership: { findFirst: jest.fn().mockResolvedValue(membershipWithRole("SUPER_ADMIN")) },
    } as unknown as PrismaService);

    const result = await service.listPupils("school-1", "admin-1", {
      page: 2,
      pageSize: 25,
      search: "  Ahmed ",
      yearGroupId: "year-group-1",
      formId: "form-1",
      status: "enrolled",
    });

    expect(result).toMatchObject({ total: 125, page: 2, pageSize: 25, totalPages: 5 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 25,
      take: 25,
      where: expect.objectContaining({
        schoolId: "school-1",
        pupilProfile: {
          is: {
            status: "enrolled",
            enrolments: {
              some: {
                status: "active",
                yearGroupId: "year-group-1",
                formId: "form-1",
              },
            },
          },
        },
      }),
    }));
    expect(count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { legalFirstName: { contains: "Ahmed", mode: "insensitive" } },
        ]),
      }),
    }));
  });

  it("matches all terms in a multiword pupil search", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const service = new ErpService({
      person: { findMany, count },
      schoolMembership: { findFirst: jest.fn().mockResolvedValue(membershipWithRole("SUPER_ADMIN")) },
    } as unknown as PrismaService);

    await service.listPupils("school-1", "admin-1", { search: "Aisha Ahmed" });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: [
          {
            OR: expect.arrayContaining([
              { legalFirstName: { contains: "Aisha", mode: "insensitive" } },
            ]),
          },
          {
            OR: expect.arrayContaining([
              { lastName: { contains: "Ahmed", mode: "insensitive" } },
            ]),
          },
        ],
      }),
    }));
  });

  it("creates a pupil, initial placement, and audit event in one transaction", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const personCreate = jest.fn().mockResolvedValue({ id: "person-new" });
    const profileCreate = jest.fn().mockResolvedValue({
      id: "pupil-new",
      admissionNumber: "ADM0099",
      upn: null,
      status: "enrolled",
    });
    const enrolmentCreate = jest.fn().mockResolvedValue({
      id: "enrolment-new",
      academicYearId: "year-1",
      yearGroupId: "year-group-1",
      formId: "form-1",
      houseId: null,
      startsOn: new Date(`${today}T00:00:00.000Z`),
    });
    const auditCreate = jest.fn().mockResolvedValue({});
    const transaction = {
      person: { create: personCreate },
      pupilProfile: { create: profileCreate },
      pupilEnrolment: { create: enrolmentCreate },
      auditEvent: { create: auditCreate },
    };
    const prisma = {
      schoolMembership: { findFirst: jest.fn().mockResolvedValue(membershipWithRole("SUPER_ADMIN")) },
      academicYear: { findFirst: jest.fn().mockResolvedValue({ id: "year-1" }) },
      form: { findFirst: jest.fn().mockResolvedValue({ id: "form-1" }) },
      house: { findFirst: jest.fn() },
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;

    const result = await new ErpService(prisma).createPupil("school-1", "admin-1", {
      legalFirstName: " Aisha ",
      lastName: " Ahmed ",
      admissionNumber: " ADM0099 ",
      admissionDate: today,
      academicYearId: "year-1",
      yearGroupId: "year-group-1",
      formId: "form-1",
      startsOn: today,
    });

    expect(result).toMatchObject({
      id: "pupil-new",
      personId: "person-new",
      admissionNumber: "ADM0099",
      currentEnrolment: { id: "enrolment-new" },
    });
    expect(personCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ legalFirstName: "Aisha", lastName: "Ahmed" }),
    }));
    expect(enrolmentCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ schoolId: "school-1", pupilId: "pupil-new" }),
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "pupil.created" }),
    }));
  });

  it("returns school-scoped pupil details and audits the profile read", async () => {
    const pupil = {
      id: "pupil-1",
      admissionNumber: "ADM0001",
      person: {
        id: "person-1",
        legalFirstName: "Aisha",
        preferredName: null,
        lastName: "Ahmed",
        dateOfBirth: null,
      },
      enrolments: [],
    };
    const auditCreate = jest.fn().mockResolvedValue({});
    const service = new ErpService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue(membershipWithRole("SUPER_ADMIN")) },
      pupilProfile: { findFirst: jest.fn().mockResolvedValue(pupil) },
      auditEvent: { create: auditCreate },
    } as unknown as PrismaService);

    await expect(service.getPupil("school-1", "admin-1", "pupil-1")).resolves.toMatchObject(pupil);
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "pupil.profile.viewed",
        entityId: "pupil-1",
      }),
    }));
  });

  it("updates only supplied pupil fields and audits the field names", async () => {
    const update = jest.fn().mockResolvedValue({
      id: "pupil-1",
      admissionNumber: "ADM0001",
      upn: null,
      gender: "not_recorded",
      admissionDate: new Date("2020-09-01T00:00:00.000Z"),
      status: "enrolled",
    });
    const auditCreate = jest.fn().mockResolvedValue({});
    const transaction = {
      pupilProfile: { findFirst: jest.fn().mockResolvedValue({ id: "pupil-1", personId: "person-1" }), update },
      person: { update: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: auditCreate },
    };
    const service = new ErpService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue(membershipWithRole("SUPER_ADMIN")) },
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService);

    await service.updatePupil("school-1", "admin-1", "pupil-1", { admissionNumber: "ADM0001" });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { schoolId_id: { schoolId: "school-1", id: "pupil-1" } },
      data: { admissionNumber: "ADM0001" },
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "pupil.profile.updated",
        metadata: { updatedFields: ["admissionNumber"] },
      }),
    }));
  });

  it("allows a person-only pupil update without sending an empty profile update", async () => {
    const findFirstOrThrow = jest.fn().mockResolvedValue({
      id: "pupil-1",
      admissionNumber: "ADM0001",
      upn: null,
      gender: "not_recorded",
      admissionDate: new Date("2020-09-01T00:00:00.000Z"),
      status: "enrolled",
    });
    const profileUpdate = jest.fn();
    const personUpdate = jest.fn().mockResolvedValue({});
    const transaction = {
      pupilProfile: {
        findFirst: jest.fn().mockResolvedValue({ id: "pupil-1", personId: "person-1" }),
        findFirstOrThrow,
        update: profileUpdate,
      },
      person: { update: personUpdate },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new ErpService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue(membershipWithRole("SUPER_ADMIN")) },
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService);

    await service.updatePupil("school-1", "admin-1", "pupil-1", {
      legalFirstName: "Aisha",
    });

    expect(personUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { legalFirstName: "Aisha" },
    }));
    expect(profileUpdate).not.toHaveBeenCalled();
    expect(findFirstOrThrow).toHaveBeenCalledWith(expect.objectContaining({
      where: { schoolId: "school-1", id: "pupil-1" },
    }));
  });

  it("rejects pupil profile updates with no fields", async () => {
    const transaction = jest.fn();
    const service = new ErpService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue(membershipWithRole("SUPER_ADMIN")) },
      $transaction: transaction,
    } as unknown as PrismaService);

    await expect(service.updatePupil("school-1", "admin-1", "pupil-1", {}))
      .rejects.toThrow("Provide at least one pupil field to update.");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("returns pupil contact flags and contact details with a sensitive-read audit", async () => {
    const pupilFindFirst = jest.fn().mockResolvedValue({ id: "pupil-1" });
    const contacts = [{
      relationship: "parent",
      isPrimary: true,
      canCollect: true,
      hasParentalResponsibility: true,
      canViewPortal: true,
      startsOn: new Date("2020-09-01T00:00:00.000Z"),
      endsOn: null,
      guardian: {
        email: "parent@example.test",
        phone: "07000000000",
        landline: null,
        person: {
          id: "parent-person",
          legalFirstName: "Sam",
          preferredName: null,
          lastName: "Ahmed",
        },
      },
    }];
    const findMany = jest.fn().mockResolvedValue(contacts);
    const auditCreate = jest.fn().mockResolvedValue({});
    const service = new ErpService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue(membershipWithRole("SUPER_ADMIN")) },
      pupilProfile: { findFirst: pupilFindFirst },
      pupilContact: { findMany },
      auditEvent: { create: auditCreate },
    } as unknown as PrismaService);

    await expect(service.getPupilContacts("school-1", "admin-1", "pupil-1")).resolves.toMatchObject({
      pupilId: "pupil-1",
      total: 1,
      items: [{
        relationship: "parent",
        canViewPortal: true,
        person: { name: "Sam Ahmed", email: "parent@example.test" },
      }],
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { schoolId: "school-1", pupilId: "pupil-1" },
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "pupil.contacts.viewed" }),
    }));
  });

  it("returns academic structure summaries for the school", async () => {
    const prisma = {
      academicYear: {
        findFirst: jest.fn().mockResolvedValue({
          id: "year-1",
          schoolId: "school-1",
          code: "2026/2027",
          isCurrent: true,
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "year-1",
            schoolId: "school-1",
            code: "2026/2027",
            startsOn: new Date("2026-09-01T00:00:00.000Z"),
            endsOn: new Date("2027-08-31T00:00:00.000Z"),
            isCurrent: true,
          },
        ]),
      },
      term: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "term-1",
            academicYearId: "year-1",
            code: "AUT",
            startsOn: new Date("2026-09-01T00:00:00.000Z"),
            endsOn: new Date("2026-12-18T00:00:00.000Z"),
          },
        ]),
      },
      yearGroup: {
        findMany: jest.fn().mockResolvedValue([
          { id: "yg-7", schoolId: "school-1", code: "7", name: "Year 7", keyStage: "KS3" },
        ]),
      },
      form: {
        findMany: jest.fn().mockResolvedValue([
          { id: "form-1", schoolId: "school-1", code: "7A", yearGroupId: "yg-7" },
        ]),
      },
      house: {
        findMany: jest.fn().mockResolvedValue([
          { id: "house-1", schoolId: "school-1", code: "ASH", name: "Ash" },
        ]),
      },
      subject: {
        findMany: jest.fn().mockResolvedValue([
          { id: "sub-1", schoolId: "school-1", code: "ENG", name: "English" },
        ]),
      },
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue(membershipWithRole("SUPER_ADMIN")),
      },
    } as unknown as PrismaService;

    const service = new ErpService(prisma);
    const structure = await service.getAcademicStructure("school-1", "user-1");

    expect(structure.currentAcademicYear).toMatchObject({ code: "2026/2027" });
    expect(structure.academicYears).toEqual([
      {
        id: "year-1",
        code: "2026/2027",
        startsOn: expect.any(String),
        endsOn: expect.any(String),
        isCurrent: true,
      },
    ]);
    expect(structure.terms).toHaveLength(1);
    expect(structure.yearGroups).toHaveLength(1);
    expect(structure.forms).toHaveLength(1);
    expect(structure.houses).toHaveLength(1);
    expect(structure.subjects).toHaveLength(1);
  });

  it("changes pupil placement by closing the old dated enrolment and auditing both placements", async () => {
    const startsOn = new Date();
    startsOn.setUTCDate(startsOn.getUTCDate() - 1);
    const startDate = startsOn.toISOString().slice(0, 10);
    const previousEnd = new Date(`${startDate}T00:00:00.000Z`);
    previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
    const previousStartsOn = new Date(startsOn);
    previousStartsOn.setUTCDate(previousStartsOn.getUTCDate() - 30);
    const current = {
      id: "enrolment-old",
      startsOn: previousStartsOn,
      academicYearId: "year-1",
      yearGroupId: "year-group-1",
      formId: "form-1",
      houseId: "house-1",
    };
    const next = {
      id: "enrolment-new",
      academicYearId: "year-1",
      yearGroupId: "year-group-2",
      formId: "form-2",
      houseId: null,
      startsOn,
      academicYear: { code: "2026/2027" },
      yearGroup: { code: "8", name: "Year 8" },
      form: { code: "8A" },
      house: null,
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const create = jest.fn().mockResolvedValue(next);
    const auditCreate = jest.fn().mockResolvedValue({});
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "pupil-1" }]),
      pupilProfile: { findFirst: jest.fn().mockResolvedValue({ id: "pupil-1" }) },
      pupilEnrolment: {
        findFirst: jest.fn().mockResolvedValue(current),
        updateMany,
        create,
      },
      academicYear: { findFirst: jest.fn().mockResolvedValue({ id: "year-1" }) },
      form: { findFirst: jest.fn().mockResolvedValue({ id: "form-2" }) },
      house: { findFirst: jest.fn() },
      auditEvent: { create: auditCreate },
    };
    const prisma = {
      schoolMembership: { findFirst: jest.fn().mockResolvedValue(membershipWithRole("SUPER_ADMIN")) },
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;

    const result = await new ErpService(prisma).updatePupilEnrolment(
      "school-1",
      "headteacher-1",
      "pupil-1",
      "enrolment-old",
      {
        academicYearId: "year-1",
        yearGroupId: "year-group-2",
        formId: "form-2",
        startsOn: startDate,
      },
    );

    expect(result).toMatchObject({ pupilId: "pupil-1", previousEnrolmentId: "enrolment-old", enrolment: next });
    expect(transaction.$queryRaw).toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "enrolment-old", schoolId: "school-1", pupilId: "pupil-1", status: "active" },
      data: { endsOn: previousEnd, status: "ended" },
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        schoolId: "school-1",
        pupilId: "pupil-1",
        academicYearId: "year-1",
        yearGroupId: "year-group-2",
        formId: "form-2",
        startsOn: new Date(`${startDate}T00:00:00.000Z`),
        status: "active",
      }),
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "pupil.enrolment.placement_changed",
        metadata: expect.objectContaining({ previousEnrolmentId: "enrolment-old" }),
      }),
    }));
  });

  it("rejects a placement whose form belongs to a different year group without changing history", async () => {
    const startsOn = new Date();
    startsOn.setUTCDate(startsOn.getUTCDate() - 1);
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "pupil-1" }]),
      pupilProfile: { findFirst: jest.fn().mockResolvedValue({ id: "pupil-1" }) },
      pupilEnrolment: {
        findFirst: jest.fn().mockResolvedValue({
          id: "enrolment-old",
          startsOn: new Date("2020-09-01T00:00:00.000Z"),
        }),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      academicYear: { findFirst: jest.fn().mockResolvedValue({ id: "year-1" }) },
      form: { findFirst: jest.fn().mockResolvedValue(null) },
      house: { findFirst: jest.fn() },
    };
    const prisma = {
      schoolMembership: { findFirst: jest.fn().mockResolvedValue(membershipWithRole("SUPER_ADMIN")) },
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;

    await expect(new ErpService(prisma).updatePupilEnrolment(
      "school-1",
      "headteacher-1",
      "pupil-1",
      "enrolment-old",
      {
        academicYearId: "year-1",
        yearGroupId: "year-group-2",
        formId: "wrong-form",
        startsOn: startsOn.toISOString().slice(0, 10),
      },
    )).rejects.toThrow("The selected form does not belong to the selected year group.");
    expect(transaction.pupilEnrolment.updateMany).not.toHaveBeenCalled();
    expect(transaction.pupilEnrolment.create).not.toHaveBeenCalled();
  });

  it("denies pupil placement changes to staff without a management role", async () => {
    const membershipLookup = jest.fn().mockResolvedValue(null);
    const transaction = jest.fn();
    const service = new ErpService({
      schoolMembership: { findFirst: membershipLookup },
      $transaction: transaction,
    } as unknown as PrismaService);

    await expect(service.updatePupilEnrolment(
      "school-1",
      "teacher-1",
      "pupil-1",
      "enrolment-1",
      {
        academicYearId: "year-1",
        yearGroupId: "year-group-2",
        formId: "form-2",
        startsOn: new Date().toISOString().slice(0, 10),
      },
    )).rejects.toThrow("This operation is not permitted for your school role.");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("denies student summaries to users without a student role in that school", async () => {
    const personFindFirst = jest.fn();
    const service = new ErpService({
      schoolMembership: { findMany: jest.fn().mockResolvedValue([]) },
      person: { findFirst: personFindFirst },
    } as unknown as PrismaService);

    await expect(service.getStudentSummary("user-1", "school-1")).rejects.toThrow(
      "Student membership is required to access this record.",
    );
    expect(personFindFirst).not.toHaveBeenCalled();
  });

  it("limits parent child lookup to schools where the user has a parent role", async () => {
    const pupilContactFindMany = jest.fn().mockResolvedValue([]);
    const service = new ErpService({
      schoolMembership: { findMany: jest.fn().mockResolvedValue([{ schoolId: "school-parent" }]) },
      pupilContact: { findMany: pupilContactFindMany },
    } as unknown as PrismaService);

    expect(await service.listParentChildren("user-1")).toEqual([]);
    expect(pupilContactFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        schoolId: { in: ["school-parent"] },
        canViewPortal: true,
        guardian: { person: { userId: "user-1" } },
      }),
    }));
  });

  it("returns all active linked children for a parent within the current portal scope", async () => {
    const sessionDate = new Date();
    sessionDate.setUTCHours(0, 0, 0, 0);
    const service = new ErpService({
      schoolMembership: {
        findMany: jest.fn().mockResolvedValue([
          { schoolId: "school-1" },
          { schoolId: "school-2" },
        ]),
      },
      pupilContact: {
        findMany: jest.fn().mockResolvedValue([
          {
            schoolId: "school-1",
            relationship: "mother",
            pupil: {
              id: "pupil-1",
              admissionNumber: "ADM0001",
              person: { legalFirstName: "Aisha", preferredName: null, lastName: "Ahmed" },
              enrolments: [{
                startsOn: new Date("2000-01-01T00:00:00.000Z"),
                endsOn: null,
                status: "active",
                yearGroup: { code: "7", name: "Year 7" },
                form: { code: "7A" },
              }],
            },
          },
          {
            schoolId: "school-2",
            relationship: "father",
            pupil: {
              id: "pupil-2",
              admissionNumber: "ADM0002",
              person: { legalFirstName: "Noah", preferredName: "N", lastName: "Ahmed" },
              enrolments: [{
                startsOn: new Date("2000-01-01T00:00:00.000Z"),
                endsOn: null,
                status: "active",
                yearGroup: { code: "10", name: "Year 10" },
                form: { code: "10B" },
              }],
            },
          },
        ]),
      },
      attendanceSession: {
        findMany: jest.fn().mockResolvedValue([{
          schoolId: "school-1",
          sessionDate,
          records: [{
            pupilId: "pupil-1",
            code: { countsAsPresent: true },
          }],
        }, {
          schoolId: "school-2",
          sessionDate,
          records: [],
        }]),
      },
    } as unknown as PrismaService);

    await expect(service.listParentChildren("user-1")).resolves.toMatchObject([
      {
        id: "pupil-1",
        schoolId: "school-1",
        relationship: "mother",
        name: "Aisha Ahmed",
        yearGroup: "Year 7",
        form: "7A",
        attendanceRate: 100,
        totalPossibleSessions: 1,
      },
      {
        id: "pupil-2",
        schoolId: "school-2",
        relationship: "father",
        name: "N Ahmed",
        yearGroup: "Year 10",
        form: "10B",
        attendanceRate: 0,
        totalPossibleSessions: 1,
      },
    ]);
  });

  it("returns only an aggregate pupil count to SENCO roles", async () => {
    const count = jest.fn().mockResolvedValue(300);
    const service = new ErpService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue(membershipWithRole("SENCO", ["pupils.read"])) },
      pupilProfile: { count },
    } as unknown as PrismaService);

    await expect(service.getPupilCount("school-1", "senco-user")).resolves.toEqual({ total: 300 });
    expect(count).toHaveBeenCalledWith({ where: { schoolId: "school-1" } });
  });

  it("denies parent sprint 8 communication data when the user is not linked to the pupil", async () => {
    const service = new ErpService({
      schoolMembership: { findMany: jest.fn().mockResolvedValue([{ schoolId: "school-1" }]) },
      pupilContact: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService);

    await expect(service.getParentPupilHomework("user-1", "pupil-1")).rejects.toThrow(
      "You do not have portal access to this pupil's homework.",
    );
  });

  it("returns sprint 8 communication data for an active parent-linked pupil", async () => {
    const service = new ErpService({
      schoolMembership: { findMany: jest.fn().mockResolvedValue([{ schoolId: "school-1" }]) },
      pupilContact: {
        findFirst: jest.fn().mockResolvedValue({
          schoolId: "school-1",
          canViewPortal: true,
          relationship: "mother",
          startsOn: new Date("2024-01-01T00:00:00.000Z"),
          endsOn: null,
          guardian: { person: { userId: "user-1" } },
          pupil: {
            id: "pupil-1",
            person: { legalFirstName: "Aisha", preferredName: null, lastName: "Ahmed" },
            enrolments: [{ yearGroup: { code: "7", name: "Year 7" }, form: { code: "7A" } }],
          },
        }),
      },
    } as unknown as PrismaService);

    await expect(service.getParentPupilHomework("user-1", "pupil-1")).resolves.toMatchObject({
      pupilId: "pupil-1",
      items: expect.arrayContaining([
        expect.objectContaining({ title: expect.any(String), subject: expect.any(String) }),
      ]),
    });

    await expect(service.getParentPupilNotices("user-1", "pupil-1")).resolves.toMatchObject({
      pupilId: "pupil-1",
      items: expect.arrayContaining([
        expect.objectContaining({ tag: expect.any(String), title: expect.any(String) }),
      ]),
    });

    await expect(service.getParentPupilMessages("user-1", "pupil-1")).resolves.toMatchObject({
      pupilId: "pupil-1",
      items: expect.arrayContaining([
        expect.objectContaining({ sender: expect.any(String), topic: expect.any(String) }),
      ]),
    });

    await expect(service.getParentPupilSchoolEvents("user-1", "pupil-1")).resolves.toMatchObject({
      pupilId: "pupil-1",
      items: expect.arrayContaining([
        expect.objectContaining({ day: expect.any(String), title: expect.any(String) }),
      ]),
    });
  });

  it("denies sprint 9 parent operational data when the user has no active pupil relationship", async () => {
    const service = new ErpService({
      schoolMembership: { findMany: jest.fn().mockResolvedValue([{ schoolId: "school-1" }]) },
      pupilContact: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService);

    await expect(service.getParentPupilConsents("user-1", "pupil-1")).rejects.toThrow(
      "You do not have portal access to this pupil's consent records.",
    );
  });

  it("returns sprint 9 parent-safe operational summaries for a linked pupil", async () => {
    const service = new ErpService({
      schoolMembership: { findMany: jest.fn().mockResolvedValue([{ schoolId: "school-1" }]) },
      pupilContact: {
        findFirst: jest.fn().mockResolvedValue({
          schoolId: "school-1",
          canViewPortal: true,
          relationship: "mother",
          startsOn: new Date("2024-01-01T00:00:00.000Z"),
          endsOn: null,
          guardian: { person: { userId: "user-1" } },
          pupil: {
            id: "pupil-1",
            person: { legalFirstName: "Aisha", preferredName: null, lastName: "Ahmed" },
            enrolments: [{ yearGroup: { code: "7", name: "Year 7" }, form: { code: "7A" } }],
          },
        }),
      },
    } as unknown as PrismaService);

    await expect(service.getParentPupilConsents("user-1", "pupil-1")).resolves.toMatchObject({
      pupilId: "pupil-1",
      items: expect.arrayContaining([
        expect.objectContaining({ title: expect.any(String), status: expect.any(String) }),
      ]),
    });

    await expect(service.getParentPupilForms("user-1", "pupil-1")).resolves.toMatchObject({
      pupilId: "pupil-1",
      items: expect.arrayContaining([
        expect.objectContaining({ title: expect.any(String), status: expect.any(String) }),
      ]),
    });

    await expect(service.getParentPupilTrips("user-1", "pupil-1")).resolves.toMatchObject({
      pupilId: "pupil-1",
      items: expect.arrayContaining([
        expect.objectContaining({ title: expect.any(String), status: expect.any(String) }),
      ]),
    });

    await expect(service.getParentPupilContactSummary("user-1", "pupil-1")).resolves.toMatchObject({
      pupilId: "pupil-1",
      contact: expect.objectContaining({
        email: expect.any(String),
        emergencyContacts: expect.any(Array),
      }),
    });
  });

  it("denies sprint 10 parent-safe behaviour data when the user has no active pupil relationship", async () => {
    const service = new ErpService({
      schoolMembership: { findMany: jest.fn().mockResolvedValue([{ schoolId: "school-1" }]) },
      pupilContact: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService);

    await expect(service.getParentPupilAchievements("user-1", "pupil-1")).rejects.toThrow(
      "You do not have portal access to this pupil's achievements.",
    );
    await expect(service.getParentPupilBehaviourSummary("user-1", "pupil-1")).rejects.toThrow(
      "You do not have portal access to this pupil's behaviour summary.",
    );
  });

  it("returns sprint 10 parent-safe achievement and behaviour summaries for a linked pupil", async () => {
    const service = new ErpService({
      schoolMembership: { findMany: jest.fn().mockResolvedValue([{ schoolId: "school-1" }]) },
      pupilContact: {
        findFirst: jest.fn().mockResolvedValue({
          schoolId: "school-1",
          canViewPortal: true,
          relationship: "mother",
          startsOn: new Date("2024-01-01T00:00:00.000Z"),
          endsOn: null,
          guardian: { person: { userId: "user-1" } },
          pupil: {
            id: "pupil-1",
            person: { legalFirstName: "Aisha", preferredName: null, lastName: "Ahmed" },
            enrolments: [{ yearGroup: { code: "7", name: "Year 7" }, form: { code: "7A" } }],
          },
        }),
      },
      behaviourReward: {
        findMany: jest.fn().mockResolvedValue([
          {
            category: "achievement",
            title: "Science excellence",
            details: "Outstanding practical investigation.",
            points: 6,
            occurredAt: new Date("2026-10-02T00:00:00.000Z"),
            parentVisible: true,
          },
        ]),
      },
      behaviourIncident: {
        findMany: jest.fn().mockResolvedValue([
          {
            category: "positive",
            title: "Helpful leadership",
            details: "Supported classmates during group work.",
            points: 3,
            occurredAt: new Date("2026-10-04T00:00:00.000Z"),
            parentVisible: true,
          },
          {
            category: "minor",
            title: "Late to class",
            details: "Late arrival after break.",
            points: -1,
            occurredAt: new Date("2026-10-05T00:00:00.000Z"),
            parentVisible: false,
          },
        ]),
      },
      behaviourSanction: {
        findMany: jest.fn().mockResolvedValue([
          {
            sanctionType: "detention",
            status: "assigned",
            details: "After-school detention.",
            dueAt: new Date("2026-10-08T00:00:00.000Z"),
            parentVisible: true,
          },
        ]),
      },
    } as unknown as PrismaService);

    await expect(service.getParentPupilAchievements("user-1", "pupil-1")).resolves.toMatchObject({
      pupilId: "pupil-1",
      items: expect.arrayContaining([
        expect.objectContaining({ title: "Science excellence", category: "achievement" }),
      ]),
    });

    await expect(service.getParentPupilBehaviourSummary("user-1", "pupil-1")).resolves.toMatchObject({
      pupilId: "pupil-1",
      summary: expect.objectContaining({
        totalRewards: 1,
        totalIncidents: 1,
        activeSanctions: 1,
      }),
    });
  });
});
