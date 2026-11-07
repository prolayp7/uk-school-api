import { PrismaClient } from "@prisma/client";
import { schoolNavigationSeed, seedSchoolNavigation } from "./navigation.seed";

type SeedVersion = { versionNumber: number };
type SeedPage = {
  id: string;
  schoolId: string;
  seedKey: string | null;
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
      async ({ where }: { where: Record<string, Record<string, string>> }) => {
        const seedKey = where.schoolId_seedKey?.seedKey;
        if (seedKey) {
          return pages.get(seedKey) ?? null;
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
          schoolId: string;
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
          schoolId: data.schoolId,
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

describe("school website navigation seed", () => {
  it("defines the ordered primary, utility, and footer navigation", () => {
    const primary = schoolNavigationSeed.filter(
      (menu) => menu.category === "header",
    );
    const utility = schoolNavigationSeed.filter(
      (menu) => menu.category === "utility",
    );
    const footer = schoolNavigationSeed.filter(
      (menu) => menu.category === "footer",
    );

    expect(primary.map(({ title, sortOrder }) => [title, sortOrder])).toEqual([
      ["Our School", 1],
      ["Learning", 2],
      ["School Life", 3],
      ["Admissions", 4],
      ["News & Events", 5],
      ["Contact", 6],
    ]);
    expect(
      utility.map(({ title, href, sortOrder }) => [title, href, sortOrder]),
    ).toEqual([
      ["Parent Portal", "/parent-portal", 1],
      ["Term Dates", "/term-dates", 2],
      ["Calendar", "/calendar", 3],
      ["Staff Access", "/staff-access", 4],
    ]);

    const megaMenus = primary.filter((menu) => menu.style === "mega");
    expect(megaMenus).toHaveLength(4);
    for (const menu of megaMenus) {
      expect(menu.columns).toHaveLength(4);
      expect(menu.featuredCard).toBeDefined();
    }
    expect(
      megaMenus[0].columns
        ?.flatMap(({ items }) => items)
        .map((item) => item.label),
    ).toEqual([
      "Welcome from the Head",
      "Ethos & Values",
      "Our History",
      "Leadership Team",
      "Governors & Governance",
      "Pastoral Care & Wellbeing",
      "Safeguarding",
      "School Facilities",
      "Policies & Reports",
      "Careers at the School",
    ]);
    expect(
      footer.map(({ seedKey, title, sortOrder }) => [
        seedKey,
        title,
        sortOrder,
      ]),
    ).toEqual([
      ["footer_our_school", "About the School", 1],
      ["footer_learning", "Learning & School Life", 2],
      ["footer_school_life", "Parents & Students", 3],
      ["footer_admissions", "Safeguarding & Support", 4],
      ["footer_quick_links", "Policies & Statutory Information", 5],
      [
        "footer_statutory_information",
        "School Information & Statutory Documents",
        6,
      ],
      ["footer_legal", "Legal Information", 7],
    ]);
    expect(footer.map(({ items }) => items?.map(({ label }) => label))).toEqual(
      [
        [
          "About Us",
          "Headteacher's Welcome",
          "Vision & Values",
          "Leadership Team",
          "Staff Directory",
          "Departments",
          "Contact Us",
          "Vacancies",
        ],
        [
          "Curriculum",
          "Departments",
          "Exam Results",
          "School Performance",
          "Clubs & Activities",
          "School Meals",
          "School Uniform",
          "Transport",
        ],
        [
          "Parent Information",
          "Student Information",
          "Term Dates",
          "School Calendar",
          "Attendance",
          "Homework / Remote Learning",
          "Admissions",
          "Book a Visit",
        ],
        [
          "Safeguarding",
          "SEND Information",
          "Pastoral Care",
          "Pupil Premium",
          "Equality & Inclusion",
          "Online Safety",
          "Accessibility",
          "Report a Concern",
        ],
        [
          "Ofsted Reports",
          "School Performance",
          "Policies & Documents",
          "Admissions Policy",
          "Behaviour Policy",
          "Attendance Policy",
          "Complaints Procedure",
          "Child Protection Policy",
          "Privacy Policy",
        ],
        ["School Information & Statutory Documents"],
        [
          "Privacy Policy",
          "Cookie Policy",
          "Accessibility Statement",
          "Website Terms of Use",
        ],
      ],
    );
  });

  it("is repeatable and preserves unrelated or administrator-edited menus", async () => {
    const { prisma, pages, websitePage } = createSeedDatabase();
    const unrelatedPage: SeedPage = {
      id: "admin-page",
      schoolId: "school-1",
      seedKey: null,
      slug: "custom-admin-menu",
      title: "Custom menu",
      status: "published",
      currentVersionNumber: 1,
      publishedVersionNumber: 1,
      versions: [{ versionNumber: 1 }],
    };
    pages.set("unrelated-admin-record", unrelatedPage);

    await seedSchoolNavigation(prisma, "school-1", "admin-1");
    const editedPage = pages.get("school-main-our-school")!;
    Object.assign(editedPage, {
      slug: "our-school-custom",
      title: "Our School — edited by staff",
      currentVersionNumber: 2,
      publishedVersionNumber: 2,
      versions: [{ versionNumber: 1 }, { versionNumber: 2 }],
    });
    await seedSchoolNavigation(prisma, "school-1", "admin-1");

    expect(pages.size).toBe(18);
    expect(pages.get("unrelated-admin-record")).toBe(unrelatedPage);
    expect(pages.get("school-main-our-school")).toBe(editedPage);
    expect(
      [...pages.values()].filter((page) => page.seedKey !== null),
    ).toHaveLength(17);
    expect(websitePage.update).toHaveBeenCalledTimes(16);
  });
});
