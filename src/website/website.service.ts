import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHmac } from "node:crypto";
import sharp from "sharp";
import { requireAnySchoolPermission } from "../auth/school-permissions";
import { FileStorageService } from "../common/file-storage.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateWebsiteBlogDto,
  CreateWebsiteMenuDto,
  CreateWebsitePageDto,
  CreateWebsitePageVersionDto,
  PublicWebsiteQueryDto,
  ScheduleWebsitePageDto,
  WebsitePagesQueryDto,
} from "./website.dto";

const CONTENT_FIELDS: Record<string, string[]> = {
  homepage: ["heading", "intro", "heroImageUrl", "body", "primaryCta"],
  page: ["heading", "intro", "heroImageUrl", "body", "primaryCta"],
  pathways: ["eyebrow", "heading", "intro", "cards"],
  timeline: ["eyebrow", "heading", "intro", "milestones"],
  navigation: [
    "items",
    "category",
    "style",
    "href",
    "external",
    "columns",
    "sortOrder",
    "eyebrow",
    "featuredCard",
    "active",
  ],
  news: ["summary", "body", "imageUrl", "publishedOn", "category"],
  blog: [
    "excerpt",
    "mainImageUrl",
    "body",
    "metaKeywords",
    "openGraph",
    "twitter",
    "schema",
  ],
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
  settings: [
    "tagline",
    "logoUrl",
    "contactEmail",
    "telephone",
    "primaryColor",
    "secondaryColor",
  ],
};

const REQUIRED_CONTENT_FIELDS: Record<string, string[]> = {
  homepage: ["heading"],
  page: ["heading"],
  pathways: ["eyebrow", "heading", "intro", "cards"],
  timeline: ["eyebrow", "heading", "intro", "milestones"],
  navigation: ["items"],
  news: ["summary"],
  blog: ["body"],
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
  if (typeof value !== "string")
    throw new BadRequestException(`${field} must be text.`);
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maxLength ||
    /\p{Cc}/u.test(normalized)
  ) {
    throw new BadRequestException(
      `${field} must contain 1 to ${maxLength} valid characters.`,
    );
  }
  return normalized;
}

function sanitizeUrl(value: unknown, field: string): string {
  const url = sanitizeText(value, field, 2048);
  if (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\"))
    return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password)
      return parsed.toString();
  } catch {
    throw new BadRequestException(
      `${field} must be an HTTPS URL or a site-relative path.`,
    );
  }
  throw new BadRequestException(
    `${field} must be an HTTPS URL or a site-relative path.`,
  );
}

function sanitizeBody(value: unknown): Prisma.InputJsonArray {
  if (!Array.isArray(value) || value.length > 100) {
    throw new BadRequestException(
      "body must be an array with no more than 100 content blocks.",
    );
  }
  return value.map((block, index) => {
    if (!isRecord(block) || typeof block.type !== "string") {
      throw new BadRequestException(
        `body[${index}] must be a typed content block.`,
      );
    }
    const type = block.type;
    const allowedKeys: Record<string, string[]> = {
      paragraph: ["type", "text"],
      heading: ["type", "text", "level"],
      quote: ["type", "text", "citation"],
      image: ["type", "url", "alt"],
      link: ["type", "url", "label"],
      pathways: ["type", "componentId"],
      timeline: ["type", "componentId"],
      "headteacher-welcome": ["type", "content"],
    };
    const keys = allowedKeys[type];
    if (!keys || Object.keys(block).some((key) => !keys.includes(key))) {
      throw new BadRequestException(
        `body[${index}] uses an unsupported content block.`,
      );
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
    if (type === "pathways" || type === "timeline") {
      if (
        typeof block.componentId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          block.componentId,
        )
      ) {
        throw new BadRequestException(
          `body[${index}].componentId must identify a reusable section.`,
        );
      }
      return {
        type,
        componentId: block.componentId,
      };
    }
    if (type === "headteacher-welcome") {
      if (!isRecord(block.content)) {
        throw new BadRequestException(
          `body[${index}].content must contain the headteacher welcome fields.`,
        );
      }
      const content = block.content;
      const allowedContentKeys = [
        "image",
        "imageAlt",
        "roleBadge",
        "heading",
        "quote",
        "description",
        "philosophy",
        "signature",
        "name",
        "qualifications",
        "designation",
        "ctaText",
        "ctaUrl",
      ];
      if (
        Object.keys(content).length !== allowedContentKeys.length ||
        Object.keys(content).some((key) => !allowedContentKeys.includes(key))
      ) {
        throw new BadRequestException(
          `body[${index}].content contains unsupported or missing headteacher welcome fields.`,
        );
      }
      return {
        type,
        content: {
          image: sanitizeUrl(content.image, `body[${index}].content.image`),
          imageAlt: sanitizeText(
            content.imageAlt,
            `body[${index}].content.imageAlt`,
            300,
          ),
          roleBadge: sanitizeText(
            content.roleBadge,
            `body[${index}].content.roleBadge`,
            200,
          ),
          heading: sanitizeText(
            content.heading,
            `body[${index}].content.heading`,
            200,
          ),
          quote: sanitizeText(
            content.quote,
            `body[${index}].content.quote`,
            1000,
          ),
          description: sanitizeText(
            content.description,
            `body[${index}].content.description`,
            4000,
          ),
          philosophy: sanitizeText(
            content.philosophy,
            `body[${index}].content.philosophy`,
            4000,
          ),
          signature: sanitizeText(
            content.signature,
            `body[${index}].content.signature`,
            100,
          ),
          name: sanitizeText(
            content.name,
            `body[${index}].content.name`,
            200,
          ),
          qualifications: sanitizeText(
            content.qualifications,
            `body[${index}].content.qualifications`,
            200,
          ),
          designation: sanitizeText(
            content.designation,
            `body[${index}].content.designation`,
            200,
          ),
          ctaText: sanitizeText(
            content.ctaText,
            `body[${index}].content.ctaText`,
            200,
          ),
          ctaUrl: sanitizeUrl(
            content.ctaUrl,
            `body[${index}].content.ctaUrl`,
          ),
        },
      };
    }
    if (type === "heading") {
      if (![2, 3, 4].includes(Number(block.level))) {
        throw new BadRequestException(
          `body[${index}].level must be 2, 3, or 4.`,
        );
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
        ? {
            citation: sanitizeText(
              block.citation,
              `body[${index}].citation`,
              200,
            ),
          }
        : {}),
    };
  });
}

const BLOG_NODES = new Set([
  "doc",
  "paragraph",
  "heading",
  "text",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "hardBreak",
  "horizontalRule",
  "codeBlock",
  "image",
  "blogVideo",
  "blogCallout",
  "blogMediaSlot",
  "blogTextSlot",
  "blogSideBySide",
  "blogTableOfContents",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
]);
const BLOG_MARKS = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "link",
  "highlight",
  "blogTextColor",
]);
const BLOG_TEXT_COLORS = new Set([
  "#7a1621",
  "#175cd3",
  "#067647",
  "#6941c6",
  "#344054",
]);
const BLOG_HIGHLIGHT_COLORS = new Set(["#fff1a6"]);
const BLOG_MEDIA_PROVIDERS = new Set(["youtube", "vimeo", "hosted"]);

function sanitizeBlogUrl(value: unknown, field: string): string {
  return sanitizeUrl(value, field);
}

function sanitizeSchemaMarkup(value: string, expectedType: unknown): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new BadRequestException("schema.markup must be valid JSON-LD.");
  }
  if (!isRecord(parsed))
    throw new BadRequestException("schema.markup must be a JSON object.");
  const allowedFields = [
    "@context",
    "@type",
    "headline",
    "description",
    "keywords",
    "image",
    "mainEntityOfPage",
  ];
  if (Object.keys(parsed).some((key) => !allowedFields.includes(key))) {
    throw new BadRequestException(
      "schema.markup contains unsupported JSON-LD fields.",
    );
  }
  if (parsed["@context"] !== "https://schema.org") {
    throw new BadRequestException(
      "schema.markup must use the schema.org context.",
    );
  }
  const type = parsed["@type"];
  if (
    typeof type !== "string" ||
    !["BlogPosting", "Article", "NewsArticle"].includes(type) ||
    (expectedType !== undefined && expectedType !== type)
  ) {
    throw new BadRequestException(
      "schema.markup type must match the selected schema type.",
    );
  }
  const result: Record<string, Prisma.InputJsonValue> = {
    "@context": "https://schema.org",
    "@type": type,
  };
  for (const [key, item] of Object.entries(parsed)) {
    if (key === "@context" || key === "@type") continue;
    if (key === "image" || key === "mainEntityOfPage") {
      result[key] = sanitizeBlogUrl(item, `schema.markup.${key}`);
    } else if (key === "keywords" && Array.isArray(item) && item.length <= 50) {
      result[key] = item.map((keyword, index) =>
        sanitizeText(keyword, `schema.markup.keywords[${index}]`, 100),
      );
    } else if (typeof item === "string") {
      result[key] = sanitizeText(item, `schema.markup.${key}`, 2000);
    } else {
      throw new BadRequestException(
        `schema.markup.${key} has an invalid value.`,
      );
    }
  }
  return JSON.stringify(result);
}

function sanitizeBlogJson(value: unknown): Prisma.InputJsonValue {
  let nodeCount = 0;
  const sanitizeMark = (
    mark: unknown,
    path: string,
  ): Prisma.InputJsonObject => {
    if (
      !isRecord(mark) ||
      typeof mark.type !== "string" ||
      !BLOG_MARKS.has(mark.type)
    ) {
      throw new BadRequestException(`${path} uses an unsupported text mark.`);
    }
    const allowedKeys =
      mark.type === "link" ? ["type", "attrs"] : ["type", "attrs"];
    if (Object.keys(mark).some((key) => !allowedKeys.includes(key))) {
      throw new BadRequestException(`${path} contains unsupported mark data.`);
    }
    if (mark.attrs === undefined) return { type: mark.type };
    if (!isRecord(mark.attrs))
      throw new BadRequestException(`${path}.attrs must be an object.`);
    if (mark.type === "link") {
      if (
        Object.keys(mark.attrs).some(
          (key) => !["href", "target", "rel", "class"].includes(key),
        )
      ) {
        throw new BadRequestException(
          `${path}.attrs contains unsupported link data.`,
        );
      }
      const target = mark.attrs.target;
      if (
        target !== undefined &&
        target !== null &&
        target !== "_blank" &&
        target !== "_self"
      ) {
        throw new BadRequestException(`${path}.attrs.target is not supported.`);
      }
      const href = sanitizeBlogUrl(mark.attrs.href, `${path}.attrs.href`);
      return {
        type: "link",
        attrs: {
          href,
          target: target ?? "_blank",
          rel: "noreferrer noopener",
        },
      };
    }
    const allowedAttrNames =
      mark.type === "highlight"
        ? ["color"]
        : mark.type === "blogTextColor"
          ? ["color"]
          : [];
    if (
      Object.keys(mark.attrs).some((key) => !allowedAttrNames.includes(key))
    ) {
      throw new BadRequestException(
        `${path}.attrs contains unsupported mark data.`,
      );
    }
    if (mark.type === "highlight" || mark.type === "blogTextColor") {
      const color = mark.attrs.color;
      const allowedColors =
        mark.type === "highlight" ? BLOG_HIGHLIGHT_COLORS : BLOG_TEXT_COLORS;
      if (
        color !== undefined &&
        color !== null &&
        (typeof color !== "string" || !allowedColors.has(color.toLowerCase()))
      ) {
        throw new BadRequestException(`${path}.attrs.color is not supported.`);
      }
      return color === undefined || color === null
        ? { type: mark.type }
        : { type: mark.type, attrs: { color: color.toLowerCase() } };
    }
    return { type: mark.type };
  };

  const sanitizeNode = (
    node: unknown,
    path: string,
    depth: number,
  ): Prisma.InputJsonObject => {
    nodeCount += 1;
    if (nodeCount > 5000 || depth > 24) {
      throw new BadRequestException(
        "Blog content has too many or deeply nested editor nodes.",
      );
    }
    if (
      !isRecord(node) ||
      typeof node.type !== "string" ||
      !BLOG_NODES.has(node.type)
    ) {
      throw new BadRequestException(`${path} uses an unsupported editor node.`);
    }
    const allowedKeys = ["type", "text", "attrs", "content", "marks"];
    if (Object.keys(node).some((key) => !allowedKeys.includes(key))) {
      throw new BadRequestException(
        `${path} contains unsupported editor data.`,
      );
    }
    const result: Record<string, Prisma.InputJsonValue> = { type: node.type };
    if (node.type === "text") {
      if (
        typeof node.text !== "string" ||
        node.text.length > 10000 ||
        /\p{Cc}/u.test(node.text)
      ) {
        throw new BadRequestException(
          `${path}.text must contain at most 10000 valid characters.`,
        );
      }
      result.text = node.text;
    } else if (node.text !== undefined) {
      throw new BadRequestException(
        `${path}.text is only allowed on text nodes.`,
      );
    }
    if (node.attrs !== undefined) {
      if (!isRecord(node.attrs))
        throw new BadRequestException(`${path}.attrs must be an object.`);
      const attrs = node.attrs;
      const attrKeys: Record<string, string[]> = {
        paragraph: ["textAlign"],
        heading: ["level", "id", "textAlign"],
        orderedList: ["start", "type"],
        image: ["src", "alt", "title", "width", "height"],
        blogVideo: ["src", "provider", "title"],
        blogCallout: ["tone"],
        blogSideBySide: ["mediaPosition"],
        blogTableOfContents: ["items"],
        tableCell: ["colspan", "rowspan", "colwidth"],
        tableHeader: ["colspan", "rowspan", "colwidth"],
      };
      const allowedAttrs = attrKeys[node.type] ?? [];
      if (Object.keys(attrs).some((key) => !allowedAttrs.includes(key))) {
        throw new BadRequestException(
          `${path}.attrs contains unsupported ${node.type} data.`,
        );
      }
      const sanitizedAttrs: Record<string, Prisma.InputJsonValue> = {};
      for (const [key, attr] of Object.entries(attrs)) {
        if (attr === null) continue;
        if (key === "src") {
          sanitizedAttrs[key] = sanitizeBlogUrl(attr, `${path}.attrs.src`);
        } else if (key === "href") {
          sanitizedAttrs[key] = sanitizeBlogUrl(attr, `${path}.attrs.href`);
        } else if (key === "provider") {
          if (typeof attr !== "string" || !BLOG_MEDIA_PROVIDERS.has(attr)) {
            throw new BadRequestException(
              `${path}.attrs.provider is not supported.`,
            );
          }
          sanitizedAttrs[key] = attr;
        } else if (key === "tone") {
          if (attr !== "cream" && attr !== "rose" && attr !== "sage") {
            throw new BadRequestException(
              `${path}.attrs.tone is not supported.`,
            );
          }
          sanitizedAttrs[key] = attr;
        } else if (key === "mediaPosition") {
          if (attr !== "left" && attr !== "right") {
            throw new BadRequestException(
              `${path}.attrs.mediaPosition is not supported.`,
            );
          }
          sanitizedAttrs[key] = attr;
        } else if (key === "level") {
          if (typeof attr !== "number" || ![1, 2, 3, 4, 5, 6].includes(attr)) {
            throw new BadRequestException(
              `${path}.attrs.level must be between 1 and 6.`,
            );
          }
          sanitizedAttrs[key] = attr;
        } else if (key === "textAlign") {
          if (
            attr !== "left" &&
            attr !== "center" &&
            attr !== "right" &&
            attr !== "justify"
          ) {
            throw new BadRequestException(
              `${path}.attrs.textAlign is not supported.`,
            );
          }
          sanitizedAttrs[key] = attr;
        } else if (key === "start" || key === "width" || key === "height") {
          if (
            typeof attr !== "number" ||
            !Number.isInteger(attr) ||
            attr < 1 ||
            attr > 10000
          ) {
            throw new BadRequestException(
              `${path}.attrs.${key} must be a positive integer.`,
            );
          }
          sanitizedAttrs[key] = attr;
        } else if (key === "colspan" || key === "rowspan") {
          if (
            typeof attr !== "number" ||
            !Number.isInteger(attr) ||
            attr < 1 ||
            attr > 20
          ) {
            throw new BadRequestException(
              `${path}.attrs.${key} must be between 1 and 20.`,
            );
          }
          sanitizedAttrs[key] = attr;
        } else if (key === "colwidth") {
          if (
            !Array.isArray(attr) ||
            attr.length > 20 ||
            attr.some(
              (width) =>
                width !== null &&
                (typeof width !== "number" ||
                  !Number.isInteger(width) ||
                  width < 1 ||
                  width > 10000),
            )
          ) {
            throw new BadRequestException(
              `${path}.attrs.colwidth must contain valid column widths.`,
            );
          }
          sanitizedAttrs[key] = attr;
        } else if (key === "items") {
          if (!Array.isArray(attr) || attr.length > 100) {
            throw new BadRequestException(
              `${path}.attrs.items must be an array with at most 100 entries.`,
            );
          }
          sanitizedAttrs[key] = attr.map((item, index) => {
            if (
              !isRecord(item) ||
              Object.keys(item).some(
                (itemKey) => !["id", "label"].includes(itemKey),
              )
            ) {
              throw new BadRequestException(
                `${path}.attrs.items[${index}] is invalid.`,
              );
            }
            return {
              id: sanitizeText(
                item.id,
                `${path}.attrs.items[${index}].id`,
                180,
              ),
              label: sanitizeText(
                item.label,
                `${path}.attrs.items[${index}].label`,
                1000,
              ),
            };
          });
        } else if (typeof attr === "string") {
          sanitizedAttrs[key] = sanitizeText(
            attr,
            `${path}.attrs.${key}`,
            1000,
          );
        } else if (typeof attr === "boolean") {
          sanitizedAttrs[key] = attr;
        } else {
          throw new BadRequestException(
            `${path}.attrs.${key} has an invalid value.`,
          );
        }
      }
      result.attrs = sanitizedAttrs;
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content) || node.content.length > 5000) {
        throw new BadRequestException(
          `${path}.content must be an array of editor nodes.`,
        );
      }
      result.content = node.content.map((child, index) =>
        sanitizeNode(child, `${path}.content[${index}]`, depth + 1),
      );
    }
    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks) || node.marks.length > 10) {
        throw new BadRequestException(
          `${path}.marks must contain no more than 10 text marks.`,
        );
      }
      result.marks = node.marks.map((mark, index) =>
        sanitizeMark(mark, `${path}.marks[${index}]`),
      );
    }
    return result;
  };

  if (
    !isRecord(value) ||
    value.type !== "doc" ||
    Object.keys(value).some((key) => !["type", "content"].includes(key))
  ) {
    throw new BadRequestException(
      "body must be a TipTap document JSON object.",
    );
  }
  const result = sanitizeNode(value, "body", 0);
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 1024 * 1024) {
    throw new BadRequestException("Blog body must not exceed 1 MiB.");
  }
  return result;
}

function sanitizeBlogMetadata(
  value: unknown,
  field: "openGraph" | "twitter" | "schema",
): Prisma.InputJsonObject {
  if (!isRecord(value))
    throw new BadRequestException(`${field} must be an object.`);
  const allowed =
    field === "openGraph"
      ? ["title", "description", "imageUrl", "url", "siteName"]
      : field === "twitter"
        ? ["card", "title", "description", "imageUrl", "site"]
        : ["type", "markup"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new BadRequestException(`${field} contains unsupported metadata.`);
  }
  const result: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null || item === "") continue;
    if (field === "schema" && key === "type") {
      if (!["BlogPosting", "Article", "NewsArticle"].includes(String(item))) {
        throw new BadRequestException("schema.type is not supported.");
      }
      result[key] = String(item);
    } else if (field === "twitter" && key === "card") {
      if (item !== "summary" && item !== "summary_large_image") {
        throw new BadRequestException("twitter.card is not supported.");
      }
      result[key] = item;
    } else if (field === "schema" && key === "markup") {
      if (typeof item !== "string" || item.length > 20000) {
        throw new BadRequestException(
          "schema.markup must contain at most 20000 characters.",
        );
      }
      result[key] = sanitizeSchemaMarkup(item, value.type);
    } else if (
      (field === "openGraph" && ["imageUrl", "url"].includes(key)) ||
      (field === "twitter" && key === "imageUrl")
    ) {
      result[key] = sanitizeBlogUrl(item, `${field}.${key}`);
    } else if (typeof item === "string") {
      result[key] = sanitizeText(
        item,
        `${field}.${key}`,
        field === "schema" ? 20000 : 2000,
      );
    } else {
      throw new BadRequestException(`${field}.${key} must be text.`);
    }
  }
  return result;
}

function sanitizeBlogContent(content: unknown): Prisma.InputJsonObject {
  if (!isRecord(content))
    throw new BadRequestException("Blog content must be an object.");
  const allowedFields = [
    "excerpt",
    "mainImageUrl",
    "body",
    "metaKeywords",
    "openGraph",
    "twitter",
    "schema",
  ];
  const unsupported = Object.keys(content).find(
    (field) => !allowedFields.includes(field),
  );
  if (unsupported)
    throw new BadRequestException(
      `Unsupported blog content field: ${unsupported}.`,
    );
  if (content.body === undefined)
    throw new BadRequestException("body is required for blog content.");

  const result: Record<string, Prisma.InputJsonValue> = {
    body: sanitizeBlogJson(content.body),
  };
  if (content.excerpt !== undefined) {
    if (
      typeof content.excerpt !== "string" ||
      content.excerpt.length > 320 ||
      /\p{Cc}/u.test(content.excerpt)
    ) {
      throw new BadRequestException(
        "excerpt must contain at most 320 valid characters.",
      );
    }
    result.excerpt = content.excerpt.trim();
  }
  if (
    content.mainImageUrl !== undefined &&
    content.mainImageUrl !== null &&
    content.mainImageUrl !== ""
  ) {
    result.mainImageUrl = sanitizeBlogUrl(content.mainImageUrl, "mainImageUrl");
  }
  if (content.metaKeywords !== undefined && content.metaKeywords !== "") {
    if (typeof content.metaKeywords === "string") {
      if (
        content.metaKeywords.length > 2000 ||
        /\p{Cc}/u.test(content.metaKeywords)
      ) {
        throw new BadRequestException(
          "metaKeywords must contain at most 2000 valid characters.",
        );
      }
      result.metaKeywords = content.metaKeywords.trim();
    } else if (
      Array.isArray(content.metaKeywords) &&
      content.metaKeywords.length <= 50
    ) {
      result.metaKeywords = content.metaKeywords.map((keyword, index) =>
        sanitizeText(keyword, `metaKeywords[${index}]`, 100),
      );
    } else {
      throw new BadRequestException(
        "metaKeywords must be text or an array of up to 50 keywords.",
      );
    }
  }
  for (const field of ["openGraph", "twitter", "schema"] as const) {
    if (content[field] !== undefined)
      result[field] = sanitizeBlogMetadata(content[field], field);
  }
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 2 * 1024 * 1024) {
    throw new BadRequestException("Blog content must not exceed 2 MiB.");
  }
  return result;
}

function sanitizeNavigation(value: unknown): Prisma.InputJsonArray {
  if (!Array.isArray(value) || value.length > 30) {
    throw new BadRequestException(
      "items must contain no more than 30 navigation links.",
    );
  }
  return value.map((item, index) => {
    if (
      !isRecord(item) ||
      Object.keys(item).some(
        (key) => !["label", "href", "external"].includes(key),
      )
    ) {
      throw new BadRequestException(
        `items[${index}] contains unsupported navigation data.`,
      );
    }
    const external = item.external === undefined ? false : item.external;
    if (typeof external !== "boolean") {
      throw new BadRequestException(
        `items[${index}].external must be a boolean.`,
      );
    }
    const href = sanitizeUrl(item.href, `items[${index}].href`);
    if (external && !href.startsWith("https://")) {
      throw new BadRequestException(
        `items[${index}] external links must use HTTPS.`,
      );
    }
    if (!external && !href.startsWith("/")) {
      throw new BadRequestException(
        `items[${index}] internal links must be site-relative.`,
      );
    }
    return {
      label: sanitizeText(item.label, `items[${index}].label`, 100),
      href,
      external,
    };
  });
}

function sanitizeMenuLink(
  value: unknown,
  field: string,
): Prisma.InputJsonObject {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) => !["label", "href", "external", "active"].includes(key),
    )
  ) {
    throw new BadRequestException(
      `${field} must contain only label, href, external, and active.`,
    );
  }
  const external = value.external === undefined ? false : value.external;
  if (typeof external !== "boolean") {
    throw new BadRequestException(`${field}.external must be a boolean.`);
  }
  if (value.active !== undefined && typeof value.active !== "boolean") {
    throw new BadRequestException(`${field}.active must be a boolean.`);
  }
  const href = sanitizeUrl(value.href, `${field}.href`);
  if (external && !href.startsWith("https://")) {
    throw new BadRequestException(`${field} external links must use HTTPS.`);
  }
  if (!external && !href.startsWith("/")) {
    throw new BadRequestException(
      `${field} internal links must be site-relative.`,
    );
  }
  return {
    label: sanitizeText(value.label, `${field}.label`, 100),
    href,
    external,
    ...(value.active !== undefined ? { active: value.active } : {}),
  };
}

function sanitizeMenuLinks(
  value: unknown,
  field: string,
): Prisma.InputJsonArray {
  if (!Array.isArray(value) || value.length === 0 || value.length > 30) {
    throw new BadRequestException(
      `${field} must contain between 1 and 30 links.`,
    );
  }
  return value.map((item, index) =>
    sanitizeMenuLink(item, `${field}[${index}]`),
  );
}

function sanitizeMenuColumns(value: unknown): Prisma.InputJsonArray {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new BadRequestException(
      "columns must contain between 1 and 8 columns.",
    );
  }
  return value.map((column, index) => {
    const field = `columns[${index}]`;
    if (
      !isRecord(column) ||
      Object.keys(column).some(
        (key) => !["heading", "imageUrl", "imageAlt", "items"].includes(key),
      )
    ) {
      throw new BadRequestException(`${field} contains unsupported menu data.`);
    }
    const result: Record<string, Prisma.InputJsonValue> = {
      heading: sanitizeText(column.heading, `${field}.heading`, 100),
      items: sanitizeMenuLinks(column.items, `${field}.items`),
    };
    if (column.imageUrl !== undefined) {
      result.imageUrl = sanitizeUrl(column.imageUrl, `${field}.imageUrl`);
      result.imageAlt = sanitizeText(column.imageAlt, `${field}.imageAlt`, 300);
    } else if (column.imageAlt !== undefined) {
      throw new BadRequestException(`${field}.imageAlt requires an imageUrl.`);
    }
    return result;
  });
}

function sanitizeFeaturedCard(value: unknown): Prisma.InputJsonObject {
  const fields = ["eyebrow", "title", "description", "ctaLabel", "href"];
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  ) {
    throw new BadRequestException(
      "featuredCard must contain only eyebrow, title, description, ctaLabel, and href.",
    );
  }
  return {
    eyebrow: sanitizeText(value.eyebrow, "featuredCard.eyebrow", 100),
    title: sanitizeText(value.title, "featuredCard.title", 200),
    description: sanitizeText(
      value.description,
      "featuredCard.description",
      500,
    ),
    ctaLabel: sanitizeText(value.ctaLabel, "featuredCard.ctaLabel", 100),
    href: sanitizeUrl(value.href, "featuredCard.href"),
  };
}

function sanitizeMenuContent(
  content: Record<string, unknown>,
): Prisma.InputJsonObject {
  const allowedFields = [
    "category",
    "style",
    "href",
    "external",
    "items",
    "columns",
    "sortOrder",
    "eyebrow",
    "featuredCard",
    "active",
  ];
  const unsupported = Object.keys(content).find(
    (field) => !allowedFields.includes(field),
  );
  if (unsupported)
    throw new BadRequestException(`Unsupported menu field: ${unsupported}.`);

  const category = content.category;
  if (
    category !== "header" &&
    category !== "footer" &&
    category !== "utility"
  ) {
    throw new BadRequestException(
      "category must be header, footer, or utility.",
    );
  }
  const sortOrder = content.sortOrder === undefined ? 0 : content.sortOrder;
  if (
    typeof sortOrder !== "number" ||
    !Number.isInteger(sortOrder) ||
    sortOrder < 0 ||
    sortOrder > 10000
  ) {
    throw new BadRequestException(
      "sortOrder must be an integer between 0 and 10000.",
    );
  }
  const active = content.active === undefined ? true : content.active;
  if (typeof active !== "boolean") {
    throw new BadRequestException("active must be a boolean.");
  }
  const result: Record<string, Prisma.InputJsonValue> = {
    category,
    sortOrder,
    active,
  };
  const validateSize = () => {
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > 64 * 1024) {
      throw new BadRequestException(
        "Website menu content must not exceed 64 KiB.",
      );
    }
  };

  if (category === "footer") {
    if (
      (content.style !== undefined && content.style !== "columns") ||
      content.href !== undefined ||
      content.external !== undefined ||
      content.columns !== undefined ||
      content.eyebrow !== undefined ||
      content.featuredCard !== undefined
    ) {
      throw new BadRequestException(
        "Footer menus use a heading and items, not a header menu style or link.",
      );
    }
    result.items = sanitizeMenuLinks(content.items, "items");
    validateSize();
    return result;
  }

  if (content.eyebrow !== undefined) {
    result.eyebrow = sanitizeText(content.eyebrow, "eyebrow", 100);
  }
  if (content.featuredCard !== undefined) {
    if (content.style !== "mega") {
      throw new BadRequestException(
        "Featured cards are only supported on mega menus.",
      );
    }
    result.featuredCard = sanitizeFeaturedCard(content.featuredCard);
  }
  if (category === "utility" && content.style !== "simple") {
    throw new BadRequestException("Utility menu links must use simple style.");
  }

  if (!["simple", "dropdown", "mega"].includes(String(content.style))) {
    throw new BadRequestException(
      "Header and utility menu style must be simple, dropdown, or mega.",
    );
  }
  const style = content.style as "simple" | "dropdown" | "mega";
  result.style = style;
  const external = content.external === undefined ? false : content.external;
  if (typeof external !== "boolean") {
    throw new BadRequestException("external must be a boolean.");
  }
  const href = sanitizeUrl(content.href, "href");
  if (external && !href.startsWith("https://")) {
    throw new BadRequestException(
      "External header and utility menu links must use HTTPS.",
    );
  }
  if (!external && !href.startsWith("/")) {
    throw new BadRequestException(
      "Internal header and utility menu links must be site-relative.",
    );
  }
  result.href = href;
  result.external = external;

  if (style === "simple") {
    if (content.items !== undefined || content.columns !== undefined) {
      throw new BadRequestException(
        "Simple header menus cannot contain dropdown items or columns.",
      );
    }
  } else if (style === "dropdown") {
    if (content.columns !== undefined) {
      throw new BadRequestException(
        "Dropdown header menus cannot contain mega-menu columns.",
      );
    }
    result.items = sanitizeMenuLinks(content.items, "items");
  } else {
    if (content.items !== undefined) {
      throw new BadRequestException(
        "Mega header menus use columns instead of a flat items list.",
      );
    }
    result.columns = sanitizeMenuColumns(content.columns);
  }
  validateSize();
  return result;
}

function sanitizeSteps(value: unknown): Prisma.InputJsonArray {
  if (!Array.isArray(value) || value.length > 20) {
    throw new BadRequestException("steps must contain no more than 20 items.");
  }
  return value.map((step, index) =>
    sanitizeText(step, `steps[${index}]`, 1000),
  );
}

function sanitizePathwaysCards(value: unknown): Prisma.InputJsonArray {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    throw new BadRequestException(
      "cards must contain between 1 and 12 pathway cards.",
    );
  }
  return value.map((card, index) => {
    const path = `cards[${index}]`;
    const allowedKeys = [
      "title",
      "description",
      "imageUrl",
      "imageAlt",
      "href",
      "linkLabel",
    ];
    if (
      !isRecord(card) ||
      Object.keys(card).some((key) => !allowedKeys.includes(key))
    ) {
      throw new BadRequestException(`${path} is invalid.`);
    }
    const imageUrl =
      card.imageUrl === undefined
        ? undefined
        : sanitizeUrl(card.imageUrl, `${path}.imageUrl`);
    const imageAlt =
      card.imageAlt === undefined
        ? undefined
        : sanitizeText(card.imageAlt, `${path}.imageAlt`, 300);
    if (imageUrl && !imageAlt) {
      throw new BadRequestException(
        `${path}.imageAlt is required when an image is provided.`,
      );
    }
    return {
      title: sanitizeText(card.title, `${path}.title`, 180),
      description: sanitizeText(card.description, `${path}.description`, 600),
      ...(imageUrl ? { imageUrl } : {}),
      ...(imageAlt ? { imageAlt } : {}),
      href: sanitizeUrl(card.href, `${path}.href`),
      linkLabel: sanitizeText(card.linkLabel, `${path}.linkLabel`, 100),
    };
  });
}

function sanitizeTimelineMilestones(value: unknown): Prisma.InputJsonArray {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    throw new BadRequestException(
      "milestones must contain between 1 and 12 timeline entries.",
    );
  }
  return value.map((milestone, index) => {
    const path = `milestones[${index}]`;
    const allowedKeys = [
      "marker",
      "year",
      "title",
      "description",
      "imageUrl",
      "imageAlt",
    ];
    if (
      !isRecord(milestone) ||
      Object.keys(milestone).some((key) => !allowedKeys.includes(key))
    ) {
      throw new BadRequestException(`${path} is invalid.`);
    }
    const imageUrl =
      milestone.imageUrl === undefined
        ? undefined
        : sanitizeUrl(milestone.imageUrl, `${path}.imageUrl`);
    const imageAlt =
      milestone.imageAlt === undefined
        ? undefined
        : sanitizeText(milestone.imageAlt, `${path}.imageAlt`, 300);
    if (imageUrl && !imageAlt) {
      throw new BadRequestException(
        `${path}.imageAlt is required when an image is provided.`,
      );
    }
    return {
      ...(milestone.marker === undefined
        ? {}
        : { marker: sanitizeText(milestone.marker, `${path}.marker`, 12) }),
      year: sanitizeText(milestone.year, `${path}.year`, 40),
      title: sanitizeText(milestone.title, `${path}.title`, 180),
      description: sanitizeText(
        milestone.description,
        `${path}.description`,
        600,
      ),
      ...(imageUrl ? { imageUrl } : {}),
      ...(imageAlt ? { imageAlt } : {}),
    };
  });
}

function sanitizeContent(
  contentType: string,
  content: unknown,
): Prisma.InputJsonObject {
  if (contentType === "blog") return sanitizeBlogContent(content);
  const allowed = CONTENT_FIELDS[contentType];
  if (!allowed || !isRecord(content))
    throw new BadRequestException(
      "A supported content type and object are required.",
    );
  if (contentType === "navigation" && content.category !== undefined) {
    return sanitizeMenuContent(content);
  }
  const unknown = Object.keys(content).filter((key) => !allowed.includes(key));
  if (unknown.length)
    throw new BadRequestException(
      `Unsupported public content field: ${unknown[0]}.`,
    );
  for (const field of REQUIRED_CONTENT_FIELDS[contentType]) {
    if (
      content[field] === undefined ||
      content[field] === null ||
      content[field] === ""
    ) {
      throw new BadRequestException(
        `${field} is required for ${contentType} content.`,
      );
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
    } else if (contentType === "pathways" && field === "cards") {
      result[field] = sanitizePathwaysCards(value);
    } else if (contentType === "timeline" && field === "milestones") {
      result[field] = sanitizeTimelineMilestones(value);
    } else if (field === "primaryCta") {
      if (
        !isRecord(value) ||
        Object.keys(value).some((key) => !["label", "url"].includes(key))
      ) {
        throw new BadRequestException(
          "primaryCta must contain only label and url.",
        );
      }
      result[field] = {
        label: sanitizeText(value.label, "primaryCta.label", 100),
        url: sanitizeUrl(value.url, "primaryCta.url"),
      };
    } else if (
      [
        "heroImageUrl",
        "imageUrl",
        "fileUrl",
        "applicationUrl",
        "websiteUrl",
        "logoUrl",
      ].includes(field)
    ) {
      result[field] = sanitizeUrl(value, field);
    } else if (field === "open") {
      if (typeof value !== "boolean")
        throw new BadRequestException("open must be a boolean.");
      result[field] = value;
    } else if (field === "sortOrder") {
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > 10000
      ) {
        throw new BadRequestException(
          "sortOrder must be an integer between 0 and 10000.",
        );
      }
      result[field] = value;
    } else {
      result[field] = sanitizeText(
        value,
        field,
        field === "address" || field === "biography" ? 4000 : 1000,
      );
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
    blog: ["/blog", `/blog/${slug}`],
    staff: ["/staff"],
    policy: ["/policies", `/policies/${slug}`],
    document: ["/documents", `/documents/${slug}`],
    admissions: ["/admissions"],
    results: ["/results"],
    school_information: ["/", "/contact"],
    settings: ["/"],
  };
  return [
    ...new Set([...(paths[contentType] ?? [`/${slug}`]), "/sitemap.xml"]),
  ];
}

function previousPublishedPath(
  contentType: string,
  previousSlug: string | null | undefined,
  slug: string,
): string[] {
  return contentType === "page" && previousSlug && previousSlug !== slug
    ? [`/${previousSlug}`]
    : [];
}

function safeProjection(entry: WebsiteEntry) {
  const version = entry.versions.find(
    (item) => item.versionNumber === entry.publishedVersionNumber,
  );
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
      ...(version.content.metaKeywords !== undefined
        ? { keywords: version.content.metaKeywords }
        : {}),
      ...(version.content.openGraph !== undefined
        ? { openGraph: version.content.openGraph }
        : {}),
      ...(version.content.twitter !== undefined
        ? { twitter: version.content.twitter }
        : {}),
      ...(version.content.schema !== undefined
        ? { schema: version.content.schema }
        : {}),
    },
    publishedAt: version.publishedAt,
  };
}

function publicPathwaysBlock(value: unknown): Record<string, unknown> | null {
  if (
    !isRecord(value) ||
    typeof value.eyebrow !== "string" ||
    typeof value.heading !== "string" ||
    typeof value.intro !== "string" ||
    !Array.isArray(value.cards) ||
    value.cards.length < 1 ||
    value.cards.length > 12
  ) {
    return null;
  }
  const cards = value.cards.flatMap((card) => {
    if (
      !isRecord(card) ||
      typeof card.title !== "string" ||
      typeof card.description !== "string" ||
      typeof card.href !== "string" ||
      typeof card.linkLabel !== "string" ||
      (card.imageUrl !== undefined && typeof card.imageUrl !== "string") ||
      (card.imageAlt !== undefined && typeof card.imageAlt !== "string")
    ) {
      return [];
    }
    return [{
      title: card.title,
      description: card.description,
      ...(typeof card.imageUrl === "string" ? { imageUrl: card.imageUrl } : {}),
      ...(typeof card.imageAlt === "string" ? { imageAlt: card.imageAlt } : {}),
      href: card.href,
      linkLabel: card.linkLabel,
    }];
  });
  if (cards.length !== value.cards.length) return null;
  return {
    type: "pathways-content",
    eyebrow: value.eyebrow,
    heading: value.heading,
    intro: value.intro,
    cards,
  };
}

function publicTimelineBlock(value: unknown): Record<string, unknown> | null {
  if (
    !isRecord(value) ||
    typeof value.eyebrow !== "string" ||
    typeof value.heading !== "string" ||
    typeof value.intro !== "string" ||
    !Array.isArray(value.milestones) ||
    value.milestones.length < 1 ||
    value.milestones.length > 12
  ) {
    return null;
  }
  const milestones = value.milestones.flatMap((milestone) => {
    if (
      !isRecord(milestone) ||
      typeof milestone.year !== "string" ||
      typeof milestone.title !== "string" ||
      typeof milestone.description !== "string" ||
      (milestone.marker !== undefined &&
        typeof milestone.marker !== "string") ||
      (milestone.imageUrl !== undefined &&
        typeof milestone.imageUrl !== "string") ||
      (milestone.imageAlt !== undefined &&
        typeof milestone.imageAlt !== "string") ||
      (milestone.imageUrl && !milestone.imageAlt)
    ) {
      return [];
    }
    return [{
      ...(typeof milestone.marker === "string"
        ? { marker: milestone.marker }
        : {}),
      year: milestone.year,
      title: milestone.title,
      description: milestone.description,
      ...(typeof milestone.imageUrl === "string"
        ? { imageUrl: milestone.imageUrl }
        : {}),
      ...(typeof milestone.imageAlt === "string"
        ? { imageAlt: milestone.imageAlt }
        : {}),
    }];
  });
  if (milestones.length !== value.milestones.length) return null;
  return {
    type: "timeline-content",
    eyebrow: value.eyebrow,
    heading: value.heading,
    intro: value.intro,
    milestones,
  };
}

@Injectable()
export class WebsiteService {
  private readonly logger = new Logger(WebsiteService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly storage?: FileStorageService,
  ) {}

  private async requireCmsRole(
    schoolId: string,
    userId: string,
    publisher = false,
  ): Promise<void> {
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

  async listPages(
    schoolId: string,
    userId: string,
    query: WebsitePagesQueryDto,
  ) {
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

  private menuContent(input: CreateWebsiteMenuDto): Record<string, unknown> {
    return {
      category: input.category,
      ...(input.style !== undefined ? { style: input.style } : {}),
      ...(input.href !== undefined ? { href: input.href } : {}),
      ...(input.external !== undefined ? { external: input.external } : {}),
      ...(input.items !== undefined ? { items: input.items } : {}),
      ...(input.columns !== undefined ? { columns: input.columns } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.eyebrow !== undefined ? { eyebrow: input.eyebrow } : {}),
      ...(input.featuredCard !== undefined
        ? { featuredCard: input.featuredCard }
        : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    };
  }

  private menuCmsProjection(page: {
    id: string;
    slug: string;
    title: string;
    status: string;
    currentVersionNumber: number;
    publishedVersionNumber: number | null;
    publishedAt: Date | null;
    updatedAt: Date;
    versions: Array<{ slug: string; title: string; content: Prisma.JsonValue }>;
  }) {
    const version = page.versions[0];
    if (
      !version ||
      !isRecord(version.content) ||
      !["header", "footer", "utility"].includes(
        String(version.content.category),
      )
    ) {
      return null;
    }
    const content = version.content;
    const sortOrder =
      typeof content.sortOrder === "number" ? content.sortOrder : 0;
    return {
      id: page.id,
      slug: version.slug,
      title: version.title,
      category: content.category,
      style: content.style ?? null,
      href: content.href ?? null,
      external: content.external ?? false,
      eyebrow: content.eyebrow ?? null,
      featuredCard: content.featuredCard ?? null,
      active: content.active !== false,
      items: content.items ?? [],
      columns: content.columns ?? [],
      sortOrder,
      status: page.status,
      currentVersionNumber: page.currentVersionNumber,
      publishedVersionNumber: page.publishedVersionNumber,
      publishedAt: page.publishedAt,
      updatedAt: page.updatedAt,
    };
  }

  async listMenus(
    schoolId: string,
    userId: string,
    query: WebsitePagesQueryDto,
  ) {
    await this.requireCmsRole(schoolId, userId);
    const pages = await this.prisma.websitePage.findMany({
      where: {
        schoolId,
        contentType: "navigation",
        status: query.status ?? { not: "archived" },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        currentVersionNumber: true,
        publishedVersionNumber: true,
        publishedAt: true,
        updatedAt: true,
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { slug: true, title: true, content: true },
        },
      },
    });
    const menus = pages
      .map((page) => this.menuCmsProjection(page))
      .filter((menu) => menu !== null)
      .sort(
        (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
      );
    return {
      items: menus.slice(query.offset, query.offset + query.limit),
      total: menus.length,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async getMenu(schoolId: string, userId: string, menuId: string) {
    await this.requireCmsRole(schoolId, userId);
    const page = await this.prisma.websitePage.findFirst({
      where: {
        schoolId,
        id: menuId,
        contentType: "navigation",
        status: { not: "archived" },
      },
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        currentVersionNumber: true,
        publishedVersionNumber: true,
        publishedAt: true,
        updatedAt: true,
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { slug: true, title: true, content: true },
        },
      },
    });
    const menu = page ? this.menuCmsProjection(page) : null;
    if (!menu) throw new NotFoundException("Website menu not found.");
    return menu;
  }

  async createMenu(
    schoolId: string,
    userId: string,
    input: CreateWebsiteMenuDto,
  ) {
    return this.createPage(schoolId, userId, {
      title: input.title,
      slug: input.slug,
      contentType: "navigation",
      content: this.menuContent(input),
    });
  }

  async updateMenu(
    schoolId: string,
    userId: string,
    menuId: string,
    input: CreateWebsiteMenuDto,
  ) {
    await this.getMenu(schoolId, userId, menuId);
    return this.createVersion(
      schoolId,
      userId,
      menuId,
      {
        title: input.title,
        slug: input.slug,
        content: this.menuContent(input),
      },
      "navigation",
    );
  }

  private blogCmsProjection(page: {
    id: string;
    slug: string;
    title: string;
    status: string;
    currentVersionNumber: number;
    publishedVersionNumber: number | null;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    versions: Array<{
      versionNumber: number;
      slug: string;
      title: string;
      content: Prisma.JsonValue;
      seoTitle: string | null;
      seoDescription: string | null;
      createdAt: Date;
    }>;
  }) {
    const version = page.versions[0];
    const content = isRecord(version?.content) ? { ...version.content } : {};
    delete content.mainImageStorageKey;
    return {
      id: page.id,
      title: version?.title ?? page.title,
      slug: version?.slug ?? page.slug,
      status: page.status,
      currentVersionNumber: page.currentVersionNumber,
      publishedVersionNumber: page.publishedVersionNumber,
      publishedAt: page.publishedAt,
      updatedAt: page.updatedAt,
      createdAt: page.createdAt,
      content,
      seo: {
        title: version?.seoTitle ?? null,
        description: version?.seoDescription ?? null,
        keywords: content.metaKeywords ?? "",
        openGraph: content.openGraph ?? {},
        twitter: content.twitter ?? {},
        schema: content.schema ?? {},
      },
      versionCreatedAt: version?.createdAt ?? null,
      versionNumber: version?.versionNumber ?? page.currentVersionNumber,
    };
  }

  async listBlogs(
    schoolId: string,
    userId: string,
    query: WebsitePagesQueryDto,
  ) {
    await this.requireCmsRole(schoolId, userId);
    const where = {
      schoolId,
      contentType: "blog",
      ...(query.status ? { status: query.status } : {}),
    };
    const [pages, total] = await Promise.all([
      this.prisma.websitePage.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: query.offset,
        take: query.limit,
        select: {
          id: true,
          slug: true,
          title: true,
          status: true,
          currentVersionNumber: true,
          publishedVersionNumber: true,
          publishedAt: true,
          createdAt: true,
          updatedAt: true,
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            select: {
              versionNumber: true,
              slug: true,
              title: true,
              content: true,
              seoTitle: true,
              seoDescription: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.websitePage.count({ where }),
    ]);
    return {
      items: pages.map((page) => this.blogCmsProjection(page)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async getBlog(schoolId: string, userId: string, blogId: string) {
    await this.requireCmsRole(schoolId, userId);
    const page = await this.prisma.websitePage.findFirst({
      where: { schoolId, id: blogId, contentType: "blog" },
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        currentVersionNumber: true,
        publishedVersionNumber: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: {
            versionNumber: true,
            slug: true,
            title: true,
            content: true,
            seoTitle: true,
            seoDescription: true,
            createdAt: true,
          },
        },
      },
    });
    if (!page) throw new NotFoundException("Blog post not found.");
    return this.blogCmsProjection(page);
  }

  async createBlog(
    schoolId: string,
    userId: string,
    input: CreateWebsiteBlogDto,
  ) {
    return this.createPage(schoolId, userId, {
      ...input,
      contentType: "blog",
    });
  }

  async updateBlog(
    schoolId: string,
    userId: string,
    blogId: string,
    input: CreateWebsiteBlogDto,
  ) {
    await this.requireCmsRole(schoolId, userId);
    return this.createVersion(schoolId, userId, blogId, input, "blog");
  }

  async uploadBlogMainImage(
    schoolId: string,
    userId: string,
    blogId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string },
  ) {
    await this.requireCmsRole(schoolId, userId);
    if (!this.storage)
      throw new ServiceUnavailableException(
        "Blog image storage is unavailable.",
      );
    const expectedFormats: Record<string, string> = {
      "image/avif": "avif",
      "image/gif": "gif",
      "image/jpeg": "jpeg",
      "image/png": "png",
      "image/webp": "webp",
    };
    const expectedFormat = expectedFormats[file.mimetype];
    if (!expectedFormat)
      throw new BadRequestException(
        "Upload a PNG, JPEG, WebP, GIF or AVIF image.",
      );
    const page = await this.prisma.websitePage.findFirst({
      where: {
        schoolId,
        id: blogId,
        contentType: "blog",
        status: { not: "archived" },
      },
      select: {
        id: true,
        slug: true,
        title: true,
        currentVersionNumber: true,
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { content: true, seoTitle: true, seoDescription: true },
        },
      },
    });
    if (!page) throw new NotFoundException("Blog post not found.");
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { code: true },
    });
    if (!school) throw new NotFoundException("School not found.");

    let webpBuffer: Buffer;
    try {
      const image = sharp(file.buffer, { limitInputPixels: 40_000_000 });
      const metadata = await image.metadata();
      if (metadata.format !== expectedFormat) {
        throw new BadRequestException(
          "The image content does not match its file type.",
        );
      }
      webpBuffer = await sharp(file.buffer, { limitInputPixels: 40_000_000 })
        .rotate()
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        "Upload a valid PNG, JPEG, WebP, GIF or AVIF image.",
      );
    }
    if (webpBuffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException(
        "The optimized blog image must not exceed 10 MiB.",
      );
    }

    const storageKey = await this.storage.saveFile(
      "website-blog",
      `${file.originalname.replace(/\.[^.]*$/, "").slice(0, 80) || "blog-image"}.webp`,
      webpBuffer,
    );
    const imageUrl = `/api/v1/website/blog/${blogId}/image?schoolCode=${encodeURIComponent(school.code)}`;
    try {
      const previousContent = isRecord(page.versions[0]?.content)
        ? page.versions[0].content
        : {};
      const publicContent = { ...previousContent };
      delete publicContent.mainImageStorageKey;
      const content: Record<string, Prisma.InputJsonValue> = {
        ...sanitizeBlogContent({ ...publicContent, mainImageUrl: imageUrl }),
        mainImageStorageKey: storageKey,
      };
      const versionNumber = page.currentVersionNumber + 1;
      await this.prisma.$transaction(async (transaction) => {
        await transaction.websitePageVersion.create({
          data: {
            schoolId,
            pageId: blogId,
            versionNumber,
            slug: page.slug,
            title: page.title,
            content,
            seoTitle: page.versions[0]?.seoTitle ?? null,
            seoDescription: page.versions[0]?.seoDescription ?? null,
            createdById: userId,
          },
        });
        await transaction.websitePage.update({
          where: { id: blogId },
          data: { currentVersionNumber: versionNumber, status: "draft" },
        });
        await transaction.auditEvent.create({
          data: {
            schoolId,
            actorUserId: userId,
            action: "website.blog.main_image.uploaded",
            entityType: "website_page",
            entityId: blogId,
            metadata: {
              versionNumber,
              mimeType: "image/webp",
              byteLength: webpBuffer.length,
            },
          },
        });
      });
      return { blogId, versionNumber, status: "draft", imageUrl };
    } catch (error) {
      await this.storage.deleteFile(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async publicBlogImage(schoolCode: string, blogId: string) {
    const school = await this.publicSchool(schoolCode);
    const page = await this.prisma.websitePage.findFirst({
      where: {
        schoolId: school.id,
        id: blogId,
        contentType: "blog",
        publishedVersionNumber: { not: null },
      },
      select: {
        versions: {
          where: { status: "published" },
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { content: true },
        },
      },
    });
    const content = page?.versions[0]?.content;
    const storageKey = isRecord(content) ? content.mainImageStorageKey : null;
    if (
      !page ||
      typeof storageKey !== "string" ||
      !storageKey.startsWith("website-blog/")
    ) {
      throw new NotFoundException("Published blog image not found.");
    }
    if (!this.storage)
      throw new ServiceUnavailableException(
        "Blog image storage is unavailable.",
      );
    return this.storage.readFile(storageKey);
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
    return {
      items: items.map((version) => ({
        ...version,
        canPublishDraft:
          version.status === "draft" && version.createdById === userId,
      })),
      total: items.length,
    };
  }

  async createPage(
    schoolId: string,
    userId: string,
    input: CreateWebsitePageDto,
  ) {
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
          metadata: {
            contentType: page.contentType,
            slug: page.slug,
            versionNumber: 1,
          },
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
    expectedContentType?: string,
  ) {
    await this.requireCmsRole(schoolId, userId);
    return this.prisma.$transaction(async (transaction) => {
      const page = await transaction.websitePage.findFirst({
        where: {
          schoolId,
          id: pageId,
          ...(expectedContentType ? { contentType: expectedContentType } : {}),
        },
        select: {
          id: true,
          slug: true,
          contentType: true,
          title: true,
          status: true,
          currentVersionNumber: true,
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            select: { content: true },
          },
        },
      });
      if (!page || page.status === "archived")
        throw new NotFoundException("Website page not found.");
      const content = { ...sanitizeContent(page.contentType, input.content) };
      const previousContent = page.versions[0]?.content;
      if (
        page.contentType === "blog" &&
        isRecord(content) &&
        isRecord(previousContent) &&
        typeof previousContent.mainImageStorageKey === "string" &&
        content.mainImageUrl === previousContent.mainImageUrl
      ) {
        content.mainImageStorageKey = previousContent.mainImageStorageKey;
      }
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
        select: {
          id: true,
          versionNumber: true,
          slug: true,
          title: true,
          status: true,
          createdAt: true,
        },
      });
      await transaction.websitePage.update({
        where: { id: pageId },
        data: {
          slug,
          title,
          status: "draft",
          currentVersionNumber: versionNumber,
        },
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

  async submitForReview(
    schoolId: string,
    userId: string,
    pageId: string,
    versionNumber: number,
  ) {
    await this.requireCmsRole(schoolId, userId);
    return this.transition(
      schoolId,
      userId,
      pageId,
      versionNumber,
      "draft",
      "review",
      {
        submittedAt: new Date(),
      },
      "website.page.submitted_for_review",
    );
  }

  async approve(
    schoolId: string,
    userId: string,
    pageId: string,
    versionNumber: number,
  ) {
    await this.requireCmsRole(schoolId, userId, true);
    return this.prisma.$transaction(async (transaction) => {
      const version = await transaction.websitePageVersion.findFirst({
        where: { schoolId, pageId, versionNumber },
        select: { id: true, status: true, createdById: true },
      });
      if (!version || version.status !== "review") {
        throw new ConflictException(
          "Only a version in review can be approved.",
        );
      }
      const page = await transaction.websitePage.findFirst({
        where: { schoolId, id: pageId },
        select: { currentVersionNumber: true },
      });
      if (!page || page.currentVersionNumber !== versionNumber) {
        throw new ConflictException(
          "Only the current page version can be approved.",
        );
      }
      if (version.createdById === userId) {
        throw new ForbiddenException(
          "A page author cannot approve their own version.",
        );
      }
      const updated = await transaction.websitePageVersion.update({
        where: { id: version.id },
        data: {
          status: "approved",
          reviewedById: userId,
          approvedAt: new Date(),
        },
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
    if (
      !Number.isFinite(scheduledAt.getTime()) ||
      scheduledAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException(
        "scheduledAt must be a future date and time.",
      );
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

  async publish(
    schoolId: string,
    userId: string,
    pageId: string,
    versionNumber?: number,
  ) {
    await this.requireCmsRole(schoolId, userId, true);
    return this.publishVersionAndRevalidate(
      schoolId,
      userId,
      pageId,
      versionNumber,
    );
  }

  async publishDraft(schoolId: string, userId: string, pageId: string) {
    await this.requireCmsRole(schoolId, userId, true);
    return this.publishVersionAndRevalidate(
      schoolId,
      userId,
      pageId,
      undefined,
      true,
    );
  }

  private async publishVersionAndRevalidate(
    schoolId: string,
    userId: string,
    pageId: string,
    versionNumber?: number,
    allowAuthorDraft = false,
  ) {
    const result = await this.publishVersion(
      schoolId,
      pageId,
      versionNumber,
      userId,
      allowAuthorDraft,
    );
    const revalidation = await this.revalidatePaths(
      result.schoolCode,
      [
        ...(await this.contentRevalidationPaths(
          schoolId,
          result.contentType,
          result.slug,
          pageId,
        )),
        ...previousPublishedPath(
          result.contentType,
          result.previousSlug,
          result.slug,
        ),
      ],
    );
    return {
      pageId,
      versionNumber: result.versionNumber,
      status: "published",
      publishedAt: result.publishedAt,
      revalidation,
    };
  }

  private async publishVersion(
    schoolId: string,
    pageId: string,
    versionNumber?: number,
    actorUserId?: string,
    allowAuthorDraft = false,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const page = await transaction.websitePage.findFirst({
        where: { schoolId, id: pageId },
        select: {
          id: true,
          contentType: true,
          currentVersionNumber: true,
          publishedSlug: true,
        },
      });
      if (!page) throw new NotFoundException("Website page not found.");
      const targetVersion = versionNumber ?? page.currentVersionNumber;
      if (targetVersion !== page.currentVersionNumber) {
        throw new ConflictException(
          "Only the current page version can be published.",
        );
      }
      const version = await transaction.websitePageVersion.findFirst({
        where: { schoolId, pageId, versionNumber: targetVersion },
        select: {
          id: true,
          status: true,
          scheduledAt: true,
          slug: true,
          createdById: true,
        },
      });
      if (!version)
        throw new NotFoundException("Website page version not found.");
      const isAuthorDraft =
        allowAuthorDraft &&
        version.status === "draft" &&
        version.createdById === actorUserId;
      if (version.status === "draft" && !isAuthorDraft) {
        throw new ForbiddenException(
          "Only the author can directly publish their draft.",
        );
      }
      if (
        !isAuthorDraft &&
        version.status !== "approved" &&
        !(
          version.status === "scheduled" &&
          version.scheduledAt &&
          version.scheduledAt <= new Date()
        )
      ) {
        throw new ConflictException(
          "Only an approved or due scheduled version can be published.",
        );
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
        throw new ConflictException(
          "This slug is already in use by another published page.",
        );
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
          action: isAuthorDraft
            ? "website.page.version.published_directly"
            : "website.page.version.published",
          entityType: "website_page",
          entityId: pageId,
          metadata: {
            versionNumber: targetVersion,
            ...(isAuthorDraft ? { direct: true } : {}),
          },
        },
      });
      return {
        versionNumber: targetVersion,
        publishedAt,
        slug: version.slug,
        previousSlug: page.publishedSlug,
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
      if (!page) throw new NotFoundException("Website page not found.");
      if (page.publishedVersionNumber === null)
        throw new ConflictException("This page is not currently published.");
      await transaction.websitePage.update({
        where: { id: pageId },
        data: {
          status: "draft",
          publishedSlug: null,
          publishedVersionNumber: null,
          publishedAt: null,
        },
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
      const school = await transaction.school.findUnique({
        where: { id: schoolId },
        select: { code: true },
      });
      if (!school) throw new NotFoundException("School not found.");
      return {
        schoolCode: school.code,
        contentType: page.contentType,
        slug: page.versions[0]?.slug ?? "",
      };
    });
    const revalidation = await this.revalidatePaths(
      result.schoolCode,
      await this.contentRevalidationPaths(
        schoolId,
        result.contentType,
        result.slug,
        pageId,
      ),
    );
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
      if (!version)
        throw new NotFoundException("Website page version not found.");
      const page = await transaction.websitePage.findFirst({
        where: { schoolId, id: pageId },
        select: { currentVersionNumber: true },
      });
      if (!page || page.currentVersionNumber !== versionNumber) {
        throw new ConflictException(
          "Only the current page version can change workflow state.",
        );
      }
      if (version.status !== expectedStatus) {
        throw new ConflictException(
          `Only a ${expectedStatus} version can move to ${status}.`,
        );
      }
      const updated = await transaction.websitePageVersion.update({
        where: { id: version.id },
        data: { status, ...fields },
        select: {
          versionNumber: true,
          status: true,
          submittedAt: true,
          scheduledAt: true,
        },
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
      const due = await transaction.$queryRaw<
        Array<{
          school_id: string;
          page_id: string;
          version_number: number;
          content_type: string;
          slug: string;
          previous_slug: string | null;
          school_code: string;
        }>
      >(Prisma.sql`
        SELECT p.school_id, p.id AS page_id, v.version_number, p.content_type, v.slug, p.published_slug AS previous_slug, s.code AS school_code
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
      const paths = await this.contentRevalidationPaths(
        item.school_id,
        item.content_type,
        item.slug,
        item.page_id,
      );
      await this.revalidatePaths(
        item.school_code,
        [
          ...paths,
          ...previousPublishedPath(
            item.content_type,
            item.previous_slug,
            item.slug,
          ),
        ],
      );
    }
    return published.length;
  }

  private async contentRevalidationPaths(
    schoolId: string,
    contentType: string,
    slug: string,
    componentId = slug,
  ): Promise<string[]> {
    if (contentType !== "pathways" && contentType !== "timeline") {
      return publicPaths(contentType, slug);
    }
    const pages = await this.prisma.websitePage.findMany({
      where: {
        schoolId,
        contentType: "page",
        publishedVersionNumber: { not: null },
      },
      select: {
        publishedSlug: true,
        versions: {
          where: { status: "published" },
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { content: true },
        },
      },
    });
    const paths = pages.flatMap((page) => {
      const content = page.versions[0]?.content;
      const referenced = isRecord(content) && Array.isArray(content.body)
        ? content.body.some(
            (block) =>
              isRecord(block) &&
              block.type === contentType &&
              block.componentId === componentId,
          )
        : false;
      return referenced && page.publishedSlug ? [`/${page.publishedSlug}`] : [];
    });
    return [...new Set([...paths, "/sitemap.xml"])];
  }

  private async revalidatePaths(schoolCode: string, paths: string[]) {
    const target = process.env.WEBSITE_REVALIDATE_URL;
    const secret = process.env.WEBSITE_REVALIDATE_SECRET;
    if (!target && !secret) {
      this.logger.warn(
        "Website cache revalidation skipped: WEBSITE_REVALIDATE_URL and WEBSITE_REVALIDATE_SECRET are not configured.",
      );
      return { status: "not_configured" as const };
    }
    if (!target || !secret) {
      throw new ServiceUnavailableException(
        "Website revalidation requires both WEBSITE_REVALIDATE_URL and WEBSITE_REVALIDATE_SECRET.",
      );
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
      this.logger.error(
        `Website revalidation request failed (${error instanceof Error ? error.name : "UnknownError"}).`,
      );
      throw new ServiceUnavailableException(
        "Website content was saved, but cache revalidation failed; retry the revalidation endpoint.",
      );
    }
    if (!response.ok) {
      this.logger.error(
        `Website revalidation endpoint returned HTTP ${response.status}.`,
      );
      throw new ServiceUnavailableException(
        "Website content was saved, but cache revalidation failed; retry the revalidation endpoint.",
      );
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

  private async publicEntries(
    schoolId: string,
    contentType: string,
    slug?: string,
    ids?: string[],
  ): Promise<WebsiteEntry[]> {
    return this.prisma.websitePage.findMany({
      where: {
        schoolId,
        contentType,
        publishedVersionNumber: { not: null },
        ...(ids ? { id: { in: ids } } : {}),
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
    let page = entries.map(safeProjection)[0];
    if (!page) throw new NotFoundException("Published website page not found.");
    if (
      Array.isArray(page.content.body) &&
      page.content.body.some(
        (block) =>
          isRecord(block) &&
          (block.type === "pathways" || block.type === "timeline"),
      )
    ) {
      const componentIdsByType = new Map<string, Set<string>>();
      for (const block of page.content.body) {
        if (
          !isRecord(block) ||
          (block.type !== "pathways" && block.type !== "timeline") ||
          typeof block.componentId !== "string"
        ) {
          continue;
        }
        const ids = componentIdsByType.get(block.type) ?? new Set<string>();
        ids.add(block.componentId);
        componentIdsByType.set(block.type, ids);
      }
      const componentsByType = new Map(
        await Promise.all(
          [...componentIdsByType].map(async ([type, ids]) => {
            const components = await this.publicEntries(
              school.id,
              type,
              undefined,
              [...ids],
            );
            return [
              type,
              new Map(
                components.flatMap((entry) => {
                  const component = safeProjection(entry);
                  return component
                    ? [[entry.id, component.content] as const]
                    : [];
                }),
              ),
            ] as const;
          }),
        ),
      );
      const body = page.content.body.flatMap((block) => {
        if (
          !isRecord(block) ||
          (block.type !== "pathways" && block.type !== "timeline")
        ) {
          return [block];
        }
        if (typeof block.componentId !== "string") {
          const legacyBlock =
            block.type === "pathways"
              ? publicPathwaysBlock(block)
              : publicTimelineBlock(block);
          return legacyBlock ? [legacyBlock] : [];
        }
        const component = componentsByType
          .get(block.type)
          ?.get(block.componentId);
        const section =
          block.type === "pathways"
            ? publicPathwaysBlock(component)
            : publicTimelineBlock(component);
        return section ? [section] : [];
      });
      page = { ...page, content: { ...page.content, body } };
    }
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
    if (!homePage)
      throw new NotFoundException("Published homepage content not found.");
    const navigationEntries = navigation
      .map(safeProjection)
      .filter((entry) => entry !== null);
    const legacyNavigation = navigationEntries.find(
      (entry) => !("category" in entry.content),
    );
    return {
      school: { code: school.code, name: school.name },
      settings: settings.map(safeProjection)[0]?.content ?? {},
      page: homePage,
      navigation: legacyNavigation?.content ?? { items: [] },
      menus: this.publicMenuGroups(navigation),
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

  async publicEvents(
    query: PublicWebsiteQueryDto,
    schoolId?: string,
    limit = query.limit,
  ) {
    const resolvedSchool = schoolId
      ? null
      : await this.publicSchool(query.schoolCode);
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
    const school = await this.publicSchool(query.schoolCode);
    const entries = await this.publicEntries(school.id, "navigation");
    const projections = entries
      .map(safeProjection)
      .filter((entry) => entry !== null);
    const legacyNavigation = projections.find(
      (entry) => !("category" in entry.content),
    );
    return {
      school: { code: school.code, name: school.name },
      navigation: legacyNavigation?.content ?? { items: [] },
      menus: this.publicMenuGroups(entries),
    };
  }

  private publicMenuGroups(entries: WebsiteEntry[]) {
    const menus = entries
      .flatMap((entry) => {
        const projection = safeProjection(entry);
        if (!projection || !isRecord(projection.content)) return [];
        const category = projection.content.category;
        if (
          category !== "header" &&
          category !== "footer" &&
          category !== "utility"
        ) {
          return [];
        }
        if (projection.content.active === false) return [];
        const items = Array.isArray(projection.content.items)
          ? projection.content.items.filter(
              (item) => isRecord(item) && item.active !== false,
            )
          : [];
        const columns = Array.isArray(projection.content.columns)
          ? projection.content.columns
              .map((column) =>
                isRecord(column) && Array.isArray(column.items)
                  ? {
                      ...column,
                      items: column.items.filter(
                        (item) => isRecord(item) && item.active !== false,
                      ),
                    }
                  : column,
              )
              .filter(
                (column) =>
                  !isRecord(column) ||
                  !Array.isArray(column.items) ||
                  column.items.length > 0,
              )
          : [];
        if (category === "footer" && items.length === 0) return [];
        return [
          {
            slug: projection.slug,
            title: projection.title,
            category,
            style: projection.content.style ?? null,
            href: projection.content.href ?? null,
            external: projection.content.external ?? false,
            eyebrow: projection.content.eyebrow ?? null,
            featuredCard: projection.content.featuredCard ?? null,
            active: projection.content.active !== false,
            items,
            columns,
            sortOrder:
              typeof projection.content.sortOrder === "number"
                ? projection.content.sortOrder
                : 0,
            publishedAt: projection.publishedAt,
          },
        ];
      })
      .sort(
        (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
      );
    return {
      headerMenus: menus.filter((menu) => menu.category === "header"),
      footerMenus: menus.filter((menu) => menu.category === "footer"),
      utilityMenus: menus.filter((menu) => menu.category === "utility"),
    };
  }

  async publicMenus(query: PublicWebsiteQueryDto) {
    const school = await this.publicSchool(query.schoolCode);
    const entries = await this.publicEntries(school.id, "navigation");
    return {
      school: { code: school.code, name: school.name },
      ...this.publicMenuGroups(entries),
    };
  }

  async publicNews(query: PublicWebsiteQueryDto) {
    return this.publicContent(query, "news");
  }

  async publicBlogs(query: PublicWebsiteQueryDto) {
    return this.publicContent(query, "blog");
  }

  async publicBlog(query: PublicWebsiteQueryDto, slug: string) {
    const school = await this.publicSchool(query.schoolCode);
    const entries = await this.publicEntries(school.id, "blog", slug);
    const blog = entries.map(safeProjection)[0];
    if (!blog) throw new NotFoundException("Published blog post not found.");
    return { school: { code: school.code, name: school.name }, blog };
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
    if (!page || page.publishedVersionNumber === null)
      throw new NotFoundException("Published website page not found.");
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { code: true },
    });
    if (!school) throw new NotFoundException("School not found.");
    const revalidation = await this.revalidatePaths(
      school.code,
      await this.contentRevalidationPaths(
        schoolId,
        page.contentType,
        page.versions[0]?.slug ?? "",
        pageId,
      ),
    );
    await this.audit(schoolId, userId, "website.page.revalidated", pageId);
    return { pageId, revalidation };
  }
}
