import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHmac } from "node:crypto";
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
    const result = await new WebsiteService(prisma).createPage("school-1", "editor-1", {
      slug: "welcome",
      title: "Welcome",
      contentType: "page",
      content: {
        heading: "Welcome to our school",
        body: [{ type: "paragraph", text: "A public introduction." }],
      },
    });

    expect(result).toMatchObject({ id: "page-1", status: "draft", currentVersionNumber: 1 });
    expect(pageCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        schoolId: "school-1",
        slug: "welcome",
        versions: {
          create: expect.objectContaining({
            versionNumber: 1,
            content: {
              heading: "Welcome to our school",
              body: [{ type: "paragraph", text: "A public introduction." }],
            },
          }),
        },
      }),
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "website.page.created" }),
    }));
  });

  it("rejects unknown content properties rather than storing private ERP fields", async () => {
    const transaction = jest.fn();
    const prisma = {
      schoolMembership: editorMembership,
      $transaction: transaction,
    } as unknown as PrismaService;

    await expect(new WebsiteService(prisma).createPage("school-1", "editor-1", {
      slug: "welcome",
      title: "Welcome",
      contentType: "page",
      content: {
        heading: "Welcome",
        safeguardingNotes: "Must never be published",
      },
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("requires a distinct publisher to approve the current reviewed version", async () => {
    const versionFindFirst = jest.fn().mockResolvedValue({
      id: "version-1",
      status: "review",
      createdById: "editor-1",
    });
    const pageFindFirst = jest.fn().mockResolvedValue({ currentVersionNumber: 1 });
    const transaction = {
      websitePageVersion: {
        findFirst: versionFindFirst,
        update: jest.fn().mockResolvedValue({ versionNumber: 1, status: "approved" }),
      },
      websitePage: { findFirst: pageFindFirst, updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
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

    await expect(new WebsiteService(prisma).approve("school-1", "editor-1", "page-1", 1))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction.websitePageVersion.update).not.toHaveBeenCalled();
  });

  it("publishes only an approved version and reports when the optional revalidation target is absent", async () => {
    const envKeys = ["WEBSITE_REVALIDATE_URL", "WEBSITE_REVALIDATE_SECRET"] as const;
    const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    delete process.env.WEBSITE_REVALIDATE_URL;
    delete process.env.WEBSITE_REVALIDATE_SECRET;
    const versionUpdate = jest.fn().mockResolvedValue({});
    const pageUpdate = jest.fn().mockResolvedValue({});
    const auditCreate = jest.fn().mockResolvedValue({});
    const transaction = {
      websitePage: {
        findFirst: jest.fn()
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
      school: { findUnique: jest.fn().mockResolvedValue({ code: "NORTH-SCHOOL" }) },
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
      await expect(new WebsiteService(prisma).publish("school-1", "publisher-1", "page-1"))
        .resolves.toMatchObject({
          versionNumber: 2,
          status: "published",
          revalidation: { status: "not_configured" },
        });
      expect(versionUpdate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: "published", publishedAt: expect.any(Date) }),
      }));
      expect(pageUpdate).toHaveBeenCalledWith(expect.objectContaining({
        data: {
          slug: "welcome",
          publishedSlug: "welcome",
          status: "published",
          publishedVersionNumber: 2,
          publishedAt: expect.any(Date),
        },
      }));
      expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: "publisher-1",
          action: "website.page.version.published",
        }),
      }));
    } finally {
      for (const key of envKeys) {
        const value = originalEnv[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("rejects publishing a slug already owned by another live page", async () => {
    const pageFindFirst = jest.fn()
      .mockResolvedValueOnce({ id: "page-1", contentType: "page", currentVersionNumber: 2 })
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

    await expect(new WebsiteService(prisma).publish("school-1", "publisher-1", "page-1"))
      .rejects.toBeInstanceOf(ConflictException);
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
    const envKeys = ["WEBSITE_REVALIDATE_URL", "WEBSITE_REVALIDATE_SECRET"] as const;
    const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    process.env.WEBSITE_REVALIDATE_URL = "https://school.example/api/revalidate";
    process.env.WEBSITE_REVALIDATE_SECRET = "test-revalidation-secret";
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const transaction = {
      websitePage: {
        findFirst: jest.fn()
          .mockResolvedValueOnce({ id: "page-1", contentType: "page", currentVersionNumber: 2 })
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
      school: { findUnique: jest.fn().mockResolvedValue({ code: "NORTH-SCHOOL" }) },
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
      await expect(new WebsiteService(prisma).publish("school-1", "publisher-1", "page-1"))
        .resolves.toMatchObject({ revalidation: { status: "completed" } });
      const body = JSON.stringify({ schoolCode: "NORTH-SCHOOL", paths: ["/welcome", "/sitemap.xml"] });
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
    const envKeys = ["WEBSITE_REVALIDATE_URL", "WEBSITE_REVALIDATE_SECRET"] as const;
    const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    process.env.WEBSITE_REVALIDATE_URL = "https://school.example/api/revalidate";
    process.env.WEBSITE_REVALIDATE_SECRET = "test-revalidation-secret";
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    const transaction = {
      websitePage: {
        findFirst: jest.fn()
          .mockResolvedValueOnce({ id: "page-1", contentType: "page", currentVersionNumber: 2 })
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
      school: { findUnique: jest.fn().mockResolvedValue({ code: "NORTH-SCHOOL" }) },
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
      await expect(new WebsiteService(prisma).publish("school-1", "publisher-1", "page-1"))
        .rejects.toBeInstanceOf(ServiceUnavailableException);
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
    const envKeys = ["WEBSITE_REVALIDATE_URL", "WEBSITE_REVALIDATE_SECRET"] as const;
    const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    process.env.WEBSITE_REVALIDATE_URL = "https://school.example/api/revalidate";
    process.env.WEBSITE_REVALIDATE_SECRET = "test-revalidation-secret";
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
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
      school: { findUnique: jest.fn().mockResolvedValue({ code: "NORTH-SCHOOL" }) },
      auditEvent: { create: auditCreate },
    } as unknown as PrismaService;

    try {
      await expect(new WebsiteService(prisma).revalidatePage("school-1", "publisher-1", "page-1"))
        .resolves.toEqual({
          pageId: "page-1",
          revalidation: { status: "completed" },
        });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: "publisher-1",
          action: "website.page.revalidated",
        }),
      }));
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
      slug: "welcome",
      contentType: "page",
      title: "Welcome",
      publishedVersionNumber: 3,
      versions: [{
        versionNumber: 3,
        slug: "welcome",
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
      }],
    };
    const prisma = {
      school: {
        findFirst: jest.fn().mockResolvedValue({ id: "school-1", code: "NORTH-SCHOOL", name: "North School" }),
      },
      websitePage: { findMany: jest.fn().mockResolvedValue([page]) },
    } as unknown as PrismaService;

    const result = await new WebsiteService(prisma).publicPage({ schoolCode: "NORTH-SCHOOL", limit: 20 }, "welcome");

    expect(result).toEqual({
      school: { code: "NORTH-SCHOOL", name: "North School" },
      page: {
        slug: "welcome",
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

  it("limits public calendar projections to non-pupil public events", async () => {
    const eventFindMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      school: {
        findFirst: jest.fn().mockResolvedValue({ id: "school-1", code: "NORTH-SCHOOL", name: "North School" }),
      },
      calendarEvent: { findMany: eventFindMany },
    } as unknown as PrismaService;

    await new WebsiteService(prisma).publicEvents({ schoolCode: "NORTH-SCHOOL", limit: 10 });

    expect(eventFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        schoolId: "school-1",
        audience: "public",
        pupilId: null,
        endsAt: { gte: expect.any(Date) },
      },
      select: expect.not.objectContaining({ pupilId: true, createdById: true }),
    }));
  });

  it("claims and publishes scheduled versions atomically", async () => {
    const queryRaw = jest.fn().mockResolvedValue([{
      school_id: "school-1",
      page_id: "page-1",
      version_number: 4,
      content_type: "news",
      slug: "term-dates",
      school_code: "NORTH-SCHOOL",
    }]);
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

    await expect(new WebsiteService(prisma).processScheduledPublications()).resolves.toBe(1);
    expect(queryRaw).toHaveBeenCalled();
    expect(versionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "scheduled", versionNumber: 4 }),
      data: expect.objectContaining({ status: "published", publishedAt: expect.any(Date) }),
    }));
    expect(pageUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "published", publishedSlug: "term-dates", publishedVersionNumber: 4 }),
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "website.page.version.published_by_schedule", actorUserId: null }),
    }));
  });
});
