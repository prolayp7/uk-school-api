import { Prisma, PrismaClient } from "@prisma/client";

type WebsitePathwaysSeed = {
  seedKey: string;
  slug: string;
  title: string;
  content: Prisma.InputJsonObject;
};

export const schoolPathwaysSectionSeed: WebsitePathwaysSeed = {
  seedKey: "school-pathways-key-pathways",
  slug: "key-pathways",
  title: "Key Pathways",
  content: {
    eyebrow: "KEY PATHWAYS",
    heading: "Explore Our School",
    intro:
      "Detailed resources for prospective families, current students, and our wider alumni network.",
    cards: [
      {
        title: "Headteacher's Welcome",
        description:
          "Read Dr Vance’s personal reflections on educational philosophy and our school motto.",
        href: "/our-school/head",
        linkLabel: "Discover More",
      },
      {
        title: "School Vision & Values",
        description:
          "Discover the ethical foundation and character charter guiding everyday academy life.",
        href: "/our-school/ethos-and-values",
        linkLabel: "Discover More",
      },
      {
        title: "Leadership Team",
        description:
          "Profiles and accountability remits of the Executive Board and Court of Governors.",
        href: "/our-school/leadership",
        linkLabel: "Discover More",
      },
      {
        title: "Staff Directory",
        description:
          "Connect with heads of departments, pastoral housemasters, and support services.",
        href: "/contact/staff",
        linkLabel: "Discover More",
      },
      {
        title: "Curriculum",
        description:
          "Explore our GCSE and A-Level options, Oxbridge extension classes, and EPQ mentorship.",
        href: "/learning",
        linkLabel: "Discover More",
      },
      {
        title: "Departments",
        description:
          "In-depth guides across Humanities, STEM, Performing Arts, Languages, and Sport.",
        href: "/departments",
        linkLabel: "Discover More",
      },
      {
        title: "School Life",
        description:
          "A day in the life: boarding routines, chapel traditions, clubs, and sports fixtures.",
        href: "/school-life",
        linkLabel: "Discover More",
      },
      {
        title: "Admissions",
        description:
          "Key entrance exam dates, registration forms, bursaries, and scholarship criteria.",
        href: "/admissions",
        linkLabel: "Discover More",
      },
    ],
  },
};

export async function seedSchoolPathwaysSection(
  prisma: PrismaClient,
  schoolId: string,
  actorId: string,
): Promise<void> {
  const section = schoolPathwaysSectionSeed;

  await prisma.$transaction(async (transaction) => {
    const existing = await transaction.websitePage.findUnique({
      where: {
        schoolId_seedKey: { schoolId, seedKey: section.seedKey },
      },
      include: {
        versions: {
          where: { versionNumber: 1 },
          select: { versionNumber: true },
        },
      },
    });

    if (!existing) {
      const slugCollision = await transaction.websitePage.findUnique({
        where: { schoolId_slug: { schoolId, slug: section.slug } },
        select: { id: true },
      });
      if (slugCollision) {
        throw new Error(
          `Cannot seed website pathways section "${section.title}": slug "${section.slug}" is already used by another website record.`,
        );
      }

      const publishedAt = new Date();
      await transaction.websitePage.create({
        data: {
          schoolId,
          seedKey: section.seedKey,
          slug: section.slug,
          publishedSlug: section.slug,
          contentType: "pathways",
          title: section.title,
          status: "published",
          currentVersionNumber: 1,
          publishedVersionNumber: 1,
          publishedAt,
          createdById: actorId,
          versions: {
            create: {
              versionNumber: 1,
              slug: section.slug,
              title: section.title,
              status: "published",
              content: section.content,
              createdById: actorId,
              approvedAt: publishedAt,
              publishedAt,
            },
          },
        },
      });
      return;
    }

    if (
      existing.currentVersionNumber !== 1 ||
      existing.publishedVersionNumber !== 1 ||
      existing.status !== "published"
    ) {
      return;
    }

    if (existing.versions.length !== 1) {
      throw new Error(
        `Seed-owned website pathways section "${section.seedKey}" is missing its initial version.`,
      );
    }

    await transaction.websitePage.update({
      where: { id: existing.id },
      data: {
        slug: section.slug,
        publishedSlug: section.slug,
        contentType: "pathways",
        title: section.title,
        status: "published",
        versions: {
          update: {
            where: {
              schoolId_pageId_versionNumber: {
                schoolId,
                pageId: existing.id,
                versionNumber: 1,
              },
            },
            data: {
              slug: section.slug,
              title: section.title,
              status: "published",
              content: section.content,
            },
          },
        },
      },
    });
  });
}
