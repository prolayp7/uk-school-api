import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { basename, extname } from "node:path";
import { Prisma } from "@prisma/client";
import { hasAnySchoolPermission, requireAnySchoolPermission } from "../auth/school-permissions";
import { FileStorageService } from "../common/file-storage.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  CalendarEventsQueryDto,
  CommunicationMessagesQueryDto,
  CreateCalendarEventDto,
  CreateCommunicationMessageDto,
  CreateDocumentUploadRequestDto,
  ParentMessagesQueryDto,
} from "./communications.dto";

const STAFF_ROLES = [
  "SUPER_ADMIN", "HEADTEACHER", "SLT", "ADMIN", "TEACHER", "DSL", "DEPUTY_DSL",
  "SAFEGUARDING", "SENCO", "DEPUTY_SENCO", "FINANCE", "MEDICAL", "ATTENDANCE_OFFICER",
  "ADMISSIONS_OFFICER", "EXAMS_OFFICER", "SUPPORT_STAFF",
];
const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const DOCUMENT_UPLOAD_LIFETIME_MS = 15 * 60 * 1000;
const DOCUMENT_DOWNLOAD_LIFETIME_MS = 5 * 60 * 1000;
const DOCUMENT_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".txt", ".docx"]);
const EMAIL_OUTBOX_EVENT = "notification.email";
const OUTBOX_MAX_ATTEMPTS = 5;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function activeOn(date = new Date()): Date {
  return new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function dateValue(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new BadRequestException("Invalid calendar date range.");
  return date;
}

@Injectable()
export class CommunicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorageService,
  ) {}

  private async roleCodes(schoolId: string, userId: string): Promise<string[]> {
    const membership = await this.prisma.schoolMembership.findFirst({
      where: { schoolId, userId, status: "active" },
      select: { membershipRoles: { select: { role: { select: { code: true } } } } },
    });
    return membership?.membershipRoles.map(({ role }) => role.code) ?? [];
  }

  private async requireRoles(
    schoolId: string,
    userId: string,
    permissionCode: string,
    action: string,
  ): Promise<string[]> {
    const roles = await this.roleCodes(schoolId, userId);
    try {
      await requireAnySchoolPermission(this.prisma, schoolId, userId, [permissionCode]);
    } catch (error) {
      if (!(error instanceof ForbiddenException)) throw error;
      await this.prisma.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: `${action}.access_denied`,
          entityType: "communications",
          metadata: { reason: "school_permission_required", permissionCode },
        },
      });
      throw error;
    }
    return roles;
  }

  private async activeParentContact(schoolId: string, userId: string, pupilId: string) {
    const today = activeOn();
    return this.prisma.pupilContact.findFirst({
      where: {
        schoolId,
        pupilId,
        canViewPortal: true,
        startsOn: { lte: today },
        OR: [{ endsOn: null }, { endsOn: { gte: today } }],
        guardian: { person: { userId } },
      },
      select: { pupilId: true },
    });
  }

  async listStaffCalendarEvents(
    schoolId: string,
    userId: string,
    query: CalendarEventsQueryDto,
  ) {
    await this.requireRoles(schoolId, userId, "calendar.read", "calendar.events.list");
    const now = new Date();
    const from = dateValue(query.from, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
    const to = dateValue(query.to, new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000));
    if (to <= from) throw new BadRequestException("Calendar end must be after its start.");
    const events = await this.prisma.calendarEvent.findMany({
      where: {
        schoolId,
        startsAt: { lt: to },
        endsAt: { gte: from },
        ...(query.pupilId ? { pupilId: query.pupilId } : {}),
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        title: true,
        description: true,
        location: true,
        audience: true,
        pupilId: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        schoolId,
        actorUserId: userId,
        action: "calendar.events.viewed",
        entityType: "calendar_event",
        metadata: { resultCount: events.length },
      },
    });
    return { items: events, total: events.length };
  }

  async createCalendarEvent(schoolId: string, userId: string, input: CreateCalendarEventDto) {
    await this.requireRoles(schoolId, userId, "calendar.manage", "calendar.events.create");
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
      throw new BadRequestException("Calendar event end must be after its start.");
    }
    if (
      input.audience === "public" &&
      !(await hasAnySchoolPermission(this.prisma, schoolId, userId, ["calendar.publish"]))
    ) {
      throw new ForbiddenException("Only school leadership can publish public calendar events.");
    }
    if (input.pupilId) {
      const pupil = await this.prisma.pupilProfile.findFirst({
        where: { schoolId, id: input.pupilId },
        select: { id: true },
      });
      if (!pupil) throw new NotFoundException("Pupil not found in this school.");
    }

    return this.prisma.$transaction(async (transaction) => {
      const event = await transaction.calendarEvent.create({
        data: {
          schoolId,
          createdById: userId,
          pupilId: input.pupilId ?? null,
          title: input.title.trim(),
          description: input.description?.trim() || null,
          location: input.location?.trim() || null,
          audience: input.audience,
          startsAt,
          endsAt,
          allDay: input.allDay ?? false,
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "calendar.event.created",
          entityType: "calendar_event",
          entityId: event.id,
          metadata: { audience: event.audience, pupilScoped: Boolean(event.pupilId) },
        },
      });
      return event;
    });
  }

  async listParentCalendarEvents(userId: string, query: CalendarEventsQueryDto) {
    const memberships = await this.prisma.schoolMembership.findMany({
      where: {
        userId,
        status: "active",
        membershipRoles: { some: { role: { code: "PARENT" } } },
      },
      select: { schoolId: true },
    });
    const schoolIds = memberships.map(({ schoolId }) => schoolId);
    if (schoolIds.length === 0) {
      throw new ForbiddenException("Parent membership is required to view the school calendar.");
    }
    const today = activeOn();
    const contacts = await this.prisma.pupilContact.findMany({
      where: {
        schoolId: { in: schoolIds },
        canViewPortal: true,
        startsOn: { lte: today },
        OR: [{ endsOn: null }, { endsOn: { gte: today } }],
        guardian: { person: { userId } },
      },
      select: { schoolId: true, pupilId: true },
    });
    const allowedPupilIds = contacts.map(({ pupilId }) => pupilId);
    if (query.pupilId && !allowedPupilIds.includes(query.pupilId)) {
      throw new ForbiddenException("You do not have calendar access to this pupil.");
    }
    const selectedPupilIds = query.pupilId ? [query.pupilId] : allowedPupilIds;
    const now = new Date();
    const from = dateValue(query.from, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
    const to = dateValue(query.to, new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000));
    if (to <= from) throw new BadRequestException("Calendar end must be after its start.");
    const events = await this.prisma.calendarEvent.findMany({
      where: {
        schoolId: { in: schoolIds },
        audience: { in: ["parent", "public"] },
        startsAt: { lt: to },
        endsAt: { gte: from },
        OR: [{ pupilId: null }, { pupilId: { in: selectedPupilIds } }],
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        schoolId: true,
        title: true,
        description: true,
        location: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: "parent.calendar.events.viewed",
        entityType: "calendar_event",
        metadata: { resultCount: events.length, schoolCount: schoolIds.length },
      },
    });
    return { items: events, total: events.length };
  }

  async listStudentCalendarEvents(userId: string, query: CalendarEventsQueryDto) {
    const memberships = await this.prisma.schoolMembership.findMany({
      where: {
        userId,
        status: "active",
        membershipRoles: { some: { role: { code: "STUDENT" } } },
      },
      select: { schoolId: true },
    });
    const schoolIds = memberships.map(({ schoolId }) => schoolId);
    if (schoolIds.length === 0) {
      throw new ForbiddenException("Student membership is required to view the school calendar.");
    }
    const pupils = await this.prisma.pupilProfile.findMany({
      where: { schoolId: { in: schoolIds }, person: { userId } },
      select: { schoolId: true, id: true },
    });
    if (pupils.length === 0) throw new ForbiddenException("Student pupil profile is required to view the calendar.");
    if (query.pupilId && !pupils.some(({ id }) => id === query.pupilId)) {
      throw new ForbiddenException("You do not have calendar access to this pupil.");
    }
    const pupilIds = query.pupilId ? [query.pupilId] : pupils.map(({ id }) => id);
    const now = new Date();
    const from = dateValue(query.from, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
    const to = dateValue(query.to, new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000));
    if (to <= from) throw new BadRequestException("Calendar end must be after its start.");
    const events = await this.prisma.calendarEvent.findMany({
      where: {
        schoolId: { in: schoolIds },
        audience: { in: ["student", "public"] },
        startsAt: { lt: to },
        endsAt: { gte: from },
        OR: [{ pupilId: null }, { pupilId: { in: pupilIds } }],
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        schoolId: true,
        title: true,
        description: true,
        location: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: "student.calendar.events.viewed",
        entityType: "calendar_event",
        metadata: { resultCount: events.length, schoolCount: schoolIds.length },
      },
    });
    return { items: events, total: events.length };
  }

  async createDocumentUploadRequest(
    schoolId: string,
    userId: string,
    input: CreateDocumentUploadRequestDto,
  ) {
    await this.requireRoles(schoolId, userId, "documents.manage", "documents.upload_request");
    const audience = input.audience ?? "staff";
    const originalFilename = basename(input.originalFilename.replaceAll("\\", "/"));
    if (!originalFilename || originalFilename.length > 255 || /\p{Cc}/u.test(originalFilename)) {
      throw new BadRequestException("A valid document filename is required.");
    }
    const contentType = input.contentType.toLowerCase().split(";")[0].trim();
    if (!DOCUMENT_CONTENT_TYPES.has(contentType) || !DOCUMENT_EXTENSIONS.has(extname(originalFilename).toLowerCase())) {
      throw new BadRequestException("This document type is not allowed.");
    }
    if (input.byteSize > DOCUMENT_MAX_BYTES) {
      throw new BadRequestException("Documents must not exceed 10 MiB.");
    }
    if (audience !== "staff" && !input.pupilId) {
      throw new BadRequestException("Parent- or student-visible documents must be linked to a pupil.");
    }
    if (input.pupilId) {
      const pupil = await this.prisma.pupilProfile.findFirst({
        where: { schoolId, id: input.pupilId },
        select: { id: true },
      });
      if (!pupil) throw new NotFoundException("Pupil not found in this school.");
    }
    const uploadExpiresAt = new Date(Date.now() + DOCUMENT_UPLOAD_LIFETIME_MS);
    const document = await this.prisma.schoolDocument.create({
      data: {
        schoolId,
        pupilId: input.pupilId ?? null,
        uploadedById: userId,
        title: input.title.trim(),
        originalFilename,
        contentType,
        byteSize: input.byteSize,
        audience,
        uploadExpiresAt,
      },
      select: { id: true, status: true, uploadExpiresAt: true },
    });
    await this.prisma.auditEvent.create({
      data: {
        schoolId,
        actorUserId: userId,
        action: "document.upload.requested",
        entityType: "school_document",
        entityId: document.id,
        metadata: { contentType, byteSize: input.byteSize, audience },
      },
    });
    return {
      ...document,
      uploadUrl: `/api/v1/erp/documents/${document.id}/content`,
      method: "PUT",
      requiredHeaders: { "content-type": contentType },
    };
  }

  async uploadDocument(
    schoolId: string,
    userId: string,
    documentId: string,
    contents: Buffer,
    contentType: string,
  ) {
    await this.requireRoles(schoolId, userId, "documents.manage", "documents.upload");
    if (!contents?.length || contents.length > DOCUMENT_MAX_BYTES) {
      throw new BadRequestException("Document content must be between 1 byte and 10 MiB.");
    }
    const document = await this.prisma.schoolDocument.findFirst({
      where: {
        schoolId,
        id: documentId,
        uploadedById: userId,
        status: "upload_pending",
        uploadExpiresAt: { gt: new Date() },
      },
      select: { id: true, originalFilename: true, contentType: true, byteSize: true },
    });
    if (!document) throw new NotFoundException("Upload request was not found or has expired.");
    if (contents.length !== document.byteSize || contentType.toLowerCase() !== document.contentType) {
      throw new BadRequestException("Uploaded content does not match the requested size and content type.");
    }
    const storageKey = await this.storage.saveFile("documents", document.originalFilename, contents);
    try {
      const [updated] = await this.prisma.$transaction([
        this.prisma.schoolDocument.update({
          where: { id: document.id },
          data: { storageKey, status: "ready" },
          select: { id: true, status: true, byteSize: true },
        }),
        this.prisma.auditEvent.create({
          data: {
            schoolId,
            actorUserId: userId,
            action: "document.upload.completed",
            entityType: "school_document",
            entityId: document.id,
            metadata: { byteSize: contents.length, sha256: sha256(contents) },
          },
        }),
      ]);
      return updated;
    } catch (error) {
      await this.storage.deleteFile(storageKey);
      throw error;
    }
  }

  async listPupilDocuments(schoolId: string, userId: string, pupilId: string) {
    const roles = await this.roleCodes(schoolId, userId);
    const staff =
      roles.some((role) => !["PARENT", "STUDENT"].includes(role)) &&
      (await hasAnySchoolPermission(this.prisma, schoolId, userId, ["documents.read"]));
    const parent = roles.includes("PARENT")
      ? await this.activeParentContact(schoolId, userId, pupilId)
      : null;
    const student = roles.includes("STUDENT")
      ? await this.prisma.pupilProfile.findFirst({
          where: { schoolId, id: pupilId, person: { userId } },
          select: { id: true },
        })
      : null;
    if (!staff && !parent && !student) {
      throw new ForbiddenException("You do not have document access to this pupil.");
    }
    const audience = staff ? ["staff", "parent", "student"] : parent ? ["parent"] : ["student"];
    const documents = await this.prisma.schoolDocument.findMany({
      where: { schoolId, pupilId, audience: { in: audience }, status: "ready" },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, originalFilename: true, contentType: true, byteSize: true, createdAt: true },
    });
    await this.prisma.auditEvent.create({
      data: {
        schoolId,
        actorUserId: userId,
        action: "documents.pupil.listed",
        entityType: "pupil_profile",
        entityId: pupilId,
        metadata: { resultCount: documents.length },
      },
    });
    return { items: documents, total: documents.length };
  }

  async issueDocumentDownload(schoolId: string, userId: string, documentId: string) {
    const document = await this.prisma.schoolDocument.findFirst({
      where: { schoolId, id: documentId, status: "ready", storageKey: { not: null } },
      select: { id: true, pupilId: true, audience: true, storageKey: true, originalFilename: true },
    });
    if (!document) throw new NotFoundException("Document not found.");
    const roles = await this.roleCodes(schoolId, userId);
    const staff =
      roles.some((role) => !["PARENT", "STUDENT"].includes(role)) &&
      (await hasAnySchoolPermission(this.prisma, schoolId, userId, ["documents.read"]));
    const parent = document.pupilId && roles.includes("PARENT") && document.audience === "parent"
      ? await this.activeParentContact(schoolId, userId, document.pupilId)
      : null;
    const student = document.pupilId && roles.includes("STUDENT") && document.audience === "student"
      ? await this.prisma.pupilProfile.findFirst({
          where: { schoolId, id: document.pupilId, person: { userId } },
          select: { id: true },
        })
      : null;
    if (!staff && !parent && !student) {
      throw new ForbiddenException("You are not permitted to download this document.");
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + DOCUMENT_DOWNLOAD_LIFETIME_MS);
    await this.prisma.$transaction([
      this.prisma.documentDownloadGrant.create({
        data: { schoolId, documentId, tokenHash: sha256(token), expiresAt },
      }),
      this.prisma.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "document.download_link.issued",
          entityType: "school_document",
          entityId: documentId,
          metadata: { expiresAt: expiresAt.toISOString() },
        },
      }),
    ]);
    return {
      downloadUrl: `/api/v1/erp/documents/download/${token}`,
      expiresAt: expiresAt.toISOString(),
      filename: document.originalFilename,
    };
  }

  async downloadWithGrant(token: string) {
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) throw new NotFoundException("Download link is invalid or expired.");
    const grant = await this.prisma.documentDownloadGrant.findFirst({
      where: { tokenHash: sha256(token), expiresAt: { gt: new Date() } },
      select: {
        schoolId: true,
        document: {
          select: { storageKey: true, originalFilename: true, contentType: true, status: true },
        },
      },
    });
    if (!grant || grant.document.status !== "ready" || !grant.document.storageKey) {
      throw new NotFoundException("Download link is invalid or expired.");
    }
    const contents = await this.storage.readFile(grant.document.storageKey);
    return {
      contents,
      filename: grant.document.originalFilename,
      contentType: grant.document.contentType,
    };
  }

  async createMessage(schoolId: string, userId: string, input: CreateCommunicationMessageDto) {
    if (input.recipientUserId === userId) throw new BadRequestException("A message recipient must be another user.");
    const roles = await this.roleCodes(schoolId, userId);
    const senderCanManageMessages = await hasAnySchoolPermission(
      this.prisma,
      schoolId,
      userId,
      ["communications.manage"],
    );
    const today = activeOn();
    const link = await this.prisma.pupilContact.findFirst({
      where: {
        schoolId,
        pupilId: input.pupilId,
        canViewPortal: true,
        startsOn: { lte: today },
        OR: [{ endsOn: null }, { endsOn: { gte: today } }],
        guardian: { person: { userId: input.recipientUserId } },
      },
      select: { guardianPersonId: true, guardian: { select: { person: { select: { userId: true } } } } },
    });
    const recipientRoles = await this.roleCodes(schoolId, input.recipientUserId);
    const recipientCanReadMessages = await hasAnySchoolPermission(
      this.prisma,
      schoolId,
      input.recipientUserId,
      ["communications.read"],
    );
    const recipientIsLinkedParent =
      Boolean(link?.guardian.person.userId) && recipientRoles.includes("PARENT");
    const senderIsParent = roles.includes("PARENT") &&
      Boolean(await this.activeParentContact(schoolId, userId, input.pupilId));
    const senderIsStaff =
      roles.some((role) => STAFF_ROLES.includes(role)) && senderCanManageMessages;
    if (senderIsStaff) {
      if (!recipientIsLinkedParent) {
        throw new ForbiddenException("Messages to parents require an active portal-enabled pupil relationship.");
      }
    } else if (senderIsParent) {
      if (
        !recipientRoles.some((role) => STAFF_ROLES.includes(role)) ||
        !recipientCanReadMessages
      ) {
        throw new ForbiddenException("Parents may message only active staff at this school.");
      }
    } else {
      throw new ForbiddenException("A valid staff role or active parent relationship is required to message.");
    }

    const pupil = await this.prisma.pupilProfile.findFirst({
      where: { schoolId, id: input.pupilId },
      select: { id: true },
    });
    if (!pupil) throw new NotFoundException("Pupil not found in this school.");

    return this.prisma.$transaction(async (transaction) => {
      const message = await transaction.communicationMessage.create({
        data: {
          schoolId,
          pupilId: input.pupilId,
          senderUserId: userId,
          recipientUserId: input.recipientUserId,
          subject: input.subject.trim(),
          body: input.body.trim(),
        },
        select: { id: true, pupilId: true, senderUserId: true, recipientUserId: true, subject: true, body: true, createdAt: true },
      });
      const notification = await transaction.notification.create({
        data: {
          schoolId,
          recipientUserId: input.recipientUserId,
          messageId: message.id,
          title: message.subject,
          body: "You have received a new school message.",
        },
        select: { id: true },
      });
      await transaction.notificationDelivery.create({
        data: {
          schoolId,
          notificationId: notification.id,
          idempotencyKey: `email:${notification.id}`,
        },
      });
      await transaction.outboxEvent.create({
        data: {
          schoolId,
          eventType: EMAIL_OUTBOX_EVENT,
          aggregateType: "notification",
          aggregateId: notification.id,
          idempotencyKey: `notification-email:${notification.id}`,
          payload: { notificationId: notification.id },
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "communication.message.sent",
          entityType: "communication_message",
          entityId: message.id,
          metadata: { pupilId: input.pupilId, recipientUserId: input.recipientUserId },
        },
      });
      return message;
    });
  }

  async listStaffMessages(schoolId: string, userId: string, query: CommunicationMessagesQueryDto) {
    await this.requireRoles(schoolId, userId, "communications.read", "communications.messages.list");
    const pupil = await this.prisma.pupilProfile.findFirst({
      where: { schoolId, id: query.pupilId },
      select: { id: true },
    });
    if (!pupil) throw new NotFoundException("Pupil not found in this school.");
    const items = await this.prisma.communicationMessage.findMany({
      where: { schoolId, pupilId: query.pupilId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        subject: true,
        body: true,
        createdAt: true,
        senderUserId: true,
        recipientUserId: true,
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        schoolId,
        actorUserId: userId,
        action: "communication.messages.viewed",
        entityType: "pupil_profile",
        entityId: query.pupilId,
        metadata: { resultCount: items.length },
      },
    });
    return { items, total: items.length };
  }

  async listParentMessages(userId: string, query: ParentMessagesQueryDto) {
    const memberships = await this.prisma.schoolMembership.findMany({
      where: {
        userId,
        status: "active",
        membershipRoles: { some: { role: { code: "PARENT" } } },
      },
      select: { schoolId: true },
    });
    const schoolIds = memberships.map(({ schoolId }) => schoolId);
    if (!schoolIds.length) throw new ForbiddenException("Parent membership is required to view messages.");
    const today = activeOn();
    const contacts = await this.prisma.pupilContact.findMany({
      where: {
        schoolId: { in: schoolIds },
        canViewPortal: true,
        startsOn: { lte: today },
        OR: [{ endsOn: null }, { endsOn: { gte: today } }],
        guardian: { person: { userId } },
        ...(query.pupilId ? { pupilId: query.pupilId } : {}),
      },
      select: { schoolId: true, pupilId: true },
    });
    if (query.pupilId && !contacts.some(({ pupilId }) => pupilId === query.pupilId)) {
      throw new ForbiddenException("You do not have message access to this pupil.");
    }
    const pupilIds = contacts.map(({ pupilId }) => pupilId);
    const items = await this.prisma.communicationMessage.findMany({
      where: {
        schoolId: { in: contacts.map(({ schoolId }) => schoolId) },
        pupilId: { in: pupilIds },
        OR: [{ senderUserId: userId }, { recipientUserId: userId }],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        pupilId: true,
        subject: true,
        body: true,
        createdAt: true,
        senderUserId: true,
        recipientUserId: true,
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: "parent.communication.messages.viewed",
        entityType: "communication_message",
        metadata: { resultCount: items.length },
      },
    });
    return { items, total: items.length };
  }

  async listNotifications(userId: string) {
    const items = await this.prisma.notification.findMany({
      where: { recipientUserId: userId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, schoolId: true, title: true, body: true, createdAt: true, readAt: true },
    });
    return { items, total: items.length };
  }

  async getNotificationJobMetrics(schoolId: string, userId: string) {
    await this.requireRoles(schoolId, userId, "notifications.manage", "notifications.jobs.view");
    const [pending, failed, oldest] = await Promise.all([
      this.prisma.outboxEvent.count({
        where: { schoolId, eventType: EMAIL_OUTBOX_EVENT, processedAt: null, deadLetteredAt: null },
      }),
      this.prisma.outboxEvent.count({
        where: { schoolId, eventType: EMAIL_OUTBOX_EVENT, deadLetteredAt: { not: null } },
      }),
      this.prisma.outboxEvent.findFirst({
        where: { schoolId, eventType: EMAIL_OUTBOX_EVENT, processedAt: null, deadLetteredAt: null },
        orderBy: { occurredAt: "asc" },
        select: { occurredAt: true },
      }),
    ]);
    return {
      pending,
      failed,
      oldestPendingAt: oldest?.occurredAt.toISOString() ?? null,
    };
  }

  async retryNotification(schoolId: string, userId: string, notificationId: string) {
    await this.requireRoles(schoolId, userId, "notifications.manage", "notifications.retry");
    return this.prisma.$transaction(async (transaction) => {
      const event = await transaction.outboxEvent.findFirst({
        where: {
          schoolId,
          aggregateType: "notification",
          aggregateId: notificationId,
          eventType: EMAIL_OUTBOX_EVENT,
        },
        select: { id: true, deadLetteredAt: true },
      });
      if (!event) throw new NotFoundException("Notification delivery job not found.");
      const delivery = await transaction.notificationDelivery.findFirst({
        where: { schoolId, notificationId },
        select: { status: true },
      });
      if (!delivery) throw new NotFoundException("Notification delivery record not found.");
      if (!event.deadLetteredAt || delivery.status !== "failed") {
        throw new ConflictException("Only a failed notification delivery can be retried.");
      }
      await transaction.outboxEvent.update({
        where: { id: event.id },
        data: {
          processedAt: null,
          availableAt: new Date(),
          lockedAt: null,
          deadLetteredAt: null,
          lastError: null,
          attempts: 0,
        },
      });
      await transaction.notificationDelivery.updateMany({
        where: { schoolId, notificationId },
        data: { status: "queued", sentAt: null, lastError: null },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "notification.delivery.retried",
          entityType: "notification",
          entityId: notificationId,
          metadata: {},
        },
      });
      return { notificationId, status: "queued" as const };
    });
  }

  async processNotificationOutboxBatch(batchSize = 20): Promise<number> {
    const events = await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.$queryRaw<Array<{
        id: string;
        school_id: string;
        aggregate_id: string;
        attempts: number;
      }>>(Prisma.sql`
        SELECT id, school_id, aggregate_id, attempts
        FROM outbox_events
        WHERE event_type = ${EMAIL_OUTBOX_EVENT}
          AND processed_at IS NULL
          AND dead_lettered_at IS NULL
          AND available_at <= NOW()
          AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '15 minutes')
          AND attempts < ${OUTBOX_MAX_ATTEMPTS}
        ORDER BY occurred_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `);
      for (const event of claimed) {
        await transaction.$executeRaw(Prisma.sql`
          UPDATE outbox_events
          SET locked_at = NOW(), attempts = attempts + 1
          WHERE id = ${event.id}::uuid
        `);
      }
      return claimed.map((event) => ({
        id: event.id,
        schoolId: event.school_id,
        notificationId: event.aggregate_id,
        attempt: event.attempts + 1,
      }));
    });
    for (const event of events) {
      try {
        await this.deliverNotification(event.schoolId, event.notificationId);
        await this.prisma.$transaction([
          this.prisma.notificationDelivery.updateMany({
            where: { schoolId: event.schoolId, notificationId: event.notificationId },
            data: { status: "sent", sentAt: new Date(), lastError: null },
          }),
          this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: { processedAt: new Date(), lockedAt: null, lastError: null },
          }),
        ]);
      } catch (error) {
        const deadLetter = event.attempt >= OUTBOX_MAX_ATTEMPTS;
        const retryDelayMs = Math.min(60 * 60 * 1000, 1000 * 2 ** event.attempt);
        const reason = error instanceof Error ? error.name.slice(0, 120) : "DeliveryError";
        await this.prisma.$transaction([
          this.prisma.notificationDelivery.updateMany({
            where: { schoolId: event.schoolId, notificationId: event.notificationId },
            data: { status: deadLetter ? "failed" : "queued", lastError: reason },
          }),
          this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
              lockedAt: null,
              availableAt: deadLetter ? new Date() : new Date(Date.now() + retryDelayMs),
              deadLetteredAt: deadLetter ? new Date() : null,
              lastError: reason,
            },
          }),
        ]);
      }
    }
    return events.length;
  }

  private async deliverNotification(schoolId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { schoolId, id: notificationId },
      select: {
        title: true,
        body: true,
        recipient: { select: { emailNormalized: true, status: true } },
        delivery: { select: { status: true } },
      },
    });
    if (!notification || !notification.delivery) throw new NotFoundException("Notification delivery record not found.");
    if (notification.delivery.status === "sent") return;
    if (notification.recipient.status !== "active") {
      throw new ForbiddenException("Notification recipient account is not active.");
    }
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT);
    const from = process.env.SMTP_FROM;
    if (!host || !port || !from) {
      throw new Error("Notification email delivery is not configured.");
    }
    const user = process.env.SMTP_USER || process.env.SMTP_USERNAME;
    const password = process.env.SMTP_PASSWORD;
    const encryption = process.env.SMTP_ENCRYPTION?.toLowerCase();
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.default.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === undefined
        ? port === 465 || ["ssl", "smtps", "implicit"].includes(encryption ?? "")
        : process.env.SMTP_SECURE === "true",
      ...(user && password ? { auth: { user, pass: password } } : {}),
    });
    await transporter.sendMail({
      from,
      to: notification.recipient.emailNormalized,
      subject: notification.title,
      text: `${notification.body}\n\nSign in to your school portal to view the message.`,
      messageId: `<${notificationId}@uk-school-api.local>`,
    });
  }
}
