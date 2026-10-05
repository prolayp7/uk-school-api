import { ErpService } from "./erp.service";
import type { PrismaService } from "../prisma/prisma.service";

describe("ErpService", () => {
  it("lists pupils in a school with active membership and summary fields", async () => {
    const prisma = {
      person: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "person-1",
            legalFirstName: "Aisha",
            lastName: "Ahmed",
            schoolId: "school-1",
            pupilProfile: {
              id: "pupil-1",
              admissionNumber: "ADM0001",
              status: "enrolled",
            },
          },
          {
            id: "person-2",
            legalFirstName: "Ben",
            lastName: "Bennett",
            schoolId: "school-1",
            pupilProfile: {
              id: "pupil-2",
              admissionNumber: "ADM0002",
              status: "enrolled",
            },
          },
        ]),
      },
      pupilProfile: { count: jest.fn().mockResolvedValue(2) },
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({ id: "membership-1" }),
      },
    } as unknown as PrismaService;

    const service = new ErpService(prisma);
    const pupils = await service.listPupils("school-1", "user-1");

    expect(pupils.total).toBe(2);
    expect(pupils.items[0]).toMatchObject({
      pupilId: "pupil-1",
      admissionNumber: "ADM0001",
      name: "Aisha Ahmed",
    });
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
          { id: "year-1", schoolId: "school-1", code: "2026/2027", isCurrent: true },
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
        findFirst: jest.fn().mockResolvedValue({ id: "membership-1" }),
      },
    } as unknown as PrismaService;

    const service = new ErpService(prisma);
    const structure = await service.getAcademicStructure("school-1", "user-1");

    expect(structure.currentAcademicYear).toMatchObject({ code: "2026/2027" });
    expect(structure.yearGroups).toHaveLength(1);
    expect(structure.forms).toHaveLength(1);
    expect(structure.houses).toHaveLength(1);
    expect(structure.subjects).toHaveLength(1);
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

  it("returns only an aggregate pupil count to SENCO roles", async () => {
    const count = jest.fn().mockResolvedValue(300);
    const service = new ErpService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({ id: "membership-1" }) },
      pupilProfile: { count },
    } as unknown as PrismaService);

    await expect(service.getPupilCount("school-1", "senco-user")).resolves.toEqual({ total: 300 });
    expect(count).toHaveBeenCalledWith({ where: { schoolId: "school-1" } });
  });
});
