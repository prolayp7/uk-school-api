import { Prisma, PrismaClient } from "@prisma/client";
import { schoolNavigationSeed } from "./navigation.seed";

type WebsitePageSeed = {
  seedKey: string;
  slug: string;
  title: string;
  content: Prisma.InputJsonObject;
  seoTitle: string;
  seoDescription: string;
};

const pageLinks = schoolNavigationSeed
  .filter((menu) => menu.category === "footer")
  .flatMap((menu) => menu.items ?? []);

export const schoolWebsitePagesSeed: WebsitePageSeed[] = [
  ...new Map(
    pageLinks.map((item): [string, WebsitePageSeed] => {
      const slug = item.href.replace(/^\/+/, "");
      const seed: WebsitePageSeed = {
        seedKey: `school-page-${slug.replaceAll("/", "-")}`,
        slug,
        title: item.label,
        content: {
          heading: item.label,
          intro: `School-approved information about ${item.label.toLowerCase()} will be added to this page.`,
          body: [
            {
              type: "paragraph",
              text: "The school can use this page to publish current information, guidance, and related documents.",
            },
          ],
        },
        seoTitle: item.label,
        seoDescription: `School information about ${item.label}.`,
      };
      return [slug, seed];
    }),
  ).values(),
];

export async function seedSchoolWebsitePages(
  prisma: PrismaClient,
  schoolId: string,
  actorId: string,
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    for (const page of schoolWebsitePagesSeed) {
      const existing = await transaction.websitePage.findUnique({
        where: {
          schoolId_seedKey: { schoolId, seedKey: page.seedKey },
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
          where: { schoolId_slug: { schoolId, slug: page.slug } },
          select: { id: true },
        });
        if (slugCollision) {
          throw new Error(
            `Cannot seed website page "${page.title}": slug "${page.slug}" is already used by a non-seed page.`,
          );
        }

        const publishedAt = new Date();
        await transaction.websitePage.create({
          data: {
            schoolId,
            seedKey: page.seedKey,
            slug: page.slug,
            publishedSlug: page.slug,
            contentType: "page",
            title: page.title,
            status: "published",
            currentVersionNumber: 1,
            publishedVersionNumber: 1,
            publishedAt,
            createdById: actorId,
            versions: {
              create: {
                versionNumber: 1,
                slug: page.slug,
                title: page.title,
                status: "published",
                content: page.content,
                seoTitle: page.seoTitle,
                seoDescription: page.seoDescription,
                createdById: actorId,
                approvedAt: publishedAt,
                publishedAt,
              },
            },
          },
        });
        continue;
      }

      if (
        existing.currentVersionNumber !== 1 ||
        existing.publishedVersionNumber !== 1 ||
        existing.status !== "published"
      ) {
        continue;
      }

      if (existing.versions.length !== 1) {
        throw new Error(
          `Seed-owned website page "${page.seedKey}" is missing its initial version.`,
        );
      }

      await transaction.websitePage.update({
        where: { id: existing.id },
        data: {
          slug: page.slug,
          publishedSlug: page.slug,
          title: page.title,
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
                slug: page.slug,
                title: page.title,
                status: "published",
                content: page.content,
                seoTitle: page.seoTitle,
                seoDescription: page.seoDescription,
              },
            },
          },
        },
      });
    }
  });
}
