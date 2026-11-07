import { Prisma, PrismaClient } from "@prisma/client";

type WebsiteTimelineSeed = {
  seedKey: string;
  slug: string;
  title: string;
  content: Prisma.InputJsonObject;
};

export const schoolTimelineSectionSeed: WebsiteTimelineSeed = {
  seedKey: "school-timeline-journey-through-the-years",
  slug: "components/timeline/our-journey-through-the-years",
  title: "Our Journey Through the Years",
  content: {
    eyebrow: "160 YEARS OF EXCELLENCE",
    heading: "Our Journey Through the Years",
    intro:
      "From a pioneering Victorian grammar school to one of Britain's most respected co-educational independent academies.",
    milestones: [
      {
        marker: "1",
        year: "1864",
        title: "Foundation & Royal Oxford Charter",
        description:
          "Established under letters patent by the Bishop of Gloucester and Oxford scholars to provide rigorous classical training for young scholars of character.",
      },
      {
        marker: "2",
        year: "1928",
        title: "The Quadrangle & Memorial Library",
        description:
          "Major architectural commissioning by Sir Giles Gilbert Scott, creating the monumental library cloister honouring alumni fallen in the Great War.",
      },
      {
        marker: "3",
        year: "1974",
        title: "Co-Education & STEM Expansion",
        description:
          "Welcoming girls into the Sixth Form, opening cutting-edge scientific wings, and pioneering forward-thinking computer science laboratories.",
      },
      {
        marker: "★",
        year: "Today",
        title: "Strategic Horizon 2030",
        description:
          "A £12M sustainable arts and robotics pavilion, complete net-zero carbon campus transition, and expansion of our full 100% means-tested bursary endowment.",
      },
    ],
  },
};

export async function seedSchoolTimelineSection(
  prisma: PrismaClient,
  schoolId: string,
  actorId: string,
): Promise<void> {
  const section = schoolTimelineSectionSeed;

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
          `Cannot seed website timeline "${section.title}": slug "${section.slug}" is already used by another website record.`,
        );
      }

      const publishedAt = new Date();
      await transaction.websitePage.create({
        data: {
          schoolId,
          seedKey: section.seedKey,
          slug: section.slug,
          publishedSlug: section.slug,
          contentType: "timeline",
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
        `Seed-owned website timeline "${section.seedKey}" is missing its initial version.`,
      );
    }

    await transaction.websitePage.update({
      where: { id: existing.id },
      data: {
        slug: section.slug,
        publishedSlug: section.slug,
        contentType: "timeline",
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
