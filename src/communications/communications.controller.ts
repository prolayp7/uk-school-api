import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import {
  CalendarEventsQueryDto,
  CommunicationMessagesQueryDto,
  CreateCalendarEventDto,
  CreateCommunicationMessageDto,
  CreateDocumentUploadRequestDto,
  ParentMessagesQueryDto,
} from "./communications.dto";
import { CommunicationsService } from "./communications.service";

type AuthenticatedUser = { id: string };
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

function resolveSchoolId(user: { schoolIds: string[] }, requestedSchoolId?: string): string {
  if (requestedSchoolId) return requestedSchoolId;
  if (user.schoolIds.length === 1) return user.schoolIds[0];
  if (user.schoolIds.length > 1) {
    throw new BadRequestException("Select a school with the x-school-id header.");
  }
  throw new BadRequestException("An active school membership is required.");
}

async function readDocumentBody(request: Request): Promise<Buffer> {
  const contentLength = Number(request.header("content-length") ?? 0);
  if (contentLength > MAX_DOCUMENT_BYTES) {
    throw new BadRequestException("Documents must not exceed 10 MiB.");
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_DOCUMENT_BYTES) {
      throw new BadRequestException("Documents must not exceed 10 MiB.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, length);
}

@Controller("erp")
@UseGuards(AuthGuard)
export class CommunicationsController {
  constructor(private readonly communications: CommunicationsService) {}

  @Get("calendar/events")
  listCalendarEvents(
    @CurrentUser() user: AuthenticatedUser & { schoolIds: string[] },
    @Headers("x-school-id") requestedSchoolId: string | undefined,
    @Query() query: CalendarEventsQueryDto,
  ) {
    return this.communications.listStaffCalendarEvents(
      resolveSchoolId(user, requestedSchoolId),
      user.id,
      query,
    );
  }

  @Post("calendar/events")
  createCalendarEvent(
    @CurrentUser() user: AuthenticatedUser & { schoolIds: string[] },
    @Headers("x-school-id") requestedSchoolId: string | undefined,
    @Body() body: CreateCalendarEventDto,
  ) {
    return this.communications.createCalendarEvent(
      resolveSchoolId(user, requestedSchoolId),
      user.id,
      body,
    );
  }

  @Post("documents/upload-requests")
  createDocumentUploadRequest(
    @CurrentUser() user: AuthenticatedUser & { schoolIds: string[] },
    @Headers("x-school-id") requestedSchoolId: string | undefined,
    @Body() body: CreateDocumentUploadRequestDto,
  ) {
    return this.communications.createDocumentUploadRequest(
      resolveSchoolId(user, requestedSchoolId),
      user.id,
      body,
    );
  }

  @Put("documents/:documentId/content")
  async uploadDocument(
    @CurrentUser() user: AuthenticatedUser & { schoolIds: string[] },
    @Headers("x-school-id") requestedSchoolId: string | undefined,
    @Headers("content-type") contentType: string | undefined,
    @Param("documentId", ParseUUIDPipe) documentId: string,
    @Req() request: Request,
  ) {
    if (!contentType || contentType.includes(";")) {
      throw new BadRequestException("Send the requested document content type without parameters.");
    }
    const contents = await readDocumentBody(request);
    return this.communications.uploadDocument(
      resolveSchoolId(user, requestedSchoolId),
      user.id,
      documentId,
      contents,
      contentType.toLowerCase(),
    );
  }

  @Get("pupils/:pupilId/documents")
  listPupilDocuments(
    @CurrentUser() user: AuthenticatedUser & { schoolIds: string[] },
    @Headers("x-school-id") requestedSchoolId: string | undefined,
    @Param("pupilId", ParseUUIDPipe) pupilId: string,
  ) {
    return this.communications.listPupilDocuments(
      resolveSchoolId(user, requestedSchoolId),
      user.id,
      pupilId,
    );
  }

  @Get("documents/:documentId/download")
  issueDocumentDownload(
    @CurrentUser() user: AuthenticatedUser & { schoolIds: string[] },
    @Headers("x-school-id") requestedSchoolId: string | undefined,
    @Param("documentId", ParseUUIDPipe) documentId: string,
  ) {
    return this.communications.issueDocumentDownload(
      resolveSchoolId(user, requestedSchoolId),
      user.id,
      documentId,
    );
  }

  @Get("communications/messages")
  listMessages(
    @CurrentUser() user: AuthenticatedUser & { schoolIds: string[] },
    @Headers("x-school-id") requestedSchoolId: string | undefined,
    @Query() query: CommunicationMessagesQueryDto,
  ) {
    return this.communications.listStaffMessages(
      resolveSchoolId(user, requestedSchoolId),
      user.id,
      query,
    );
  }

  @Post("communications/messages")
  createMessage(
    @CurrentUser() user: AuthenticatedUser & { schoolIds: string[] },
    @Headers("x-school-id") requestedSchoolId: string | undefined,
    @Body() body: CreateCommunicationMessageDto,
  ) {
    return this.communications.createMessage(
      resolveSchoolId(user, requestedSchoolId),
      user.id,
      body,
    );
  }

  @Get("notifications/jobs")
  getNotificationJobMetrics(
    @CurrentUser() user: AuthenticatedUser & { schoolIds: string[] },
    @Headers("x-school-id") requestedSchoolId: string | undefined,
  ) {
    return this.communications.getNotificationJobMetrics(
      resolveSchoolId(user, requestedSchoolId),
      user.id,
    );
  }

  @Post("notifications/:notificationId/retry")
  retryNotification(
    @CurrentUser() user: AuthenticatedUser & { schoolIds: string[] },
    @Headers("x-school-id") requestedSchoolId: string | undefined,
    @Param("notificationId", ParseUUIDPipe) notificationId: string,
  ) {
    return this.communications.retryNotification(
      resolveSchoolId(user, requestedSchoolId),
      user.id,
      notificationId,
    );
  }
}

@Controller("parent")
@UseGuards(AuthGuard)
export class ParentCommunicationsController {
  constructor(private readonly communications: CommunicationsService) {}

  @Get("calendar/events")
  calendarEvents(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CalendarEventsQueryDto,
  ) {
    return this.communications.listParentCalendarEvents(user.id, query);
  }

  @Get("messages")
  messages(@CurrentUser() user: AuthenticatedUser, @Query() query: ParentMessagesQueryDto) {
    return this.communications.listParentMessages(user.id, query);
  }

  @Get("notifications")
  notifications(@CurrentUser() user: AuthenticatedUser) {
    return this.communications.listNotifications(user.id);
  }
}

@Controller("student")
@UseGuards(AuthGuard)
export class StudentCommunicationsController {
  constructor(private readonly communications: CommunicationsService) {}

  @Get("calendar/events")
  calendarEvents(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CalendarEventsQueryDto,
  ) {
    return this.communications.listStudentCalendarEvents(user.id, query);
  }
}

@Controller("erp/documents")
export class DocumentDownloadController {
  constructor(private readonly communications: CommunicationsService) {}

  @Get("download/:token")
  async download(
    @Param("token") token: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.communications.downloadWithGrant(token);
    const safeFilename = file.filename.replace(/["\\\r\n]/g, "_");
    response.setHeader("Content-Type", file.contentType);
    response.setHeader("Content-Length", file.contents.length);
    response.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    response.setHeader("Cache-Control", "private, no-store, max-age=0");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.send(file.contents);
  }
}
