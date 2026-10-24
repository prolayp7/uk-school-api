import { Type } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";

export const WEBSITE_CONTENT_TYPES = [
  "homepage",
  "page",
  "navigation",
  "news",
  "staff",
  "policy",
  "document",
  "admissions",
  "results",
  "school_information",
  "settings",
] as const;

export const WEBSITE_WORKFLOW_STATES = [
  "draft",
  "review",
  "approved",
  "scheduled",
  "published",
  "archived",
] as const;

export class WebsitePagesQueryDto {
  @IsOptional()
  @IsIn(WEBSITE_WORKFLOW_STATES)
  status?: string;

  @IsOptional()
  @IsIn(WEBSITE_CONTENT_TYPES)
  contentType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}

export class CreateWebsitePageDto {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsString()
  @Length(1, 180)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @IsIn(WEBSITE_CONTENT_TYPES)
  contentType!: string;

  @IsObject()
  content!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @Length(1, 320)
  seoDescription?: string;
}

export class CreateWebsitePageVersionDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(1, 180)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug?: string;

  @IsObject()
  content!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @Length(1, 320)
  seoDescription?: string;
}

export class ScheduleWebsitePageDto {
  @IsDateString()
  scheduledAt!: string;
}

export class PublicWebsiteQueryDto {
  @IsString()
  @Length(1, 32)
  @Matches(/^[A-Za-z0-9_-]+$/)
  schoolCode!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
