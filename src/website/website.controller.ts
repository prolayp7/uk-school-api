import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Headers,
  Header,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, SchoolAccessGuard, SuperAdminGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import {
  CreateWebsitePageDto,
  CreateWebsitePageVersionDto,
  PublicWebsiteQueryDto,
  ScheduleWebsitePageDto,
  WebsitePagesQueryDto,
} from "./website.dto";
import { WebsiteService } from "./website.service";

type AuthenticatedUser = { id: string; schoolIds: string[] };

function resolveSchoolId(user: AuthenticatedUser, requestedSchoolId?: string): string {
  if (requestedSchoolId) return requestedSchoolId;
  if (user.schoolIds.length === 1) return user.schoolIds[0];
  if (user.schoolIds.length > 1) {
    throw new BadRequestException("Select a school with the x-school-id header.");
  }
  throw new BadRequestException("An active school membership is required.");
}

@Controller("erp/website")
@UseGuards(AuthGuard, SuperAdminGuard, SchoolAccessGuard)
export class WebsiteCmsController {
  constructor(private readonly website: WebsiteService) {}

  @Get("pages")
  @Header("Cache-Control", "private, no-store")
  pages(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") requestedSchoolId: string | undefined,
    @Query() query: WebsitePagesQueryDto,
  ) {
    return this.website.listPages(resolveSchoolId(user, requestedSchoolId), user.id, query);
  }

  @Post("pages")
  @Header("Cache-Control", "private, no-store")
  createPage(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") requestedSchoolId: string | undefined,
    @Body() body: CreateWebsitePageDto,
  ) {
    return this.website.createPage(resolveSchoolId(user, requestedSchoolId), user.id, body);
  }

  @Post("pages/:pageId/versions")
  @Header("Cache-Control", "private, no-store")
  createVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") requestedSchoolId: string | undefined,
    @Param("pageId", ParseUUIDPipe) pageId: string,
    @Body() body: CreateWebsitePageVersionDto,
  ) {
    return this.website.createVersion(resolveSchoolId(user, requestedSchoolId), user.id, pageId, body);
  }

  @Get("pages/:pageId/versions")
  @Header("Cache-Control", "private, no-store")
  versions(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") requestedSchoolId: string | undefined,
    @Param("pageId", ParseUUIDPipe) pageId: string,
  ) {
    return this.website.listVersions(resolveSchoolId(user, requestedSchoolId), user.id, pageId);
  }

  @Post("pages/:pageId/versions/:versionNumber/review")
  @Header("Cache-Control", "private, no-store")
  submitForReview(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") requestedSchoolId: string | undefined,
    @Param("pageId", ParseUUIDPipe) pageId: string,
    @Param("versionNumber", ParseIntPipe) versionNumber: number,
  ) {
    return this.website.submitForReview(
      resolveSchoolId(user, requestedSchoolId),
      user.id,
      pageId,
      versionNumber,
    );
  }

  @Post("pages/:pageId/versions/:versionNumber/approve")
  @Header("Cache-Control", "private, no-store")
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") requestedSchoolId: string | undefined,
    @Param("pageId", ParseUUIDPipe) pageId: string,
    @Param("versionNumber", ParseIntPipe) versionNumber: number,
  ) {
    return this.website.approve(
      resolveSchoolId(user, requestedSchoolId),
      user.id,
      pageId,
      versionNumber,
    );
  }

  @Post("pages/:pageId/versions/:versionNumber/schedule")
  @Header("Cache-Control", "private, no-store")
  schedule(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") requestedSchoolId: string | undefined,
    @Param("pageId", ParseUUIDPipe) pageId: string,
    @Param("versionNumber", ParseIntPipe) versionNumber: number,
    @Body() body: ScheduleWebsitePageDto,
  ) {
    return this.website.schedule(
      resolveSchoolId(user, requestedSchoolId),
      user.id,
      pageId,
      versionNumber,
      body,
    );
  }

  @Post("pages/:pageId/publish")
  @Header("Cache-Control", "private, no-store")
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") requestedSchoolId: string | undefined,
    @Param("pageId", ParseUUIDPipe) pageId: string,
  ) {
    return this.website.publish(resolveSchoolId(user, requestedSchoolId), user.id, pageId);
  }

  @Post("pages/:pageId/unpublish")
  @Header("Cache-Control", "private, no-store")
  unpublish(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") requestedSchoolId: string | undefined,
    @Param("pageId", ParseUUIDPipe) pageId: string,
  ) {
    return this.website.unpublish(resolveSchoolId(user, requestedSchoolId), user.id, pageId);
  }

  @Post("pages/:pageId/archive")
  @Header("Cache-Control", "private, no-store")
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") requestedSchoolId: string | undefined,
    @Param("pageId", ParseUUIDPipe) pageId: string,
  ) {
    return this.website.archive(resolveSchoolId(user, requestedSchoolId), user.id, pageId);
  }

  @Post("pages/:pageId/revalidate")
  @Header("Cache-Control", "private, no-store")
  revalidate(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") requestedSchoolId: string | undefined,
    @Param("pageId", ParseUUIDPipe) pageId: string,
  ) {
    return this.website.revalidatePage(resolveSchoolId(user, requestedSchoolId), user.id, pageId);
  }
}

@Controller("website")
export class PublicWebsiteController {
  constructor(private readonly website: WebsiteService) {}

  @Get("homepage")
  @Header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  homepage(@Query() query: PublicWebsiteQueryDto) {
    return this.website.publicHomepage(query);
  }

  @Get("pages/:slug")
  @Header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  page(@Query() query: PublicWebsiteQueryDto, @Param("slug") slug: string) {
    return this.website.publicPage(query, slug);
  }

  @Get("navigation")
  @Header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  navigation(@Query() query: PublicWebsiteQueryDto) {
    return this.website.publicNavigation(query);
  }

  @Get("news")
  @Header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  news(@Query() query: PublicWebsiteQueryDto) {
    return this.website.publicNews(query);
  }

  @Get("events")
  @Header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  events(@Query() query: PublicWebsiteQueryDto) {
    return this.website.publicEvents(query);
  }

  @Get("staff")
  @Header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  staff(@Query() query: PublicWebsiteQueryDto) {
    return this.website.publicStaff(query);
  }

  @Get("policies")
  @Header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  policies(@Query() query: PublicWebsiteQueryDto) {
    return this.website.publicPolicies(query);
  }

  @Get("documents")
  @Header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  documents(@Query() query: PublicWebsiteQueryDto) {
    return this.website.publicDocuments(query);
  }

  @Get("admissions")
  @Header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  admissions(@Query() query: PublicWebsiteQueryDto) {
    return this.website.publicAdmissions(query);
  }

  @Get("results")
  @Header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  results(@Query() query: PublicWebsiteQueryDto) {
    return this.website.publicResults(query);
  }

  @Get("school-information")
  @Header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  schoolInformation(@Query() query: PublicWebsiteQueryDto) {
    return this.website.publicSchoolInformation(query);
  }
}
