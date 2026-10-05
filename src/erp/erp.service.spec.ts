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
    } as unknown as PrismaService;

    const service = new ErpService(prisma);
    const pupils = await service.listPupils("school-1");

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
    } as unknown as PrismaService;

    const service = new ErpService(prisma);
    const structure = await service.getAcademicStructure("school-1");

    expect(structure.currentAcademicYear).toMatchObject({ code: "2026/2027" });
    expect(structure.yearGroups).toHaveLength(1);
    expect(structure.forms).toHaveLength(1);
    expect(structure.houses).toHaveLength(1);
    expect(structure.subjects).toHaveLength(1);
  });
});
