import { PrismaClient } from "@prisma/client";
import { schoolNavigationSeed } from "./navigation.seed";
import {
  schoolWebsitePagesSeed,
  seedSchoolWebsitePages,
} from "./website-pages.seed";

type SeedVersion = { versionNumber: number };
type SeedPage = {
  id: string;
  seedKey: string;
  slug: string;
  title: string;
  status: string;
  currentVersionNumber: number;
  publishedVersionNumber: number | null;
  versions: SeedVersion[];
};

function createSeedDatabase() {
  const pages = new Map<string, SeedPage>();
  let nextId = 1;
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
          return pages.get(where.schoolId_seedKey.seedKey) ?? null;
        }
        const slug = where.schoolId_slug?.slug;
        return [...pages.values()].find((page) => page.slug === slug) ?? null;
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
          status: string;
          currentVersionNumber: number;
          publishedVersionNumber: number;
          versions: { create: { versionNumber: number } };
        };
      }) => {
        const page: SeedPage = {
          id: `page-${nextId++}`,
          seedKey: data.seedKey,
          slug: data.slug,
          title: data.title,
          status: data.status,
          currentVersionNumber: data.currentVersionNumber,
          publishedVersionNumber: data.publishedVersionNumber,
          versions: [{ versionNumber: data.versions.create.versionNumber }],
        };
        pages.set(data.seedKey, page);
        return page;
      },
    ),
    update: jest.fn(
      async ({ where }: { where: { id: string } }) =>
        [...pages.values()].find((page) => page.id === where.id) ?? null,
    ),
  };
  const transaction = { websitePage };
  const prisma = {
    $transaction: jest.fn(
      async (callback: (client: typeof transaction) => Promise<void>) =>
        callback(transaction),
    ),
  } as unknown as PrismaClient;

  return { prisma, pages, websitePage };
}

describe("school website page seed", () => {
  it("creates a page for every unique footer-menu destination", () => {
    const footerHrefs = schoolNavigationSeed
      .filter((menu) => menu.category === "footer")
      .flatMap((menu) => menu.items ?? [])
      .map(({ href }) => href.replace(/^\/+/, ""));

    expect(schoolWebsitePagesSeed.map(({ slug }) => slug).sort()).toEqual(
      [...new Set(footerHrefs)].sort(),
    );
    expect(schoolWebsitePagesSeed).toHaveLength(42);
    expect(
      schoolWebsitePagesSeed.every(
        ({ content, slug, seedKey }) =>
          slug.length > 0 &&
          seedKey === `school-page-${slug.replaceAll("/", "-")}` &&
          content.heading !== undefined &&
          content.body !== undefined,
      ),
    ).toBe(true);
  });

  it("is repeatable and preserves pages edited by administrators", async () => {
    const { prisma, pages, websitePage } = createSeedDatabase();
    const adminEditedSeed = schoolWebsitePagesSeed[0];

    await seedSchoolWebsitePages(prisma, "school-1", "admin-1");
    const editedPage = pages.get(adminEditedSeed.seedKey)!;
    Object.assign(editedPage, {
      title: "Edited by staff",
      currentVersionNumber: 2,
      publishedVersionNumber: 2,
      versions: [{ versionNumber: 1 }, { versionNumber: 2 }],
    });

    await seedSchoolWebsitePages(prisma, "school-1", "admin-1");

    expect(pages.size).toBe(schoolWebsitePagesSeed.length);
    expect(editedPage.title).toBe("Edited by staff");
    expect(websitePage.create).toHaveBeenCalledTimes(
      schoolWebsitePagesSeed.length,
    );
    expect(websitePage.update).toHaveBeenCalledTimes(
      schoolWebsitePagesSeed.length - 1,
    );
  });
});
