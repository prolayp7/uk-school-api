import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHmac } from "node:crypto";
import { requireAnySchoolPermission } from "../auth/school-permissions";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateWebsitePageDto,
  CreateWebsitePageVersionDto,
  PublicWebsiteQueryDto,
  ScheduleWebsitePageDto,
  WebsitePagesQueryDto,
} from "./website.dto";

const CONTENT_FIELDS: Record<string, string[]> = {
  homepage: ["heading", "intro", "heroImageUrl", "body", "primaryCta"],
  page: ["heading", "intro", "heroImageUrl", "body", "primaryCta"],
  navigation: ["items"],
  news: ["summary", "body", "imageUrl", "publishedOn", "category"],
  staff: ["jobTitle", "department", "biography", "imageUrl", "sortOrder"],
  policy: ["summary", "body", "fileUrl", "fileName", "updatedOn", "category"],
  document: ["summary", "fileUrl", "fileName", "updatedOn", "category"],
  admissions: ["summary", "body", "applicationUrl", "steps", "open"],
  results: ["headline", "summary", "body", "academicYear", "publishedOn"],
  school_information: [
    "strapline",
    "address",
    "phone",
    "email",
    "websiteUrl",
    "urn",
    "localAuthority",
  ],
  settings: ["tagline", "logoUrl", "contactEmail", "telephone", "primaryColor", "secondaryColor"],
};

const REQUIRED_CONTENT_FIELDS: Record<string, string[]> = {
  homepage: ["heading"],
  page: ["heading"],
  navigation: ["items"],
  news: ["summary"],
  staff: ["jobTitle"],
  policy: ["summary"],
  document: ["summary", "fileUrl"],
  admissions: ["summary"],
  results: ["headline", "summary"],
  school_information: ["strapline"],
  settings: ["tagline"],
};

type WebsiteEntry = {
  id: string;
  schoolId: string;
  slug: string;
  contentType: string;
  title: string;
  publishedVersionNumber: number | null;
  versions: Array<{
    versionNumber: number;
    slug: string;
    title: string;
    content: Prisma.JsonValue;
    seoTitle: string | null;
    seoDescription: string | null;
    publishedAt: Date | null;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeText(value: unknown, field: string, maxLength = 4000): string {
  if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /\p{Cc}/u.test(normalized)) {
    throw new BadRequestException(`${field} must contain 1 to ${maxLength} valid characters.`);
  }
  return normalized;
}

function sanitizeUrl(value: unknown, field: string): string {
  const url = sanitizeText(value, field, 2048);
  if (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\")) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password) return parsed.toString();
  } catch {
    throw new BadRequestException(`${field} must be an HTTPS URL or a site-relative path.`);
  }
  throw new BadRequestException(`${field} must be an HTTPS URL or a site-relative path.`);
}

function sanitizeBody(value: unknown): Prisma.InputJsonArray {
  if (!Array.isArray(value) || value.length > 100) {
    throw new BadRequestException("body must be an array with no more than 100 content blocks.");
  }
  return value.map((block, index) => {
    if (!isRecord(block) || typeof block.type !== "string") {
      throw new BadRequestException(`body[${index}] must be a typed content block.`);
    }
    const type = block.type;
    const allowedKeys: Record<string, string[]> = {
      paragraph: ["type", "text"],
      heading: ["type", "text", "level"],
      quote: ["type", "text", "citation"],
      image: ["type", "url", "alt"],
      link: ["type", "url", "label"],
    };
    const keys = allowedKeys[type];
    if (!keys || Object.keys(block).some((key) => !keys.includes(key))) {
      throw new BadRequestException(`body[${index}] uses an unsupported content block.`);
    }
    if (type === "image") {
      return {
        type,
        url: sanitizeUrl(block.url, `body[${index}].url`),
        alt: sanitizeText(block.alt, `body[${index}].alt`, 300),
      };
    }
    if (type === "link") {
      return {
        type,
        url: sanitizeUrl(block.url, `body[${index}].url`),
        label: sanitizeText(block.label, `body[${index}].label`, 200),
      };
    }
    if (type === "heading") {
      if (![2, 3, 4].includes(Number(block.level))) {
        throw new BadRequestException(`body[${index}].level must be 2, 3, or 4.`);
      }
      return {
        type,
        text: sanitizeText(block.text, `body[${index}].text`, 1000),
        level: Number(block.level),
      };
    }
    return {
      type,
      text: sanitizeText(block.text, `body[${index}].text`, 4000),
      ...(type === "quote" && block.citation !== undefined
        ? { citation: sanitizeText(block.citation, `body[${index}].citation`, 200) }
        : {}),
    };
  });
}

function sanitizeNavigation(value: unknown): Prisma.InputJsonArray {
  if (!Array.isArray(value) || value.length > 30) {
    throw new BadRequestException("items must contain no more than 30 navigation links.");
  }
  return value.map((item, index) => {
    if (!isRecord(item) || Object.keys(item).some((key) => !["label", "href", "external"].includes(key))) {
      throw new BadRequestException(`items[${index}] contains unsupported navigation data.`);
    }
    const external = item.external === undefined ? false : item.external;
    if (typeof external !== "boolean") {
      throw new BadRequestException(`items[${index}].external must be a boolean.`);
    }
    const href = sanitizeUrl(item.href, `items[${index}].href`);
    if (external && !href.startsWith("https://")) {
      throw new BadRequestException(`items[${index}] external links must use HTTPS.`);
    }
    if (!external && !href.startsWith("/")) {
      throw new BadRequestException(`items[${index}] internal links must be site-relative.`);
    }
    return { label: sanitizeText(item.label, `items[${index}].label`, 100), href, external };
  });
}

function sanitizeSteps(value: unknown): Prisma.InputJsonArray {
  if (!Array.isArray(value) || value.length > 20) {
    throw new BadRequestException("steps must contain no more than 20 items.");
  }
  return value.map((step, index) => sanitizeText(step, `steps[${index}]`, 1000));
}

function sanitizeContent(contentType: string, content: unknown): Prisma.InputJsonObject {
  const allowed = CONTENT_FIELDS[contentType];
  if (!allowed || !isRecord(content)) throw new BadRequestException("A supported content type and object are required.");
  const unknown = Object.keys(content).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new BadRequestException(`Unsupported public content field: ${unknown[0]}.`);
  for (const field of REQUIRED_CONTENT_FIELDS[contentType]) {
    if (content[field] === undefined || content[field] === null || content[field] === "") {
      throw new BadRequestException(`${field} is required for ${contentType} content.`);
    }
  }

  const result: Record<string, Prisma.InputJsonValue> = {};
  for (const [field, value] of Object.entries(content)) {
    if (field === "body") {
      result[field] = sanitizeBody(value);
    } else if (field === "items") {
      result[field] = sanitizeNavigation(value);
    } else if (field === "steps") {
      result[field] = sanitizeSteps(value);
    } else if (field === "primaryCta") {
      if (!isRecord(value) || Object.keys(value).some((key) => !["label", "url"].includes(key))) {
        throw new BadRequestException("primaryCta must contain only label and url.");
      }
      result[field] = {
        label: sanitizeText(value.label, "primaryCta.label", 100),
        url: sanitizeUrl(value.url, "primaryCta.url"),
      };
    } else if (["heroImageUrl", "imageUrl", "fileUrl", "applicationUrl", "websiteUrl", "logoUrl"].includes(field)) {
      result[field] = sanitizeUrl(value, field);
    } else if (field === "open") {
      if (typeof value !== "boolean") throw new BadRequestException("open must be a boolean.");
      result[field] = value;
    } else if (field === "sortOrder") {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 10000) {
        throw new BadRequestException("sortOrder must be an integer between 0 and 10000.");
      }
      result[field] = value;
    } else {
      result[field] = sanitizeText(value, field, field === "address" || field === "biography" ? 4000 : 1000);
    }
  }

  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 64 * 1024) {
    throw new BadRequestException("Website content must not exceed 64 KiB.");
  }
  return result;
}

function publicPaths(contentType: string, slug: string): string[] {
  const paths: Record<string, string[]> = {
    homepage: ["/"],
    page: [`/${slug}`],
    navigation: ["/"],
    news: ["/news", `/news/${slug}`],
    staff: ["/staff"],
    policy: ["/policies", `/policies/${slug}`],
    document: ["/documents", `/documents/${slug}`],
    admissions: ["/admissions"],
    results: ["/results"],
    school_information: ["/", "/contact"],
    settings: ["/"],
  };
  return [...new Set([...(paths[contentType] ?? [`/${slug}`]), "/sitemap.xml"])];
}

function safeProjection(entry: WebsiteEntry) {
  const version = entry.versions.find((item) => item.versionNumber === entry.publishedVersionNumber);
  if (!version || !isRecord(version.content)) return null;
  const content: Record<string, unknown> = {};
  for (const field of CONTENT_FIELDS[entry.contentType] ?? []) {
    if (Object.prototype.hasOwnProperty.call(version.content, field)) {
      content[field] = version.content[field];
    }
  }
  return {
    slug: version.slug,
    title: version.title,
    type: entry.contentType,
    content,
    seo: {
      title: version.seoTitle,
      description: version.seoDescription,
    },
    publishedAt: version.publishedAt,
  };
}

@Injectable()
export class WebsiteService {
  private readonly logger = new Logger(WebsiteService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async requireCmsRole(schoolId: string, userId: string, publisher = false): Promise<void> {
    try {
      await requireAnySchoolPermission(
        this.prisma,
        schoolId,
        userId,
        [publisher ? "website.publish" : "website.edit"],
        "A permitted website editor or publisher role is required.",
      );
    } catch (error) {
      if (!(error instanceof ForbiddenException)) throw error;
      await this.prisma.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "website.cms.access_denied",
          entityType: "website_page",
          metadata: { publisherRequired: publisher },
        },
      });
      throw error;
    }
  }

  private async audit(
    schoolId: string,
    userId: string,
    action: string,
    pageId: string,
    versionNumber?: number,
  ) {
    await this.prisma.auditEvent.create({
      data: {
        schoolId,
        actorUserId: userId,
        action,
        entityType: "website_page",
        entityId: pageId,
        metadata: versionNumber === undefined ? {} : { versionNumber },
      },
    });
  }

  async listPages(schoolId: string, userId: string, query: WebsitePagesQueryDto) {
    await this.requireCmsRole(schoolId, userId);
    const where = {
      schoolId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.contentType ? { contentType: query.contentType } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.websitePage.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: query.offset,
        take: query.limit,
        select: {
          id: true,
          slug: true,
          contentType: true,
          title: true,
          status: true,
          currentVersionNumber: true,
          publishedVersionNumber: true,
          publishedAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.websitePage.count({ where }),
    ]);
    return { items, total, limit: query.limit, offset: query.offset };
  }

  async listVersions(schoolId: string, userId: string, pageId: string) {
    await this.requireCmsRole(schoolId, userId);
    const page = await this.prisma.websitePage.findFirst({
      where: { schoolId, id: pageId },
      select: { id: true },
    });
    if (!page) throw new NotFoundException("Website page not found.");
    const items = await this.prisma.websitePageVersion.findMany({
      where: { schoolId, pageId },
      orderBy: { versionNumber: "desc" },
      select: {
        id: true,
        versionNumber: true,
        slug: true,
        title: true,
        status: true,
        content: true,
        seoTitle: true,
        seoDescription: true,
        createdById: true,
        submittedAt: true,
        reviewedById: true,
        approvedAt: true,
        scheduledAt: true,
        publishedAt: true,
        archivedAt: true,
        createdAt: true,
      },
    });
    return { items, total: items.length };
  }

  async createPage(schoolId: string, userId: string, input: CreateWebsitePageDto) {
    await this.requireCmsRole(schoolId, userId);
    const content = sanitizeContent(input.contentType, input.content);
    return this.prisma.$transaction(async (transaction) => {
      const page = await transaction.websitePage.create({
        data: {
          schoolId,
          slug: input.slug,
          contentType: input.contentType,
          title: input.title.trim(),
          createdById: userId,
          versions: {
            create: {
              versionNumber: 1,
              slug: input.slug,
              title: input.title.trim(),
              content,
              seoTitle: input.seoTitle?.trim() ?? null,
              seoDescription: input.seoDescription?.trim() ?? null,
              createdById: userId,
            },
          },
        },
        select: {
          id: true,
          slug: true,
          contentType: true,
          title: true,
          status: true,
          currentVersionNumber: true,
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "website.page.created",
          entityType: "website_page",
          entityId: page.id,
          metadata: { contentType: page.contentType, slug: page.slug, versionNumber: 1 },
        },
      });
      return page;
    });
  }

  async createVersion(
    schoolId: string,
    userId: string,
    pageId: string,
    input: CreateWebsitePageVersionDto,
  ) {
    await this.requireCmsRole(schoolId, userId);
    return this.prisma.$transaction(async (transaction) => {
      const page = await transaction.websitePage.findFirst({
        where: { schoolId, id: pageId },
        select: {
          id: true,
          slug: true,
          contentType: true,
          title: true,
          status: true,
          currentVersionNumber: true,
        },
      });
      if (!page || page.status === "archived") throw new NotFoundException("Website page not found.");
      const content = sanitizeContent(page.contentType, input.content);
      const versionNumber = page.currentVersionNumber + 1;
      const slug = input.slug ?? page.slug;
      const title = input.title?.trim() ?? page.title;
      const version = await transaction.websitePageVersion.create({
        data: {
          schoolId,
          pageId,
          versionNumber,
          slug,
          title,
          content,
          seoTitle: input.seoTitle?.trim() ?? null,
          seoDescription: input.seoDescription?.trim() ?? null,
          createdById: userId,
        },
        select: { id: true, versionNumber: true, slug: true, title: true, status: true, createdAt: true },
      });
      await transaction.websitePage.update({
        where: { id: pageId },
        data: { slug, title, status: "draft", currentVersionNumber: versionNumber },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "website.page.version.created",
          entityType: "website_page",
          entityId: pageId,
          metadata: { versionNumber },
        },
      });
      return version;
    });
  }

  async submitForReview(schoolId: string, userId: string, pageId: string, versionNumber: number) {
    await this.requireCmsRole(schoolId, userId);
    return this.transition(schoolId, userId, pageId, versionNumber, "draft", "review", {
      submittedAt: new Date(),
    }, "website.page.submitted_for_review");
  }

  async approve(schoolId: string, userId: string, pageId: string, versionNumber: number) {
    await this.requireCmsRole(schoolId, userId, true);
    return this.prisma.$transaction(async (transaction) => {
      const version = await transaction.websitePageVersion.findFirst({
        where: { schoolId, pageId, versionNumber },
        select: { id: true, status: true, createdById: true },
      });
      if (!version || version.status !== "review") {
        throw new ConflictException("Only a version in review can be approved.");
      }
      const page = await transaction.websitePage.findFirst({
        where: { schoolId, id: pageId },
        select: { currentVersionNumber: true },
      });
      if (!page || page.currentVersionNumber !== versionNumber) {
        throw new ConflictException("Only the current page version can be approved.");
      }
      if (version.createdById === userId) {
        throw new ForbiddenException("A page author cannot approve their own version.");
      }
      const updated = await transaction.websitePageVersion.update({
        where: { id: version.id },
        data: { status: "approved", reviewedById: userId, approvedAt: new Date() },
        select: { versionNumber: true, status: true, approvedAt: true },
      });
      await transaction.websitePage.updateMany({
        where: { schoolId, id: pageId, currentVersionNumber: versionNumber },
        data: { status: "approved" },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "website.page.version.approved",
          entityType: "website_page",
          entityId: pageId,
          metadata: { versionNumber },
        },
      });
      return updated;
    });
  }

  async schedule(
    schoolId: string,
    userId: string,
    pageId: string,
    versionNumber: number,
    input: ScheduleWebsitePageDto,
  ) {
    await this.requireCmsRole(schoolId, userId, true);
    const scheduledAt = new Date(input.scheduledAt);
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
      throw new BadRequestException("scheduledAt must be a future date and time.");
    }
    return this.transition(
      schoolId,
      userId,
      pageId,
      versionNumber,
      "approved",
      "scheduled",
      { scheduledAt },
      "website.page.version.scheduled",
    );
  }

  async publish(schoolId: string, userId: string, pageId: string, versionNumber?: number) {
    await this.requireCmsRole(schoolId, userId, true);
    const result = await this.publishVersion(schoolId, pageId, versionNumber, userId);
    const revalidation = await this.revalidatePaths(
      result.schoolCode,
      publicPaths(result.contentType, result.slug),
    );
    return {
      pageId,
      versionNumber: result.versionNumber,
      status: "published",
      publishedAt: result.publishedAt,
      revalidation,
    };
  }

  private async publishVersion(schoolId: string, pageId: string, versionNumber?: number, actorUserId?: string) {
    return this.prisma.$transaction(async (transaction) => {
      const page = await transaction.websitePage.findFirst({
        where: { schoolId, id: pageId },
        select: { id: true, contentType: true, currentVersionNumber: true },
      });
      if (!page) throw new NotFoundException("Website page not found.");
      const targetVersion = versionNumber ?? page.currentVersionNumber;
      if (targetVersion !== page.currentVersionNumber) {
        throw new ConflictException("Only the current page version can be published.");
      }
      const version = await transaction.websitePageVersion.findFirst({
        where: { schoolId, pageId, versionNumber: targetVersion },
        select: { id: true, status: true, scheduledAt: true, slug: true },
      });
      if (!version) throw new NotFoundException("Website page version not found.");
      if (
        version.status !== "approved" &&
        !(version.status === "scheduled" && version.scheduledAt && version.scheduledAt <= new Date())
      ) {
        throw new ConflictException("Only an approved or due scheduled version can be published.");
      }
      const slugConflict = await transaction.websitePage.findFirst({
        where: {
          schoolId,
          contentType: page.contentType,
          publishedSlug: version.slug,
          id: { not: pageId },
        },
        select: { id: true },
      });
      if (slugConflict) {
        throw new ConflictException("This slug is already in use by another published page.");
      }
      const publishedAt = new Date();
      await transaction.websitePageVersion.update({
        where: { id: version.id },
        data: { status: "published", publishedAt },
      });
      await transaction.websitePage.update({
        where: { id: pageId },
        data: {
          slug: version.slug,
          publishedSlug: version.slug,
          status: "published",
          publishedVersionNumber: targetVersion,
          publishedAt,
        },
      });
      const school = await transaction.school.findUnique({
        where: { id: schoolId },
        select: { code: true },
      });
      if (!school) throw new NotFoundException("School not found.");
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: actorUserId ?? null,
          action: "website.page.version.published",
          entityType: "website_page",
          entityId: pageId,
          metadata: { versionNumber: targetVersion },
        },
      });
      return {
        versionNumber: targetVersion,
        publishedAt,
        slug: version.slug,
        contentType: page.contentType,
        schoolCode: school.code,
      };
    });
  }

  async unpublish(schoolId: string, userId: string, pageId: string) {
    await this.requireCmsRole(schoolId, userId, true);
    const result = await this.prisma.$transaction(async (transaction) => {
      const page = await transaction.websitePage.findFirst({
        where: { schoolId, id: pageId },
        select: { id: true, contentType: true, publishedVersionNumber: true, versions: { where: { status: "published" }, orderBy: { versionNumber: "desc" }, take: 1, select: { slug: true } } },
      });
      if (!page) throw new NotFoundException("Website page not found.");
      if (page.publishedVersionNumber === null) throw new ConflictException("This page is not currently published.");
      await transaction.websitePage.update({
        where: { id: pageId },
        data: { status: "draft", publishedSlug: null, publishedVersionNumber: null, publishedAt: null },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "website.page.unpublished",
          entityType: "website_page",
          entityId: pageId,
          metadata: { publishedVersionNumber: page.publishedVersionNumber },
        },
      });
      const school = await transaction.school.findUnique({ where: { id: schoolId }, select: { code: true } });
      if (!school) throw new NotFoundException("School not found.");
      return {
        schoolCode: school.code,
        contentType: page.contentType,
        slug: page.versions[0]?.slug ?? "",
      };
    });
    const revalidation = await this.revalidatePaths(result.schoolCode, publicPaths(result.contentType, result.slug));
    return { pageId, status: "draft", revalidation };
  }

  async archive(schoolId: string, userId: string, pageId: string) {
    await this.requireCmsRole(schoolId, userId, true);
    const page = await this.prisma.websitePage.findFirst({
      where: { schoolId, id: pageId },
      select: { id: true, status: true, publishedVersionNumber: true },
    });
    if (!page) throw new NotFoundException("Website page not found.");
    if (page.publishedVersionNumber !== null) {
      throw new ConflictException("Unpublish a page before archiving it.");
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.websitePage.update({
        where: { id: pageId },
        data: { status: "archived" },
      });
      await transaction.websitePageVersion.updateMany({
        where: { schoolId, pageId, status: { not: "published" } },
        data: { status: "archived", archivedAt: new Date() },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "website.page.archived",
          entityType: "website_page",
          entityId: pageId,
          metadata: {},
        },
      });
    });
    return { pageId, status: "archived" };
  }

  private async transition(
    schoolId: string,
    userId: string,
    pageId: string,
    versionNumber: number,
    expectedStatus: string,
    status: string,
    fields: { submittedAt?: Date; scheduledAt?: Date },
    action: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const version = await transaction.websitePageVersion.findFirst({
        where: { schoolId, pageId, versionNumber },
        select: { id: true, status: true },
      });
      if (!version) throw new NotFoundException("Website page version not found.");
      const page = await transaction.websitePage.findFirst({
        where: { schoolId, id: pageId },
        select: { currentVersionNumber: true },
      });
      if (!page || page.currentVersionNumber !== versionNumber) {
        throw new ConflictException("Only the current page version can change workflow state.");
      }
      if (version.status !== expectedStatus) {
        throw new ConflictException(`Only a ${expectedStatus} version can move to ${status}.`);
      }
      const updated = await transaction.websitePageVersion.update({
        where: { id: version.id },
        data: { status, ...fields },
        select: { versionNumber: true, status: true, submittedAt: true, scheduledAt: true },
      });
      await transaction.websitePage.updateMany({
        where: { schoolId, id: pageId, currentVersionNumber: versionNumber },
        data: { status },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action,
          entityType: "website_page",
          entityId: pageId,
          metadata: { versionNumber },
        },
      });
      return updated;
    });
  }

  async processScheduledPublications(): Promise<number> {
    const published = await this.prisma.$transaction(async (transaction) => {
      const due = await transaction.$queryRaw<Array<{
        school_id: string;
        page_id: string;
        version_number: number;
        content_type: string;
        slug: string;
        school_code: string;
      }>>(Prisma.sql`
        SELECT p.school_id, p.id AS page_id, v.version_number, p.content_type, v.slug, s.code AS school_code
        FROM website_pages p
        JOIN website_page_versions v
          ON v.school_id = p.school_id
         AND v.page_id = p.id
         AND v.version_number = p.current_version_number
        JOIN schools s ON s.id = p.school_id
        WHERE p.status = 'scheduled'
          AND v.status = 'scheduled'
          AND v.scheduled_at <= NOW()
        ORDER BY v.scheduled_at ASC
        LIMIT 20
        FOR UPDATE OF p SKIP LOCKED
      `);
      for (const item of due) {
        const now = new Date();
        await transaction.websitePageVersion.updateMany({
          where: {
            schoolId: item.school_id,
            pageId: item.page_id,
            versionNumber: item.version_number,
            status: "scheduled",
          },
          data: { status: "published", publishedAt: now },
        });
        await transaction.websitePage.updateMany({
          where: {
            schoolId: item.school_id,
            id: item.page_id,
            status: "scheduled",
            currentVersionNumber: item.version_number,
          },
          data: {
            status: "published",
            publishedSlug: item.slug,
            publishedVersionNumber: item.version_number,
            publishedAt: now,
          },
        });
        await transaction.auditEvent.create({
          data: {
            schoolId: item.school_id,
            actorUserId: null,
            action: "website.page.version.published_by_schedule",
            entityType: "website_page",
            entityId: item.page_id,
            metadata: { versionNumber: item.version_number },
          },
        });
      }
      return due;
    });

    for (const item of published) {
      await this.revalidatePaths(item.school_code, publicPaths(item.content_type, item.slug));
    }
    return published.length;
  }

  private async revalidatePaths(schoolCode: string, paths: string[]) {
    const target = process.env.WEBSITE_REVALIDATE_URL;
    const secret = process.env.WEBSITE_REVALIDATE_SECRET;
    if (!target && !secret) {
      this.logger.warn("Website cache revalidation skipped: WEBSITE_REVALIDATE_URL and WEBSITE_REVALIDATE_SECRET are not configured.");
      return { status: "not_configured" as const };
    }
    if (!target || !secret) {
      throw new ServiceUnavailableException("Website revalidation requires both WEBSITE_REVALIDATE_URL and WEBSITE_REVALIDATE_SECRET.");
    }
    const body = JSON.stringify({ schoolCode, paths });
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    let response: Response;
    try {
      response = await fetch(target, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-website-signature": `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      this.logger.error(`Website revalidation request failed (${error instanceof Error ? error.name : "UnknownError"}).`);
      throw new ServiceUnavailableException("Website content was saved, but cache revalidation failed; retry the revalidation endpoint.");
    }
    if (!response.ok) {
      this.logger.error(`Website revalidation endpoint returned HTTP ${response.status}.`);
      throw new ServiceUnavailableException("Website content was saved, but cache revalidation failed; retry the revalidation endpoint.");
    }
    return { status: "completed" as const };
  }

  private async publicSchool(schoolCode: string) {
    const school = await this.prisma.school.findFirst({
      where: { code: schoolCode, status: "active" },
      select: { id: true, code: true, name: true },
    });
    if (!school) throw new NotFoundException("Public school site not found.");
    return school;
  }

  private async publicEntries(schoolId: string, contentType: string, slug?: string): Promise<WebsiteEntry[]> {
    return this.prisma.websitePage.findMany({
      where: {
        schoolId,
        contentType,
        publishedVersionNumber: { not: null },
        ...(slug ? { publishedSlug: slug } : {}),
      },
      orderBy: [{ publishedAt: "desc" }, { slug: "asc" }],
      select: {
        id: true,
        schoolId: true,
        slug: true,
        contentType: true,
        title: true,
        publishedVersionNumber: true,
        versions: {
          where: { status: "published" },
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: {
            versionNumber: true,
            slug: true,
            title: true,
            content: true,
            seoTitle: true,
            seoDescription: true,
            publishedAt: true,
          },
        },
      },
    });
  }

  async publicPage(query: PublicWebsiteQueryDto, slug: string) {
    const school = await this.publicSchool(query.schoolCode);
    const entries = await this.publicEntries(school.id, "page", slug);
    const page = entries.map(safeProjection)[0];
    if (!page) throw new NotFoundException("Published website page not found.");
    return { school: { code: school.code, name: school.name }, page };
  }

  async publicHomepage(query: PublicWebsiteQueryDto) {
    const school = await this.publicSchool(query.schoolCode);
    const [home, settings, navigation, news, events] = await Promise.all([
      this.publicEntries(school.id, "homepage"),
      this.publicEntries(school.id, "settings"),
      this.publicEntries(school.id, "navigation"),
      this.publicEntries(school.id, "news"),
      this.publicEvents(query, school.id, query.limit),
    ]);
    const homePage = home.map(safeProjection)[0] ?? null;
    if (!homePage) throw new NotFoundException("Published homepage content not found.");
    return {
      school: { code: school.code, name: school.name },
      settings: settings.map(safeProjection)[0]?.content ?? {},
      page: homePage,
      navigation: navigation.map(safeProjection)[0]?.content ?? { items: [] },
      news: news.map(safeProjection).filter(Boolean).slice(0, query.limit),
      events,
    };
  }

  async publicContent(query: PublicWebsiteQueryDto, contentType: string) {
    const school = await this.publicSchool(query.schoolCode);
    const entries = await this.publicEntries(school.id, contentType);
    const projections = entries.map(safeProjection).filter(Boolean);
    return {
      school: { code: school.code, name: school.name },
      items: projections.slice(0, query.limit),
      total: projections.length,
    };
  }

  async publicEvents(query: PublicWebsiteQueryDto, schoolId?: string, limit = query.limit) {
    const resolvedSchool = schoolId ? null : await this.publicSchool(query.schoolCode);
    const events = await this.prisma.calendarEvent.findMany({
      where: {
        schoolId: schoolId ?? resolvedSchool!.id,
        audience: "public",
        pupilId: null,
        endsAt: { gte: new Date() },
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: limit,
      select: {
        title: true,
        description: true,
        location: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
      },
    });
    return events;
  }

  async publicSchoolInformation(query: PublicWebsiteQueryDto) {
    const school = await this.publicSchool(query.schoolCode);
    const entries = await this.publicEntries(school.id, "school_information");
    return {
      school: { code: school.code, name: school.name },
      information: entries.map(safeProjection)[0]?.content ?? {},
    };
  }

  async publicNavigation(query: PublicWebsiteQueryDto) {
    const result = await this.publicContent(query, "navigation");
    return { school: result.school, navigation: result.items[0]?.content ?? { items: [] } };
  }

  async publicNews(query: PublicWebsiteQueryDto) {
    return this.publicContent(query, "news");
  }

  async publicStaff(query: PublicWebsiteQueryDto) {
    return this.publicContent(query, "staff");
  }

  async publicPolicies(query: PublicWebsiteQueryDto) {
    return this.publicContent(query, "policy");
  }

  async publicDocuments(query: PublicWebsiteQueryDto) {
    return this.publicContent(query, "document");
  }

  async publicAdmissions(query: PublicWebsiteQueryDto) {
    const result = await this.publicContent(query, "admissions");
    return { school: result.school, items: result.items.slice(0, 1) };
  }

  async publicResults(query: PublicWebsiteQueryDto) {
    return this.publicContent(query, "results");
  }

  async revalidatePage(schoolId: string, userId: string, pageId: string) {
    await this.requireCmsRole(schoolId, userId, true);
    const page = await this.prisma.websitePage.findFirst({
      where: { schoolId, id: pageId },
      select: {
        id: true,
        contentType: true,
        publishedVersionNumber: true,
        versions: {
          where: { status: "published" },
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { slug: true },
        },
      },
    });
    if (!page || page.publishedVersionNumber === null) throw new NotFoundException("Published website page not found.");
    const school = await this.prisma.school.findUnique({ where: { id: schoolId }, select: { code: true } });
    if (!school) throw new NotFoundException("School not found.");
    const revalidation = await this.revalidatePaths(
      school.code,
      publicPaths(page.contentType, page.versions[0]?.slug ?? ""),
    );
    await this.audit(schoolId, userId, "website.page.revalidated", pageId);
    return { pageId, revalidation };
  }
}
