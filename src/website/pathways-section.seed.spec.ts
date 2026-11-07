import { PrismaClient } from "@prisma/client";
import {
  schoolPathwaysSectionSeed,
  seedSchoolPathwaysSection,
} from "./pathways-section.seed";

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
          id: "pathways-1",
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

describe("school pathways section seed", () => {
  it("contains the screenshot copy and all eight destination cards", () => {
    const content = schoolPathwaysSectionSeed.content;
    const cards = content.cards as Array<{
      title: string;
      description: string;
      href: string;
      linkLabel: string;
    }>;

    expect(content).toMatchObject({
      eyebrow: "KEY PATHWAYS",
      heading: "Explore Our School",
      intro:
        "Detailed resources for prospective families, current students, and our wider alumni network.",
    });
    expect(cards.map(({ title }) => title)).toEqual([
      "Headteacher's Welcome",
      "School Vision & Values",
      "Leadership Team",
      "Staff Directory",
      "Curriculum",
      "Departments",
      "School Life",
      "Admissions",
    ]);
    expect(
      cards.every(
        ({ description, href, linkLabel }) =>
          description.length > 0 &&
          href.startsWith("/") &&
          linkLabel === "Discover More",
      ),
    ).toBe(true);
  });

  it("creates a published reusable section and preserves administrator edits", async () => {
    const { prisma, sections, websitePage } = createSeedDatabase();

    await seedSchoolPathwaysSection(prisma, "school-1", "admin-1");

    const section = sections.get(schoolPathwaysSectionSeed.seedKey)!;
    expect(section).toMatchObject({
      slug: "key-pathways",
      title: "Key Pathways",
      contentType: "pathways",
      status: "published",
      currentVersionNumber: 1,
      publishedVersionNumber: 1,
    });
    expect(websitePage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contentType: "pathways",
          versions: {
            create: expect.objectContaining({
              versionNumber: 1,
              content: schoolPathwaysSectionSeed.content,
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
    await seedSchoolPathwaysSection(prisma, "school-1", "admin-1");

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
      seedSchoolPathwaysSection(prisma, "school-1", "admin-1"),
    ).rejects.toThrow(/slug "key-pathways" is already used/);
    expect(websitePage.create).not.toHaveBeenCalled();
  });
});
