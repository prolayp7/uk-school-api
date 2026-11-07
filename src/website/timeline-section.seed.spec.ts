import { PrismaClient } from "@prisma/client";
import {
  schoolTimelineSectionSeed,
  seedSchoolTimelineSection,
} from "./timeline-section.seed";

type SeedVersion = { versionNumber: number };
type SeedSection = {
  id: string;
  seedKey: string;
  slug: string;
  title: string;
  contentType: string;
  status: string;
  currentVersionNumber: number;
  publishedVersionNumber: number | null;
  versions: SeedVersion[];
};

function createSeedDatabase() {
  const sections = new Map<string, SeedSection>();
  const websitePage = {
    findUnique: jest.fn(
      async ({
        where,
      }: {
        where: {
          schoolId_seedKey?: { seedKey: string };
          schoolId_slug?: { slug: string };
        };
      }) => {
        if (where.schoolId_seedKey) {
          return sections.get(where.schoolId_seedKey.seedKey) ?? null;
        }
        const slug = where.schoolId_slug?.slug;
        return [...sections.values()].find((section) => section.slug === slug)
          ? { id: "slug-collision" }
          : null;
      },
    ),
    create: jest.fn(
      async ({
        data,
      }: {
        data: {
          seedKey: string;
          slug: string;
          title: string;
          contentType: string;
          status: string;
          currentVersionNumber: number;
          publishedVersionNumber: number;
          versions: { create: { versionNumber: number } };
        };
      }) => {
        const section: SeedSection = {
          id: "timeline-1",
          seedKey: data.seedKey,
          slug: data.slug,
          title: data.title,
          contentType: data.contentType,
          status: data.status,
          currentVersionNumber: data.currentVersionNumber,
          publishedVersionNumber: data.publishedVersionNumber,
          versions: [{ versionNumber: data.versions.create.versionNumber }],
        };
        sections.set(data.seedKey, section);
        return section;
      },
    ),
    update: jest.fn(async ({ where }: { where: { id: string } }) =>
      [...sections.values()].find((section) => section.id === where.id),
    ),
  };
  const transaction = { websitePage };
  const prisma = {
    $transaction: jest.fn(
      async (callback: (client: typeof transaction) => Promise<void>) =>
        callback(transaction),
    ),
  } as unknown as PrismaClient;

  return { prisma, sections, websitePage };
}

describe("school timeline section seed", () => {
  it("contains the screenshot heading and all four milestone descriptions", () => {
    const milestones = schoolTimelineSectionSeed.content.milestones as Array<{
      marker: string;
      year: string;
      title: string;
      description: string;
    }>;

    expect(schoolTimelineSectionSeed.content).toMatchObject({
      eyebrow: "160 YEARS OF EXCELLENCE",
      heading: "Our Journey Through the Years",
      intro:
        "From a pioneering Victorian grammar school to one of Britain's most respected co-educational independent academies.",
    });
    expect(milestones.map(({ year, title }) => [year, title])).toEqual([
      ["1864", "Foundation & Royal Oxford Charter"],
      ["1928", "The Quadrangle & Memorial Library"],
      ["1974", "Co-Education & STEM Expansion"],
      ["Today", "Strategic Horizon 2030"],
    ]);
    expect(
      milestones.every(
        ({ marker, description }) => marker.length > 0 && description.length > 0,
      ),
    ).toBe(true);
  });

  it("creates a published reusable timeline and preserves administrator edits", async () => {
    const { prisma, sections, websitePage } = createSeedDatabase();

    await seedSchoolTimelineSection(prisma, "school-1", "admin-1");

    const section = sections.get(schoolTimelineSectionSeed.seedKey)!;
    expect(section).toMatchObject({
      slug: schoolTimelineSectionSeed.slug,
      title: "Our Journey Through the Years",
      contentType: "timeline",
      status: "published",
      currentVersionNumber: 1,
      publishedVersionNumber: 1,
    });
    expect(websitePage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contentType: "timeline",
          versions: {
            create: expect.objectContaining({
              versionNumber: 1,
              content: schoolTimelineSectionSeed.content,
            }),
          },
        }),
      }),
    );

    Object.assign(section, {
      title: "Edited by staff",
      status: "draft",
      currentVersionNumber: 2,
      publishedVersionNumber: 1,
      versions: [{ versionNumber: 1 }, { versionNumber: 2 }],
    });
    await seedSchoolTimelineSection(prisma, "school-1", "admin-1");

    expect(section.title).toBe("Edited by staff");
    expect(websitePage.create).toHaveBeenCalledTimes(1);
    expect(websitePage.update).not.toHaveBeenCalled();
  });

  it("fails when the seed slug already belongs to another record", async () => {
    const { prisma, websitePage } = createSeedDatabase();
    websitePage.findUnique.mockImplementation(async ({ where }) => {
      if (where.schoolId_seedKey) return null;
      return { id: "another-record" };
    });

    await expect(
      seedSchoolTimelineSection(prisma, "school-1", "admin-1"),
    ).rejects.toThrow(/slug "components\/timeline\/our-journey-through-the-years" is already used/);
    expect(websitePage.create).not.toHaveBeenCalled();
  });
});
