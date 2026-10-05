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

  it("returns all active linked children for a parent within the current portal scope", async () => {
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
              enrolments: [{ yearGroup: { code: "7", name: "Year 7" }, form: { code: "7A" } }],
              attendanceRecords: [{ attendanceCode: "P", code: { countsAsPresent: true } }],
            },
          },
          {
            schoolId: "school-2",
            relationship: "father",
            pupil: {
              id: "pupil-2",
              admissionNumber: "ADM0002",
              person: { legalFirstName: "Noah", preferredName: "N", lastName: "Ahmed" },
              enrolments: [{ yearGroup: { code: "10", name: "Year 10" }, form: { code: "10B" } }],
              attendanceRecords: [{ attendanceCode: "L", code: { countsAsPresent: false } }],
            },
          },
        ]),
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
      },
      {
        id: "pupil-2",
        schoolId: "school-2",
        relationship: "father",
        name: "N Ahmed",
        yearGroup: "Year 10",
        form: "10B",
      },
    ]);
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
