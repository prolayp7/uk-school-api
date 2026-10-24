import { ForbiddenException } from "@nestjs/common";
import nodemailer from "nodemailer";
import type { FileStorageService } from "../common/file-storage.service";
import type { PrismaService } from "../prisma/prisma.service";
import { schoolMembershipRole } from "../auth/school-permissions.test-utils";
import { CommunicationsService } from "./communications.service";

const unusedStorage = {
  saveFile: jest.fn(),
  readFile: jest.fn(),
  deleteFile: jest.fn(),
} as unknown as FileStorageService;

describe("CommunicationsService", () => {
  it("lists staff calendar events within the selected school and range", async () => {
    const membershipFindFirst = jest.fn().mockResolvedValue({
      membershipRoles: [schoolMembershipRole("HEADTEACHER")],
    });
    const events = [{ id: "event-1", audience: "staff" }];
    const findMany = jest.fn().mockResolvedValue(events);
    const auditCreate = jest.fn().mockResolvedValue({});
    const service = new CommunicationsService({
      schoolMembership: { findFirst: membershipFindFirst },
      calendarEvent: { findMany },
      auditEvent: { create: auditCreate },
    } as unknown as PrismaService, unusedStorage);

    await expect(service.listStaffCalendarEvents("school-1", "user-1", {
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-11-01T00:00:00.000Z",
    })).resolves.toEqual({ items: events, total: 1 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        schoolId: "school-1",
        startsAt: { lt: new Date("2026-11-01T00:00:00.000Z") },
        endsAt: { gte: new Date("2026-10-01T00:00:00.000Z") },
      },
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "calendar.events.viewed" }),
    }));
  });

  it("limits parent calendar events to public audiences and linked pupils", async () => {
    const eventFindMany = jest.fn().mockResolvedValue([]);
    const auditCreate = jest.fn().mockResolvedValue({});
    const service = new CommunicationsService({
      schoolMembership: {
        findMany: jest.fn().mockResolvedValue([{ schoolId: "school-1" }]),
      },
      pupilContact: {
        findMany: jest.fn().mockResolvedValue([{ schoolId: "school-1", pupilId: "pupil-1" }]),
      },
      calendarEvent: { findMany: eventFindMany },
      auditEvent: { create: auditCreate },
    } as unknown as PrismaService, unusedStorage);

    await service.listParentCalendarEvents("parent-1", {});

    expect(eventFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        schoolId: { in: ["school-1"] },
        audience: { in: ["parent", "public"] },
        OR: [{ pupilId: null }, { pupilId: { in: ["pupil-1"] } }],
      }),
    }));
    expect(auditCreate).toHaveBeenCalled();
  });

  it("rejects a pupil-specific parent calendar request without an active link", async () => {
    const eventFindMany = jest.fn();
    const service = new CommunicationsService({
      schoolMembership: {
        findMany: jest.fn().mockResolvedValue([{ schoolId: "school-1" }]),
      },
      pupilContact: { findMany: jest.fn().mockResolvedValue([]) },
      calendarEvent: { findMany: eventFindMany },
    } as unknown as PrismaService, unusedStorage);

    await expect(service.listParentCalendarEvents("parent-1", { pupilId: "pupil-2" }))
      .rejects.toThrow("You do not have calendar access to this pupil.");
    expect(eventFindMany).not.toHaveBeenCalled();
  });

  it("limits student calendar results to the signed-in pupil profile and student audiences", async () => {
    const eventFindMany = jest.fn().mockResolvedValue([]);
    const service = new CommunicationsService({
      schoolMembership: {
        findMany: jest.fn().mockResolvedValue([{ schoolId: "school-1" }]),
      },
      pupilProfile: {
        findMany: jest.fn().mockResolvedValue([{ schoolId: "school-1", id: "pupil-1" }]),
      },
      calendarEvent: { findMany: eventFindMany },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService, unusedStorage);

    await service.listStudentCalendarEvents("student-1", {});

    expect(eventFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        audience: { in: ["student", "public"] },
        OR: [{ pupilId: null }, { pupilId: { in: ["pupil-1"] } }],
      }),
    }));
  });

  it("creates calendar events atomically and denies teachers public publishing", async () => {
    const transaction = {
      calendarEvent: { create: jest.fn() },
      auditEvent: { create: jest.fn() },
    };
    const prisma = {
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({
          membershipRoles: [schoolMembershipRole("TEACHER")],
        }),
      },
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    const service = new CommunicationsService(prisma, unusedStorage);

    await expect(service.createCalendarEvent("school-1", "teacher-1", {
      title: "Open evening",
      audience: "public",
      startsAt: "2026-10-20T17:00:00.000Z",
      endsAt: "2026-10-20T19:00:00.000Z",
    })).rejects.toThrow("Only school leadership can publish public calendar events.");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("creates private document upload requests with normalized metadata and an expiry", async () => {
    const documentCreate = jest.fn().mockResolvedValue({
      id: "document-1",
      status: "upload_pending",
      uploadExpiresAt: new Date("2026-10-10T08:15:00.000Z"),
    });
    const service = new CommunicationsService({
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({
          membershipRoles: [schoolMembershipRole("ADMIN")],
        }),
      },
      schoolDocument: { create: documentCreate },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService, unusedStorage);

    const result = await service.createDocumentUploadRequest("school-1", "admin-1", {
      title: "Trip consent",
      originalFilename: "../../trip-consent.pdf",
      contentType: "application/pdf",
      byteSize: 1024,
    });

    expect(result).toMatchObject({
      id: "document-1",
      uploadUrl: "/api/v1/erp/documents/document-1/content",
      method: "PUT",
    });
    expect(documentCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        originalFilename: "trip-consent.pdf",
        contentType: "application/pdf",
        audience: "staff",
      }),
    }));
  });

  it("stores uploaded document bytes privately and marks the request ready", async () => {
    const bytes = Buffer.from("%PDF");
    const storage = {
      saveFile: jest.fn().mockResolvedValue("documents/document-1.pdf"),
      readFile: jest.fn(),
      deleteFile: jest.fn(),
    } as unknown as FileStorageService;
    const update = jest.fn().mockResolvedValue({ id: "document-1", status: "ready", byteSize: bytes.length });
    const auditCreate = jest.fn().mockResolvedValue({});
    const prisma = {
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({
          membershipRoles: [schoolMembershipRole("ADMIN")],
        }),
      },
      schoolDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "document-1",
          originalFilename: "trip.pdf",
          contentType: "application/pdf",
          byteSize: bytes.length,
        }),
        update,
      },
      auditEvent: { create: auditCreate },
      $transaction: jest.fn(async (operations) => Promise.all(operations)),
    } as unknown as PrismaService;

    await expect(new CommunicationsService(prisma, storage).uploadDocument(
      "school-1",
      "admin-1",
      "document-1",
      bytes,
      "application/pdf",
    )).resolves.toMatchObject({ id: "document-1", status: "ready" });
    expect(storage.saveFile).toHaveBeenCalledWith("documents", "trip.pdf", bytes);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: { storageKey: "documents/document-1.pdf", status: "ready" },
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "document.upload.completed",
        metadata: { byteSize: bytes.length, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
      }),
    }));
  });

  it("issues expiring hashed document download grants and streams only granted files", async () => {
    const bytes = Buffer.from("private document");
    const grantCreate = jest.fn().mockResolvedValue({});
    const grantFindFirst = jest.fn().mockResolvedValue({
      schoolId: "school-1",
      document: {
        storageKey: "documents/secret.pdf",
        originalFilename: "private.pdf",
        contentType: "application/pdf",
        status: "ready",
      },
    });
    const storage = {
      saveFile: jest.fn(),
      readFile: jest.fn().mockResolvedValue(bytes),
      deleteFile: jest.fn(),
    } as unknown as FileStorageService;
    const prisma = {
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({
          membershipRoles: [schoolMembershipRole("ADMIN")],
        }),
      },
      schoolDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "document-1",
          pupilId: null,
          audience: "staff",
          storageKey: "documents/secret.pdf",
          originalFilename: "private.pdf",
        }),
      },
      documentDownloadGrant: { create: grantCreate, findFirst: grantFindFirst },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (operations) => Promise.all(operations)),
    } as unknown as PrismaService;
    const service = new CommunicationsService(prisma, storage);

    const link = await service.issueDocumentDownload("school-1", "admin-1", "document-1");
    const token = link.downloadUrl.split("/").at(-1)!;

    expect(link.expiresAt).toBeTruthy();
    expect(grantCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        documentId: "document-1",
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    }));
    expect(grantCreate.mock.calls[0][0].data.tokenHash).not.toBe(token);
    await expect(service.downloadWithGrant(token)).resolves.toMatchObject({
      contents: bytes,
      filename: "private.pdf",
      contentType: "application/pdf",
    });
    expect(storage.readFile).toHaveBeenCalledWith("documents/secret.pdf");
  });

  it("creates a transactional message, in-app notification, and idempotent email job", async () => {
    const messageCreate = jest.fn().mockResolvedValue({
      id: "message-1",
      pupilId: "pupil-1",
      senderUserId: "staff-1",
      recipientUserId: "parent-1",
      subject: "Trip update",
      body: "The trip return time has changed.",
      createdAt: new Date("2026-10-10T08:00:00.000Z"),
    });
    const notificationCreate = jest.fn().mockResolvedValue({ id: "notification-1" });
    const deliveryCreate = jest.fn().mockResolvedValue({});
    const outboxCreate = jest.fn().mockResolvedValue({});
    const auditCreate = jest.fn().mockResolvedValue({});
    const transaction = {
      communicationMessage: { create: messageCreate },
      notification: { create: notificationCreate },
      notificationDelivery: { create: deliveryCreate },
      outboxEvent: { create: outboxCreate },
      auditEvent: { create: auditCreate },
    };
    const service = new CommunicationsService({
      schoolMembership: {
        findFirst: jest.fn().mockImplementation(({ where }: { where: { userId: string } }) => ({
          membershipRoles: [
            schoolMembershipRole(where.userId === "parent-1" ? "PARENT" : "TEACHER"),
          ],
        })),
      },
      pupilContact: {
        findFirst: jest.fn().mockResolvedValue({
          guardian: { person: { userId: "parent-1" } },
        }),
      },
      pupilProfile: { findFirst: jest.fn().mockResolvedValue({ id: "pupil-1" }) },
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService, unusedStorage);

    await expect(service.createMessage("school-1", "staff-1", {
      pupilId: "pupil-1",
      recipientUserId: "parent-1",
      subject: "Trip update",
      body: "The trip return time has changed.",
    })).resolves.toMatchObject({ id: "message-1" });
    expect(notificationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        recipientUserId: "parent-1",
        messageId: "message-1",
      }),
    }));
    expect(deliveryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ idempotencyKey: "email:notification-1" }),
    }));
    expect(outboxCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: "notification.email",
        idempotencyKey: "notification-email:notification-1",
      }),
    }));
    expect(auditCreate).toHaveBeenCalled();
  });

  it("retries notification delivery jobs using the database claim and SMTP worker", async () => {
    const envKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_FROM", "SMTP_USER", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_ENCRYPTION"] as const;
    const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_SECURE = "false";
    process.env.SMTP_FROM = "School <school@example.test>";
    delete process.env.SMTP_USER;
    delete process.env.SMTP_USERNAME;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_ENCRYPTION;
    const sendMail = jest.fn().mockResolvedValue({});
    const createTransport = jest.spyOn(nodemailer, "createTransport").mockReturnValue({
      sendMail,
    } as unknown as ReturnType<typeof nodemailer.createTransport>);
    const queryRaw = jest.fn().mockResolvedValue([{
      id: "outbox-1",
      school_id: "school-1",
      aggregate_id: "notification-1",
      attempts: 0,
    }]);
    const executeRaw = jest.fn().mockResolvedValue(1);
    const notificationFindFirst = jest.fn().mockResolvedValue({
      title: "Trip update",
      body: "You have received a new school message.",
      recipient: { emailNormalized: "parent@example.test", status: "active" },
      message: { body: "Updated arrival at 18:30." },
      delivery: { status: "queued" },
    });
    const deliveryUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const outboxUpdate = jest.fn().mockResolvedValue({});
    const tx = { $queryRaw: queryRaw, $executeRaw: executeRaw };
    const prisma = {
      $transaction: jest.fn(async (input) => {
        if (typeof input === "function") return input(tx);
        return Promise.all(input);
      }),
      notification: { findFirst: notificationFindFirst },
      notificationDelivery: { updateMany: deliveryUpdate },
      outboxEvent: { update: outboxUpdate },
    } as unknown as PrismaService;
    const service = new CommunicationsService(prisma, unusedStorage);

    try {
      await expect(service.processNotificationOutboxBatch()).resolves.toBe(1);
      expect(queryRaw).toHaveBeenCalled();
      expect(executeRaw).toHaveBeenCalled();
      expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
        to: "parent@example.test",
        subject: "Trip update",
        text: expect.stringContaining("Sign in to your school portal"),
      }));
      expect(deliveryUpdate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: "sent" }),
      }));
      expect(outboxUpdate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ processedAt: expect.any(Date), lockedAt: null }),
      }));
    } finally {
      createTransport.mockRestore();
      for (const key of envKeys) {
        const value = originalEnv[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it.each([
    { attempts: 0, expectedStatus: "queued", deadLettered: false },
    { attempts: 4, expectedStatus: "failed", deadLettered: true },
  ])("backs off or dead-letters a failed email job at attempt $attempts", async ({
    attempts,
    expectedStatus,
    deadLettered,
  }) => {
    const queryRaw = jest.fn().mockResolvedValue([{
      id: "outbox-1",
      school_id: "school-1",
      aggregate_id: "notification-1",
      attempts,
    }]);
    const deliveryUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const outboxUpdate = jest.fn().mockResolvedValue({});
    const tx = { $queryRaw: queryRaw, $executeRaw: jest.fn().mockResolvedValue(1) };
    const prisma = {
      $transaction: jest.fn(async (input) => {
        if (typeof input === "function") return input(tx);
        return Promise.all(input);
      }),
      notification: { findFirst: jest.fn().mockRejectedValue(new Error("private provider response")) },
      notificationDelivery: { updateMany: deliveryUpdate },
      outboxEvent: { update: outboxUpdate },
    } as unknown as PrismaService;
    const service = new CommunicationsService(prisma, unusedStorage);
    const retryStartedAt = Date.now();

    await expect(service.processNotificationOutboxBatch()).resolves.toBe(1);

    expect(deliveryUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: expectedStatus, lastError: "Error" },
    }));
    const outboxData = outboxUpdate.mock.calls[0][0].data;
    expect(outboxData.lockedAt).toBeNull();
    expect(outboxData.lastError).toBe("Error");
    if (deadLettered) {
      expect(outboxData.deadLetteredAt).toBeInstanceOf(Date);
    } else {
      expect(outboxData.deadLetteredAt).toBeNull();
      expect(outboxData.availableAt.getTime()).toBeGreaterThanOrEqual(retryStartedAt + 2_000);
      expect(outboxData.availableAt.getTime()).toBeLessThanOrEqual(Date.now() + 2_000);
    }
  });

  it("restricts failed notification retries to operations roles", async () => {
    const auditCreate = jest.fn().mockResolvedValue({});
    const transaction = jest.fn();
    const service = new CommunicationsService({
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({
          membershipRoles: [schoolMembershipRole("TEACHER")],
        }),
      },
      auditEvent: { create: auditCreate },
      $transaction: transaction,
    } as unknown as PrismaService, unusedStorage);

    await expect(service.retryNotification("school-1", "teacher-1", "notification-1"))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "notifications.retry.access_denied" }),
    }));
    expect(transaction).not.toHaveBeenCalled();
  });

  it("requeues a dead-lettered notification and audits the operations action", async () => {
    const outboxUpdate = jest.fn().mockResolvedValue({});
    const deliveryUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const auditCreate = jest.fn().mockResolvedValue({});
    const transaction = {
      outboxEvent: {
        findFirst: jest.fn().mockResolvedValue({ id: "outbox-1", deadLetteredAt: new Date() }),
        update: outboxUpdate,
      },
      notificationDelivery: {
        findFirst: jest.fn().mockResolvedValue({ status: "failed" }),
        updateMany: deliveryUpdate,
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

    await expect(new CommunicationsService(prisma, unusedStorage)
      .retryNotification("school-1", "admin-1", "notification-1"))
      .resolves.toEqual({ notificationId: "notification-1", status: "queued" });
    expect(outboxUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        processedAt: null,
        lockedAt: null,
        deadLetteredAt: null,
        attempts: 0,
      }),
    }));
    expect(deliveryUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "queued", sentAt: null, lastError: null },
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "notification.delivery.retried" }),
    }));
  });
});
