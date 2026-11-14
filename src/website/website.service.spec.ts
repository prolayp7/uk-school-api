import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHmac } from "node:crypto";
import sharp from "sharp";
import type { FileStorageService } from "../common/file-storage.service";
import type { PrismaService } from "../prisma/prisma.service";
import { schoolMembershipRole } from "../auth/school-permissions.test-utils";
import { WebsiteService } from "./website.service";

describe("WebsiteService", () => {
  const editorMembership = {
    findFirst: jest.fn().mockResolvedValue({
      membershipRoles: [schoolMembershipRole("TEACHER")],
    }),
  };

  it("creates versioned CMS pages transactionally and audits creation", async () => {
    const pageCreate = jest.fn().mockResolvedValue({
      id: "page-1",
      slug: "welcome",
      contentType: "page",
      title: "Welcome",
      status: "draft",
      currentVersionNumber: 1,
    });
    const auditCreate = jest.fn().mockResolvedValue({});
    const transaction = {
      websitePage: { create: pageCreate },
      auditEvent: { create: auditCreate },
    };
    const prisma = {
      schoolMembership: editorMembership,
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    const result = await new WebsiteService(prisma).createPage(
      "school-1",
      "editor-1",
      {
        slug: "welcome",
        title: "Welcome",
        contentType: "page",
        content: {
          heading: "Welcome to our school",
          body: [
            { type: "paragraph", text: "A public introduction." },
            {
              type: "pathways",
              componentId: "9d02d496-70ec-4c8f-b07d-fba04c5e5897",
            },
            {
              type: "timeline",
              componentId: "b76efce0-32a8-459e-8998-1212de973448",
            },
          ],
        },
      },
    );

    expect(result).toMatchObject({
      id: "page-1",
      status: "draft",
      currentVersionNumber: 1,
    });
    expect(pageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          schoolId: "school-1",
          slug: "welcome",
          versions: {
            create: expect.objectContaining({
              versionNumber: 1,
              content: {
                heading: "Welcome to our school",
                body: [
                  { type: "paragraph", text: "A public introduction." },
                  {
                    type: "pathways",
                    componentId: "9d02d496-70ec-4c8f-b07d-fba04c5e5897",
                  },
                  {
                    type: "timeline",
                    componentId: "b76efce0-32a8-459e-8998-1212de973448",
                  },
                ],
              },
            }),
          },
        }),
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "website.page.created" }),
      }),
    );
  });

  it("creates a validated reusable pathways component", async () => {
    const pageCreate = jest.fn().mockResolvedValue({
      id: "pathways-1",
      slug: "key-pathways",
      contentType: "pathways",
      title: "Key Pathways",
      status: "draft",
      currentVersionNumber: 1,
    });
    const transaction = {
      websitePage: { create: pageCreate },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      schoolMembership: editorMembership,
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;

    await new WebsiteService(prisma).createPage("school-1", "editor-1", {
      slug: "key-pathways",
      title: "Key Pathways",
      contentType: "pathways",
      content: {
        eyebrow: "KEY PATHWAYS",
        heading: "Explore Our School",
        intro: "Find the right information for your family.",
        cards: [{
          title: "Admissions",
          description: "Explore how to join our school.",
          href: "/admissions",
          linkLabel: "Discover More",
        }],
      },
    });

    expect(pageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contentType: "pathways",
          versions: {
            create: expect.objectContaining({
              content: {
                eyebrow: "KEY PATHWAYS",
                heading: "Explore Our School",
                intro: "Find the right information for your family.",
                cards: [{
                  title: "Admissions",
                  description: "Explore how to join our school.",
                  href: "/admissions",
                  linkLabel: "Discover More",
                }],
              },
            }),
          },
        }),
      }),
    );
  });

  it("creates a reusable timeline with validated milestone data", async () => {
    const pageCreate = jest.fn().mockResolvedValue({
      id: "timeline-1",
      slug: "components/timeline/our-journey",
      contentType: "timeline",
      title: "Our Journey Through the Years",
      status: "draft",
      currentVersionNumber: 1,
    });
    const transaction = {
      websitePage: { create: pageCreate },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      schoolMembership: editorMembership,
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;

    await new WebsiteService(prisma).createPage("school-1", "editor-1", {
      slug: "components/timeline/our-journey",
      title: "Our Journey Through the Years",
      contentType: "timeline",
      content: {
        eyebrow: "160 YEARS OF EXCELLENCE",
        heading: "Our Journey Through the Years",
        intro: "A history of the school.",
        milestones: [{
          marker: "1",
          year: "1864",
          title: "Foundation",
          description: "The school was founded.",
          imageUrl: "/images/founding.jpg",
          imageAlt: "The school's first pupils.",
        }],
      },
    });

    expect(pageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contentType: "timeline",
          versions: {
            create: expect.objectContaining({
              content: {
                eyebrow: "160 YEARS OF EXCELLENCE",
                heading: "Our Journey Through the Years",
                intro: "A history of the school.",
                milestones: [{
                  marker: "1",
                  year: "1864",
                  title: "Foundation",
                  description: "The school was founded.",
                  imageUrl: "/images/founding.jpg",
                  imageAlt: "The school's first pupils.",
                }],
              },
            }),
          },
        }),
      }),
    );
  });

  it("rejects unsafe images in reusable timeline milestones", async () => {
    const transaction = jest.fn();
    const prisma = {
      schoolMembership: editorMembership,
      $transaction: transaction,
    } as unknown as PrismaService;

    await expect(
      new WebsiteService(prisma).createPage("school-1", "editor-1", {
        slug: "components/timeline/our-journey",
        title: "Our Journey",
        contentType: "timeline",
        content: {
          eyebrow: "OUR HISTORY",
          heading: "Our Journey",
          intro: "A history of the school.",
          milestones: [{
            year: "1864",
            title: "Foundation",
            description: "The school was founded.",
            imageUrl: "javascript:alert(1)",
            imageAlt: "The school's first pupils.",
          }],
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects unsafe URLs in managed pathway cards", async () => {
    const transaction = jest.fn();
    const prisma = {
      schoolMembership: editorMembership,
      $transaction: transaction,
    } as unknown as PrismaService;

    await expect(
      new WebsiteService(prisma).createPage("school-1", "editor-1", {
        slug: "key-pathways",
        title: "Key Pathways",
        contentType: "pathways",
        content: {
          eyebrow: "KEY PATHWAYS",
          heading: "Explore Our School",
          intro: "Find the right information for your family.",
          cards: [{
            title: "Admissions",
            description: "Explore how to join our school.",
            href: "javascript:alert(1)",
            linkLabel: "Discover More",
          }],
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("creates a validated mega header menu with image columns and nested links", async () => {
    const pageCreate = jest.fn().mockResolvedValue({
      id: "menu-1",
      slug: "our-school",
      contentType: "navigation",
      title: "Our School",
      status: "draft",
      currentVersionNumber: 1,
    });
    const transaction = {
      websitePage: { create: pageCreate },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      schoolMembership: editorMembership,
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;

    await new WebsiteService(prisma).createMenu("school-1", "editor-1", {
      title: "Our School",
      slug: "our-school",
      category: "header",
      style: "mega",
      href: "/our-school",
      columns: [
        {
          heading: "Discover",
          imageUrl: "https://school.example/images/school.webp",
          imageAlt: "The school entrance",
          items: [{ label: "About us", href: "/about" }],
        },
      ],
      sortOrder: 2,
    });

    expect(pageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contentType: "navigation",
          versions: {
            create: expect.objectContaining({
              content: {
                category: "header",
                style: "mega",
                href: "/our-school",
                external: false,
                active: true,
                columns: [
                  {
                    heading: "Discover",
                    imageUrl: "https://school.example/images/school.webp",
                    imageAlt: "The school entrance",
                    items: [
                      { label: "About us", href: "/about", external: false },
                    ],
                  },
                ],
                sortOrder: 2,
              },
            }),
          },
        }),
      }),
    );
  });

  it("rejects unsafe or mismatched menu links before creating a page", async () => {
    const transaction = jest.fn();
    const prisma = {
      schoolMembership: editorMembership,
      $transaction: transaction,
    } as unknown as PrismaService;

    await expect(
      new WebsiteService(prisma).createMenu("school-1", "editor-1", {
        title: "Learning",
        slug: "learning",
        category: "header",
        style: "dropdown",
        href: "/learning",
        items: [{ label: "Unsafe", href: "javascript:alert(1)" }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      new WebsiteService(prisma).createMenu("school-1", "editor-1", {
        title: "Policies",
        slug: "policies",
        category: "footer",
        style: "mega",
        items: [{ label: "Policies", href: "/policies" }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("creates footer menu columns with validated links", async () => {
    const pageCreate = jest.fn().mockResolvedValue({
      id: "footer-menu-1",
      slug: "useful-links",
      contentType: "navigation",
      title: "Useful links",
      status: "draft",
      currentVersionNumber: 1,
    });
    const transaction = {
      websitePage: { create: pageCreate },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      schoolMembership: editorMembership,
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;

    await new WebsiteService(prisma).createMenu("school-1", "editor-1", {
      title: "Useful links",
      slug: "useful-links",
      category: "footer",
      items: [
        { label: "Contact", href: "/contact" },
        {
          label: "Unapproved policy",
          href: "/privacy",
          active: false,
        },
      ],
    });

    expect(pageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          versions: {
            create: expect.objectContaining({
              content: {
                category: "footer",
                active: true,
                items: [
                  { label: "Contact", href: "/contact", external: false },
                  {
                    label: "Unapproved policy",
                    href: "/privacy",
                    external: false,
                    active: false,
                  },
                ],
                sortOrder: 0,
              },
            }),
          },
        }),
      }),
    );
  });

  it("accepts utility links and publishes mega-menu eyebrow and featured-card data", async () => {
    const pageCreate = jest.fn().mockResolvedValue({
      id: "menu-utility",
      slug: "parent-portal",
      contentType: "navigation",
      title: "Parent Portal",
      status: "draft",
      currentVersionNumber: 1,
    });
    const transaction = {
      websitePage: { create: pageCreate },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      schoolMembership: editorMembership,
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    const service = new WebsiteService(prisma);

    await service.createMenu("school-1", "editor-1", {
      title: "Parent Portal",
      slug: "parent-portal",
      category: "utility",
      style: "simple",
      href: "/parent-portal",
      sortOrder: 1,
    });
    await service.createMenu("school-1", "editor-1", {
      title: "Our School",
      slug: "our-school",
      category: "header",
      style: "mega",
      href: "/our-school",
      eyebrow: "HERITAGE & GOVERNANCE",
      columns: [
        {
          heading: "Our Heritage",
          items: [{ label: "Our History", href: "/our-school/history" }],
        },
      ],
      featuredCard: {
        eyebrow: "DISCOVER",
        title: "Discover Our School",
        description: "Explore our heritage, values and community.",
        ctaLabel: "Explore Our School",
        href: "/our-school",
      },
    });

    expect(pageCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          versions: {
            create: expect.objectContaining({
              content: {
                category: "utility",
                style: "simple",
                href: "/parent-portal",
                external: false,
                active: true,
                sortOrder: 1,
              },
            }),
          },
        }),
      }),
    );
    expect(pageCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          versions: {
            create: expect.objectContaining({
              content: expect.objectContaining({
                eyebrow: "HERITAGE & GOVERNANCE",
                featuredCard: {
                  eyebrow: "DISCOVER",
                  title: "Discover Our School",
                  description: "Explore our heritage, values and community.",
                  ctaLabel: "Explore Our School",
                  href: "/our-school",
                },
              }),
            }),
          },
        }),
      }),
    );
  });

  it("saves headteacher welcome components with an allow-listed content shape", async () => {
    const pageCreate = jest.fn().mockResolvedValue({
      id: "page-1",
      slug: "our-school",
      contentType: "page",
      title: "Our School",
      status: "draft",
      currentVersionNumber: 1,
    });
    const transaction = {
      websitePage: { create: pageCreate },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      schoolMembership: editorMembership,
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    const welcomeContent = {
      image: "/images/headteacher.jpg",
      imageAlt: "Headteacher Eleanor Vance",
      roleBadge: "11th Warden & Headmistress",
      heading: "Welcome to Our School",
      quote: "A lifelong flame.",
      description: "Welcome to our school community.",
      philosophy: "We celebrate every pupil.",
      signature: "Eleanor Vance",
      name: "Dr. Eleanor Vance",
      qualifications: "MA (Oxon), PhD",
      designation: "Headmistress",
      ctaText: "Read the Full Welcome",
      ctaUrl: "/our-school/welcome",
    };

    await new WebsiteService(prisma).createPage("school-1", "editor-1", {
      slug: "our-school",
      title: "Our School",
      contentType: "page",
      content: {
        heading: "Our School",
        body: [{ type: "headteacher-welcome", content: welcomeContent }],
      },
    });

    expect(pageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          versions: {
            create: expect.objectContaining({
              content: {
                heading: "Our School",
                body: [{ type: "headteacher-welcome", content: welcomeContent }],
              },
            }),
          },
        }),
      }),
    );
  });

  it.each([
    ["image", "javascript:alert(1)"],
    ["ctaUrl", "javascript:alert(1)"],
  ])("rejects an unsafe headteacher %s URL", async (field, url) => {
    const transaction = jest.fn();
    const prisma = {
      schoolMembership: editorMembership,
      $transaction: transaction,
    } as unknown as PrismaService;

    await expect(
      new WebsiteService(prisma).createPage("school-1", "editor-1", {
        slug: "our-school",
        title: "Our School",
        contentType: "page",
        content: {
          heading: "Our School",
          body: [{
            type: "headteacher-welcome",
            content: {
              image: "/images/headteacher.jpg",
              imageAlt: "Headteacher portrait",
              roleBadge: "Headteacher",
              heading: "Welcome",
              quote: "A quote.",
              description: "Welcome message.",
              philosophy: "Our philosophy.",
              signature: "Headteacher",
              name: "Headteacher",
              qualifications: "Qualifications",
              designation: "Headteacher",
              ctaText: "Read more",
              ctaUrl: "/welcome",
              [field]: url,
            },
          }],
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects unknown content properties rather than storing private ERP fields", async () => {
    const transaction = jest.fn();
    const prisma = {
      schoolMembership: editorMembership,
      $transaction: transaction,
    } as unknown as PrismaService;

    await expect(
      new WebsiteService(prisma).createPage("school-1", "editor-1", {
        slug: "our-school/head",
        title: "Welcome",
        contentType: "page",
        content: {
          heading: "Welcome",
          safeguardingNotes: "Must never be published",
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("creates versioned blog posts with rich editor JSON and complete SEO metadata", async () => {
    const pageCreate = jest.fn().mockResolvedValue({
      id: "blog-1",
      slug: "school-update",
      contentType: "blog",
      title: "School update",
      status: "draft",
      currentVersionNumber: 1,
    });
    const transaction = {
      websitePage: { create: pageCreate },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      schoolMembership: editorMembership,
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;

    await new WebsiteService(prisma).createBlog("school-1", "editor-1", {
      title: "School update",
      slug: "school-update",
      content: {
        excerpt: "A short school update.",
        mainImageUrl: "https://school.example/images/update.webp",
        body: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Welcome",
                  marks: [
                    { type: "blogTextColor", attrs: { color: "#175cd3" } },
                    { type: "highlight", attrs: { color: "#fff1a6" } },
                    {
                      type: "link",
                      attrs: {
                        href: "https://school.example/news",
                        target: "_blank",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        metaKeywords: "school news, community",
        openGraph: {
          title: "School update",
          siteName: "School",
          imageUrl: "https://school.example/update.webp",
        },
        twitter: {
          card: "summary_large_image",
          title: "School update",
          site: "@school",
        },
        schema: {
          type: "BlogPosting",
          markup: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: "School update",
            keywords: ["school", "community"],
          }),
        },
      },
      seoTitle: "School update",
      seoDescription: "A short school update.",
    });

    expect(pageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contentType: "blog",
          versions: {
            create: expect.objectContaining({
              content: expect.objectContaining({
                excerpt: "A short school update.",
                body: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: "Welcome",
                          marks: [
                            {
                              type: "blogTextColor",
                              attrs: { color: "#175cd3" },
                            },
                            { type: "highlight", attrs: { color: "#fff1a6" } },
                            {
                              type: "link",
                              attrs: {
                                href: "https://school.example/news",
                                target: "_blank",
                                rel: "noreferrer noopener",
                              },
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                openGraph: expect.objectContaining({ title: "School update" }),
                twitter: expect.objectContaining({
                  card: "summary_large_image",
                }),
                schema: expect.objectContaining({ type: "BlogPosting" }),
              }),
              seoTitle: "School update",
            }),
          },
        }),
      }),
    );
  });

  it("rejects unsafe links and unsupported editor nodes in blog content", async () => {
    const transaction = jest.fn();
    const prisma = {
      schoolMembership: editorMembership,
      $transaction: transaction,
    } as unknown as PrismaService;

    await expect(
      new WebsiteService(prisma).createBlog("school-1", "editor-1", {
        title: "Unsafe post",
        slug: "unsafe-post",
        content: {
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "unsafe",
                    marks: [
                      { type: "link", attrs: { href: "javascript:alert(1)" } },
                    ],
                  },
                ],
              },
            ],
          },
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("preserves text alignment and supported table cell attributes from the editor", async () => {
    const pageCreate = jest.fn().mockResolvedValue({
      id: "blog-1",
      slug: "formatted-post",
      contentType: "blog",
      title: "Formatted post",
      status: "draft",
      currentVersionNumber: 1,
    });
    const transaction = {
      websitePage: { create: pageCreate },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      schoolMembership: editorMembership,
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;

    await new WebsiteService(prisma).createBlog("school-1", "editor-1", {
      title: "Formatted post",
      slug: "formatted-post",
      content: {
        body: {
          type: "doc",
          content: [
            { type: "paragraph", attrs: { textAlign: "center" }, content: [] },
            {
              type: "table",
              content: [
                {
                  type: "tableRow",
                  content: [
                    {
                      type: "tableCell",
                      attrs: { colspan: 2, rowspan: 1, colwidth: [180, null] },
                      content: [{ type: "paragraph", content: [] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });

    expect(pageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          versions: {
            create: expect.objectContaining({
              content: {
                body: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      attrs: { textAlign: "center" },
                      content: [],
                    },
                    {
                      type: "table",
                      content: [
                        {
                          type: "tableRow",
                          content: [
                            {
                              type: "tableCell",
                              attrs: {
                                colspan: 2,
                                rowspan: 1,
                                colwidth: [180, null],
                              },
                              content: [{ type: "paragraph", content: [] }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            }),
          },
        }),
      }),
    );
  });

  it("prevents the blog update route from modifying a non-blog page", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      schoolMembership: editorMembership,
      $transaction: jest.fn(async (callback) =>
        callback({
          websitePage: { findFirst },
        }),
      ),
    } as unknown as PrismaService;

    await expect(
      new WebsiteService(prisma).updateBlog("school-1", "editor-1", "page-1", {
        title: "Not a blog",
        slug: "not-a-blog",
        content: { body: { type: "doc", content: [] } },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { schoolId: "school-1", id: "page-1", contentType: "blog" },
      }),
    );
  });

  it("lists current blog versions without exposing internal image storage keys", async () => {
    const prisma = {
      schoolMembership: editorMembership,
      websitePage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "blog-1",
            slug: "school-update",
            title: "School update",
            status: "draft",
            currentVersionNumber: 2,
            publishedVersionNumber: null,
            publishedAt: null,
            createdAt: new Date("2026-10-01T00:00:00.000Z"),
            updatedAt: new Date("2026-10-02T00:00:00.000Z"),
            versions: [
              {
                versionNumber: 2,
                slug: "school-update",
                title: "School update",
                content: {
                  excerpt: "A short update",
                  mainImageUrl:
                    "/api/v1/website/blog/blog-1/image?schoolCode=SCHOOL",
                  mainImageStorageKey: "website-blog/private.webp",
                  body: { type: "doc", content: [] },
                },
                seoTitle: "School update",
                seoDescription: "A short description",
                createdAt: new Date("2026-10-02T00:00:00.000Z"),
              },
            ],
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
    } as unknown as PrismaService;

    const result = await new WebsiteService(prisma).listBlogs(
      "school-1",
      "editor-1",
      {
        limit: 20,
        offset: 0,
      },
    );

    expect(result.items[0]).toMatchObject({
      id: "blog-1",
      content: {
        excerpt: "A short update",
        mainImageUrl: "/api/v1/website/blog/blog-1/image?schoolCode=SCHOOL",
      },
      seo: { title: "School update", description: "A short description" },
    });
    expect(JSON.stringify(result)).not.toContain("mainImageStorageKey");
  });

  it("converts uploaded blog images to WebP and stores them as a draft version", async () => {
    const versionCreate = jest.fn().mockResolvedValue({});
    const pageUpdate = jest.fn().mockResolvedValue({});
    const storage = {
      saveFile: jest.fn().mockResolvedValue("website-blog/image-1.webp"),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    } as unknown as FileStorageService;
    const transaction = {
      websitePageVersion: { create: versionCreate },
      websitePage: { update: pageUpdate },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      schoolMembership: editorMembership,
      websitePage: {
        findFirst: jest.fn().mockResolvedValue({
          id: "blog-1",
          slug: "school-update",
          title: "School update",
          currentVersionNumber: 1,
          versions: [
            {
              content: {
                excerpt: "A short update",
                body: { type: "doc", content: [] },
              },
              seoTitle: "SEO title",
              seoDescription: "SEO description",
            },
          ],
        }),
      },
      school: { findUnique: jest.fn().mockResolvedValue({ code: "SCHOOL" }) },
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    const image = await sharp({
      create: { width: 1, height: 1, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();

    const result = await new WebsiteService(
      prisma,
      storage,
    ).uploadBlogMainImage("school-1", "editor-1", "blog-1", {
      buffer: image,
      mimetype: "image/png",
      originalname: "feature.png",
    });

    expect(result).toEqual({
      blogId: "blog-1",
      versionNumber: 2,
      status: "draft",
      imageUrl: "/api/v1/website/blog/blog-1/image?schoolCode=SCHOOL",
    });
    expect(storage.saveFile).toHaveBeenCalledWith(
      "website-blog",
      "feature.webp",
      expect.any(Buffer),
    );
    expect(versionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          versionNumber: 2,
          content: expect.objectContaining({
            mainImageStorageKey: "website-blog/image-1.webp",
            mainImageUrl: result.imageUrl,
          }),
          seoTitle: "SEO title",
          seoDescription: "SEO description",
        }),
      }),
    );
    const optimizedImage = (storage.saveFile as jest.Mock).mock
      .calls[0][2] as Buffer;
    await expect(sharp(optimizedImage).metadata()).resolves.toMatchObject({
      format: "webp",
    });
  });

  it("requires a distinct publisher to approve the current reviewed version", async () => {
    const versionFindFirst = jest.fn().mockResolvedValue({
      id: "version-1",
      status: "review",
      createdById: "editor-1",
    });
    const pageFindFirst = jest
      .fn()
      .mockResolvedValue({ currentVersionNumber: 1 });
    const transaction = {
      websitePageVersion: {
        findFirst: versionFindFirst,
        update: jest
          .fn()
          .mockResolvedValue({ versionNumber: 1, status: "approved" }),
      },
      websitePage: {
        findFirst: pageFindFirst,
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({
          membershipRoles: [schoolMembershipRole("HEADTEACHER")],
        }),
      },
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;

    await expect(
      new WebsiteService(prisma).approve("school-1", "editor-1", "page-1", 1),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction.websitePageVersion.update).not.toHaveBeenCalled();
  });

  it("marks only the current author's drafts as directly publishable", async () => {
    const prisma = {
      schoolMembership: editorMembership,
      websitePage: {
        findFirst: jest.fn().mockResolvedValue({ id: "page-1" }),
      },
      websitePageVersion: {
        findMany: jest.fn().mockResolvedValue([
          { versionNumber: 3, status: "draft", createdById: "editor-1" },
          { versionNumber: 2, status: "draft", createdById: "another-editor" },
          { versionNumber: 1, status: "review", createdById: "editor-1" },
        ]),
      },
    } as unknown as PrismaService;

    await expect(
      new WebsiteService(prisma)
        .listVersions("school-1", "editor-1", "page-1"),
    ).resolves.toMatchObject({
      items: [
        { versionNumber: 3, canPublishDraft: true },
        { versionNumber: 2, canPublishDraft: false },
        { versionNumber: 1, canPublishDraft: false },
      ],
      total: 3,
    });
  });

  it("publishes only an approved version and reports when the optional revalidation target is absent", async () => {
    const envKeys = [
      "WEBSITE_REVALIDATE_URL",
      "WEBSITE_REVALIDATE_SECRET",
    ] as const;
    const originalEnv = Object.fromEntries(
      envKeys.map((key) => [key, process.env[key]]),
    );
    delete process.env.WEBSITE_REVALIDATE_URL;
    delete process.env.WEBSITE_REVALIDATE_SECRET;
    const versionUpdate = jest.fn().mockResolvedValue({});
    const pageUpdate = jest.fn().mockResolvedValue({});
    const auditCreate = jest.fn().mockResolvedValue({});
    const transaction = {
      websitePage: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: "page-1",
            contentType: "page",
            currentVersionNumber: 2,
          })
          .mockResolvedValueOnce(null),
        update: pageUpdate,
      },
      websitePageVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "version-2",
          status: "approved",
          scheduledAt: null,
          slug: "welcome",
        }),
        update: versionUpdate,
      },
      school: {
        findUnique: jest.fn().mockResolvedValue({ code: "NORTH-SCHOOL" }),
      },
      auditEvent: { create: auditCreate },
    };
    const prisma = {
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({
          membershipRoles: [schoolMembershipRole("ADMIN")],
        }),
      },
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;

    try {
      await expect(
        new WebsiteService(prisma).publish("school-1", "publisher-1", "page-1"),
      ).resolves.toMatchObject({
        versionNumber: 2,
        status: "published",
        revalidation: { status: "not_configured" },
      });
      expect(versionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "published",
            publishedAt: expect.any(Date),
          }),
        }),
      );
      expect(pageUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            slug: "welcome",
            publishedSlug: "welcome",
            status: "published",
            publishedVersionNumber: 2,
            publishedAt: expect.any(Date),
          },
        }),
      );
      expect(auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorUserId: "publisher-1",
            action: "website.page.version.published",
          }),
        }),
      );
    } finally {
      for (const key of envKeys) {
        const value = originalEnv[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("allows a super admin to publish their own draft directly", async () => {
    const envKeys = [
      "WEBSITE_REVALIDATE_URL",
      "WEBSITE_REVALIDATE_SECRET",
    ] as const;
    const originalEnv = Object.fromEntries(
      envKeys.map((key) => [key, process.env[key]]),
    );
    delete process.env.WEBSITE_REVALIDATE_URL;
    delete process.env.WEBSITE_REVALIDATE_SECRET;
    const versionUpdate = jest.fn().mockResolvedValue({});
    const pageUpdate = jest.fn().mockResolvedValue({});
    const auditCreate = jest.fn().mockResolvedValue({});
    const transaction = {
      websitePage: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: "page-1",
            contentType: "page",
            currentVersionNumber: 2,
            publishedSlug: "welcome",
          })
          .mockResolvedValueOnce(null),
        update: pageUpdate,
      },
      websitePageVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "version-2",
          status: "draft",
          scheduledAt: null,
          slug: "welcome",
          createdById: "author-1",
        }),
        update: versionUpdate,
      },
      school: {
        findUnique: jest.fn().mockResolvedValue({ code: "NORTH-SCHOOL" }),
      },
      auditEvent: { create: auditCreate },
    };
    const prisma = {
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({
          membershipRoles: [schoolMembershipRole("SUPER_ADMIN")],
        }),
      },
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;

    try {
      await expect(
        new WebsiteService(prisma).publishDraft(
          "school-1",
          "author-1",
          "page-1",
        ),
      ).resolves.toMatchObject({
        versionNumber: 2,
        status: "published",
        revalidation: { status: "not_configured" },
      });
      expect(versionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "published",
            publishedAt: expect.any(Date),
          }),
        }),
      );
      expect(pageUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            publishedVersionNumber: 2,
            status: "published",
          }),
        }),
      );
      expect(auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorUserId: "author-1",
            action: "website.page.version.published_directly",
            metadata: { versionNumber: 2, direct: true },
          }),
        }),
      );
    } finally {
      for (const key of envKeys) {
        const value = originalEnv[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("does not allow a super admin to directly publish another author's draft", async () => {
    const transaction = {
      websitePage: {
        findFirst: jest.fn().mockResolvedValue({
          id: "page-1",
          contentType: "page",
          currentVersionNumber: 2,
          publishedSlug: null,
        }),
      },
      websitePageVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "version-2",
          status: "draft",
          scheduledAt: null,
          slug: "welcome",
          createdById: "another-author",
        }),
      },
    };
    const prisma = {
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({
          membershipRoles: [schoolMembershipRole("SUPER_ADMIN")],
        }),
      },
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;

    await expect(
      new WebsiteService(prisma).publishDraft(
        "school-1",
        "publisher-1",
        "page-1",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects publishing a slug already owned by another live page", async () => {
    const pageFindFirst = jest
      .fn()
      .mockResolvedValueOnce({
        id: "page-1",
        contentType: "page",
        currentVersionNumber: 2,
      })
      .mockResolvedValueOnce({ id: "page-2" });
    const pageUpdate = jest.fn();
    const transaction = {
      websitePage: { findFirst: pageFindFirst, update: pageUpdate },
      websitePageVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "version-2",
          status: "approved",
          scheduledAt: null,
          slug: "welcome",
        }),
      },
    };
    const prisma = {
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({
          membershipRoles: [schoolMembershipRole("ADMIN")],
        }),
      },
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;

    await expect(
      new WebsiteService(prisma).publish("school-1", "publisher-1", "page-1"),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(pageFindFirst).toHaveBeenLastCalledWith({
      where: {
        schoolId: "school-1",
        contentType: "page",
        publishedSlug: "welcome",
        id: { not: "page-1" },
      },
      select: { id: true },
    });
    expect(pageUpdate).not.toHaveBeenCalled();
  });

  it("signs the exact cache revalidation payload with HMAC-SHA256", async () => {
    const envKeys = [
      "WEBSITE_REVALIDATE_URL",
      "WEBSITE_REVALIDATE_SECRET",
    ] as const;
    const originalEnv = Object.fromEntries(
      envKeys.map((key) => [key, process.env[key]]),
    );
    process.env.WEBSITE_REVALIDATE_URL =
      "https://school.example/api/revalidate";
    process.env.WEBSITE_REVALIDATE_SECRET = "test-revalidation-secret";
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const transaction = {
      websitePage: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: "page-1",
            contentType: "page",
            currentVersionNumber: 2,
            publishedSlug: "old-welcome",
          })
          .mockResolvedValueOnce(null),
        update: jest.fn().mockResolvedValue({}),
      },
      websitePageVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "version-2",
          status: "approved",
          scheduledAt: null,
          slug: "welcome",
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      school: {
        findUnique: jest.fn().mockResolvedValue({ code: "NORTH-SCHOOL" }),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({
          membershipRoles: [schoolMembershipRole("ADMIN")],
        }),
      },
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;

    try {
      await expect(
        new WebsiteService(prisma).publish("school-1", "publisher-1", "page-1"),
      ).resolves.toMatchObject({ revalidation: { status: "completed" } });
      const body = JSON.stringify({
        schoolCode: "NORTH-SCHOOL",
        paths: ["/welcome", "/sitemap.xml", "/old-welcome"],
      });
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://school.example/api/revalidate",
        expect.objectContaining({
          body,
          headers: {
            "content-type": "application/json",
            "x-website-signature": `sha256=${createHmac("sha256", "test-revalidation-secret").update(body).digest("hex")}`,
          },
        }),
      );
    } finally {
      fetchSpy.mockRestore();
      for (const key of envKeys) {
        const value = originalEnv[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("reports cache revalidation failures after publishing and preserves the retry path", async () => {
    const envKeys = [
      "WEBSITE_REVALIDATE_URL",
      "WEBSITE_REVALIDATE_SECRET",
    ] as const;
    const originalEnv = Object.fromEntries(
      envKeys.map((key) => [key, process.env[key]]),
    );
    process.env.WEBSITE_REVALIDATE_URL =
      "https://school.example/api/revalidate";
    process.env.WEBSITE_REVALIDATE_SECRET = "test-revalidation-secret";
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 500 }));
    const transaction = {
      websitePage: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: "page-1",
            contentType: "page",
            currentVersionNumber: 2,
          })
          .mockResolvedValueOnce(null),
        update: jest.fn().mockResolvedValue({}),
      },
      websitePageVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "version-2",
          status: "approved",
          scheduledAt: null,
          slug: "welcome",
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      school: {
        findUnique: jest.fn().mockResolvedValue({ code: "NORTH-SCHOOL" }),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({
          membershipRoles: [schoolMembershipRole("ADMIN")],
        }),
      },
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;

    try {
      await expect(
        new WebsiteService(prisma).publish("school-1", "publisher-1", "page-1"),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(transaction.websitePage.update).toHaveBeenCalled();
      expect(transaction.websitePageVersion.update).toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
      for (const key of envKeys) {
        const value = originalEnv[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("allows a publisher to retry revalidation for an already published page", async () => {
    const envKeys = [
      "WEBSITE_REVALIDATE_URL",
      "WEBSITE_REVALIDATE_SECRET",
    ] as const;
    const originalEnv = Object.fromEntries(
      envKeys.map((key) => [key, process.env[key]]),
    );
    process.env.WEBSITE_REVALIDATE_URL =
      "https://school.example/api/revalidate";
    process.env.WEBSITE_REVALIDATE_SECRET = "test-revalidation-secret";
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const auditCreate = jest.fn().mockResolvedValue({});
    const prisma = {
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({
          membershipRoles: [schoolMembershipRole("ADMIN")],
        }),
      },
      websitePage: {
        findFirst: jest.fn().mockResolvedValue({
          id: "page-1",
          contentType: "page",
          publishedVersionNumber: 2,
          versions: [{ slug: "welcome" }],
        }),
      },
      school: {
        findUnique: jest.fn().mockResolvedValue({ code: "NORTH-SCHOOL" }),
      },
      auditEvent: { create: auditCreate },
    } as unknown as PrismaService;

    try {
      await expect(
        new WebsiteService(prisma).revalidatePage(
          "school-1",
          "publisher-1",
          "page-1",
        ),
      ).resolves.toEqual({
        pageId: "page-1",
        revalidation: { status: "completed" },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorUserId: "publisher-1",
            action: "website.page.revalidated",
          }),
        }),
      );
    } finally {
      fetchSpy.mockRestore();
      for (const key of envKeys) {
        const value = originalEnv[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("projects only allow-listed fields from a published page version", async () => {
    const page = {
      id: "page-1",
      schoolId: "school-1",
      slug: "our-school/head",
      publishedSlug: "our-school/head",
      contentType: "page",
      title: "Welcome",
      publishedVersionNumber: 3,
      versions: [
        {
          versionNumber: 3,
          slug: "our-school/head",
          title: "Welcome",
          content: {
            heading: "Welcome to our school",
            privatePupilData: "do not return",
            sendDetails: "restricted SEND data",
            medicalConditions: "restricted medical data",
            safeguardingNotes: "restricted safeguarding data",
            financeBalance: "private finance data",
            privateStaffNotes: "private staff data",
          },
          seoTitle: "Welcome",
          seoDescription: "School information",
          publishedAt: new Date("2026-10-10T00:00:00.000Z"),
        },
      ],
    };
    const prisma = {
      school: {
        findFirst: jest.fn().mockResolvedValue({
          id: "school-1",
          code: "NORTH-SCHOOL",
          name: "North School",
        }),
      },
      websitePage: { findMany: jest.fn().mockResolvedValue([page]) },
    } as unknown as PrismaService;

    const result = await new WebsiteService(prisma).publicPage(
      { schoolCode: "NORTH-SCHOOL", limit: 20 },
      "our-school/head",
    );

    expect(result).toEqual({
      school: { code: "NORTH-SCHOOL", name: "North School" },
      page: {
        slug: "our-school/head",
        title: "Welcome",
        type: "page",
        content: { heading: "Welcome to our school" },
        seo: { title: "Welcome", description: "School information" },
        publishedAt: new Date("2026-10-10T00:00:00.000Z"),
      },
    });

    const serialized = JSON.stringify(result);
    for (const privateField of [
      "privatePupilData",
      "sendDetails",
      "medicalConditions",
      "safeguardingNotes",
      "financeBalance",
      "privateStaffNotes",
    ]) {
      expect(serialized).not.toContain(privateField);
    }
  });

  it("resolves only published reusable pathways references for public pages", async () => {
    const componentId = "9d02d496-70ec-4c8f-b07d-fba04c5e5897";
    const page = {
      id: "page-1",
      schoolId: "school-1",
      slug: "our-school",
      publishedSlug: "our-school",
      contentType: "page",
      title: "Our School",
      publishedVersionNumber: 1,
      versions: [{
        versionNumber: 1,
        slug: "our-school",
        title: "Our School",
        content: {
          heading: "Explore our school",
          body: [
            { type: "pathways", componentId },
            {
              type: "pathways",
              componentId: "b76efce0-32a8-459e-8998-1212de973448",
            },
            {
              type: "pathways",
              eyebrow: "KEY PATHWAYS",
              heading: "Explore Our School",
              intro: "Find the right information for your family.",
              cards: [{
                title: "Admissions",
                description: "Explore how to join our school.",
                href: "/admissions",
                linkLabel: "Discover More",
                privateStaffNotes: "must not be projected",
              }],
              privatePupilData: "must not be projected",
            },
          ],
        },
        seoTitle: null,
        seoDescription: null,
        publishedAt: null,
      }],
    };
    const component = {
      id: componentId,
      schoolId: "school-1",
      slug: "key-pathways",
      contentType: "pathways",
      title: "Key Pathways",
      publishedVersionNumber: 2,
      versions: [{
        versionNumber: 2,
        slug: "key-pathways",
        title: "Key Pathways",
        content: {
          eyebrow: "KEY PATHWAYS",
          heading: "Explore Our School",
          intro: "Find the right information for your family.",
          cards: [{
            title: "Admissions",
            description: "Explore how to join our school.",
            href: "/admissions",
            linkLabel: "Discover More",
          }],
        },
        seoTitle: null,
        seoDescription: null,
        publishedAt: null,
      }],
    };
    const findMany = jest.fn(
      ({ where }: { where: { contentType: string; id?: { in: string[] } } }) => {
        if (where.contentType === "page") return [page];
        return where.id?.in.includes(component.id) ? [component] : [];
      },
    );
    const prisma = {
      school: {
        findFirst: jest.fn().mockResolvedValue({
          id: "school-1",
          code: "NORTH-SCHOOL",
          name: "North School",
        }),
      },
      websitePage: { findMany },
    } as unknown as PrismaService;

    const result = await new WebsiteService(prisma).publicPage(
      { schoolCode: "NORTH-SCHOOL", limit: 20 },
      "our-school",
    );

    expect(result.page.content.body).toEqual([
      {
        type: "pathways-content",
        eyebrow: "KEY PATHWAYS",
        heading: "Explore Our School",
        intro: "Find the right information for your family.",
        cards: [{
          title: "Admissions",
          description: "Explore how to join our school.",
          href: "/admissions",
          linkLabel: "Discover More",
        }],
      },
      {
        type: "pathways-content",
        eyebrow: "KEY PATHWAYS",
        heading: "Explore Our School",
        intro: "Find the right information for your family.",
        cards: [{
          title: "Admissions",
          description: "Explore how to join our school.",
          href: "/admissions",
          linkLabel: "Discover More",
        }],
      },
    ]);
    expect(findMany.mock.calls[1][0].where.id).toEqual({
      in: [componentId, "b76efce0-32a8-459e-8998-1212de973448"],
    });
  });

  it("resolves published reusable timeline references for public pages", async () => {
    const componentId = "9d02d496-70ec-4c8f-b07d-fba04c5e5897";
    const page = {
      id: "page-1",
      schoolId: "school-1",
      slug: "our-school",
      publishedSlug: "our-school",
      contentType: "page",
      title: "Our School",
      publishedVersionNumber: 1,
      versions: [{
        versionNumber: 1,
        slug: "our-school",
        title: "Our School",
        content: {
          heading: "Our School",
          body: [{ type: "timeline", componentId }],
        },
        seoTitle: null,
        seoDescription: null,
        publishedAt: null,
      }],
    };
    const timeline = {
      id: componentId,
      schoolId: "school-1",
      slug: "components/timeline/our-journey",
      contentType: "timeline",
      title: "Our Journey Through the Years",
      publishedVersionNumber: 1,
      versions: [{
        versionNumber: 1,
        slug: "components/timeline/our-journey",
        title: "Our Journey Through the Years",
        content: {
          eyebrow: "160 YEARS OF EXCELLENCE",
          heading: "Our Journey Through the Years",
          intro: "A history of the school.",
          milestones: [{
            marker: "1",
            year: "1864",
            title: "Foundation",
            description: "The school was founded.",
          }],
        },
        seoTitle: null,
        seoDescription: null,
        publishedAt: null,
      }],
    };
    const findMany = jest.fn(
      ({ where }: { where: { contentType: string; id?: { in: string[] } } }) => {
        if (where.contentType === "page") return [page];
        return where.id?.in.includes(timeline.id) ? [timeline] : [];
      },
    );
    const prisma = {
      school: {
        findFirst: jest.fn().mockResolvedValue({
          id: "school-1",
          code: "NORTH-SCHOOL",
          name: "North School",
        }),
      },
      websitePage: { findMany },
    } as unknown as PrismaService;

    const result = await new WebsiteService(prisma).publicPage(
      { schoolCode: "NORTH-SCHOOL", limit: 20 },
      "our-school",
    );

    expect(result.page.content.body).toEqual([{
      type: "timeline-content",
      eyebrow: "160 YEARS OF EXCELLENCE",
      heading: "Our Journey Through the Years",
      intro: "A history of the school.",
      milestones: [{
        marker: "1",
        year: "1864",
        title: "Foundation",
        description: "The school was founded.",
      }],
    }]);
    expect(findMany.mock.calls[1][0].where.id).toEqual({ in: [componentId] });
  });

  it("returns active published menu groups in display order", async () => {
    const pages = [
      {
        id: "header-menu",
        schoolId: "school-1",
        slug: "learning",
        contentType: "navigation",
        title: "Learning",
        publishedVersionNumber: 1,
        versions: [
          {
            versionNumber: 1,
            slug: "learning",
            title: "Learning",
            content: {
              category: "header",
              style: "dropdown",
              href: "/learning",
              external: false,
              active: true,
              items: [
                { label: "Curriculum", href: "/curriculum", external: false },
              ],
              sortOrder: 3,
            },
            seoTitle: null,
            seoDescription: null,
            publishedAt: new Date("2026-10-10T00:00:00.000Z"),
          },
        ],
      },
      {
        id: "footer-menu",
        schoolId: "school-1",
        slug: "school-information",
        contentType: "navigation",
        title: "School information",
        publishedVersionNumber: 2,
        versions: [
          {
            versionNumber: 2,
            slug: "school-information",
            title: "School information",
            content: {
              category: "footer",
              active: true,
              items: [
                { label: "Policies", href: "/policies", external: false },
                {
                  label: "Unapproved policy",
                  href: "/policies/unapproved",
                  external: false,
                  active: false,
                },
              ],
              sortOrder: 1,
            },
            seoTitle: null,
            seoDescription: null,
            publishedAt: new Date("2026-10-10T00:00:00.000Z"),
          },
        ],
      },
      {
        id: "utility-menu",
        schoolId: "school-1",
        slug: "parent-portal",
        contentType: "navigation",
        title: "Parent Portal",
        publishedVersionNumber: 1,
        versions: [
          {
            versionNumber: 1,
            slug: "parent-portal",
            title: "Parent Portal",
            content: {
              category: "utility",
              style: "simple",
              href: "/parent-portal",
              active: true,
              sortOrder: 1,
            },
            seoTitle: null,
            seoDescription: null,
            publishedAt: new Date("2026-10-10T00:00:00.000Z"),
          },
        ],
      },
      {
        id: "inactive-header-menu",
        schoolId: "school-1",
        slug: "inactive",
        contentType: "navigation",
        title: "Inactive",
        publishedVersionNumber: 1,
        versions: [
          {
            versionNumber: 1,
            slug: "inactive",
            title: "Inactive",
            content: {
              category: "header",
              style: "simple",
              href: "/inactive",
              active: false,
              sortOrder: 0,
            },
            seoTitle: null,
            seoDescription: null,
            publishedAt: new Date("2026-10-10T00:00:00.000Z"),
          },
        ],
      },
      {
        id: "hidden-footer-menu",
        schoolId: "school-1",
        slug: "unapproved-policies",
        contentType: "navigation",
        title: "Unapproved policies",
        publishedVersionNumber: 1,
        versions: [
          {
            versionNumber: 1,
            slug: "unapproved-policies",
            title: "Unapproved policies",
            content: {
              category: "footer",
              active: true,
              items: [
                {
                  label: "Privacy",
                  href: "/privacy",
                  external: false,
                  active: false,
                },
              ],
              sortOrder: 2,
            },
            seoTitle: null,
            seoDescription: null,
            publishedAt: new Date("2026-10-10T00:00:00.000Z"),
          },
        ],
      },
      {
        id: "unpublished-menu",
        schoolId: "school-1",
        slug: "unpublished",
        contentType: "navigation",
        title: "Unpublished",
        publishedVersionNumber: null,
        versions: [],
      },
    ];
    const prisma = {
      school: {
        findFirst: jest.fn().mockResolvedValue({
          id: "school-1",
          code: "NORTH-SCHOOL",
          name: "North School",
        }),
      },
      websitePage: { findMany: jest.fn().mockResolvedValue(pages) },
    } as unknown as PrismaService;

    const result = await new WebsiteService(prisma).publicMenus({
      schoolCode: "NORTH-SCHOOL",
      limit: 20,
    });

    expect(result).toMatchObject({
      school: { code: "NORTH-SCHOOL", name: "North School" },
      headerMenus: [
        {
          title: "Learning",
          category: "header",
          style: "dropdown",
          href: "/learning",
          items: [
            { label: "Curriculum", href: "/curriculum", external: false },
          ],
          sortOrder: 3,
        },
      ],
      footerMenus: [
        {
          title: "School information",
          category: "footer",
          items: [{ label: "Policies", href: "/policies", external: false }],
          sortOrder: 1,
        },
      ],
      utilityMenus: [
        {
          title: "Parent Portal",
          category: "utility",
          style: "simple",
          href: "/parent-portal",
          active: true,
          sortOrder: 1,
        },
      ],
    });
  });

  it("limits public calendar projections to non-pupil public events", async () => {
    const eventFindMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      school: {
        findFirst: jest.fn().mockResolvedValue({
          id: "school-1",
          code: "NORTH-SCHOOL",
          name: "North School",
        }),
      },
      calendarEvent: { findMany: eventFindMany },
    } as unknown as PrismaService;

    await new WebsiteService(prisma).publicEvents({
      schoolCode: "NORTH-SCHOOL",
      limit: 10,
    });

    expect(eventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          schoolId: "school-1",
          audience: "public",
          pupilId: null,
          endsAt: { gte: expect.any(Date) },
        },
        select: expect.not.objectContaining({
          pupilId: true,
          createdById: true,
        }),
      }),
    );
  });

  it("claims and publishes scheduled versions atomically", async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      {
        school_id: "school-1",
        page_id: "page-1",
        version_number: 4,
        content_type: "news",
        slug: "term-dates",
        school_code: "NORTH-SCHOOL",
      },
    ]);
    const versionUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const pageUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const auditCreate = jest.fn().mockResolvedValue({});
    const transaction = {
      $queryRaw: queryRaw,
      websitePageVersion: { updateMany: versionUpdate },
      websitePage: { updateMany: pageUpdate },
      auditEvent: { create: auditCreate },
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;

    await expect(
      new WebsiteService(prisma).processScheduledPublications(),
    ).resolves.toBe(1);
    expect(queryRaw).toHaveBeenCalled();
    expect(versionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "scheduled",
          versionNumber: 4,
        }),
        data: expect.objectContaining({
          status: "published",
          publishedAt: expect.any(Date),
        }),
      }),
    );
    expect(pageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "published",
          publishedSlug: "term-dates",
          publishedVersionNumber: 4,
        }),
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "website.page.version.published_by_schedule",
          actorUserId: null,
        }),
      }),
    );
  });
});
