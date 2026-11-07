import { Type } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsInt,
  IsArray,
  IsBoolean,
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
  "pathways",
  "timeline",
  "navigation",
  "news",
  "blog",
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
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/)
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
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/)
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

export class CreateWebsiteBlogDto {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsString()
  @Length(1, 180)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @IsObject()
  content!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @Length(0, 320)
  seoDescription?: string;
}

export class CreateWebsiteMenuDto {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsString()
  @Length(1, 180)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @IsIn(["header", "footer", "utility"])
  category!: string;

  @IsOptional()
  @IsIn(["simple", "dropdown", "mega", "columns"])
  style?: string;

  @IsOptional()
  @IsString()
  @Length(1, 2048)
  href?: string;

  @IsOptional()
  @IsBoolean()
  external?: boolean;

  @IsOptional()
  @IsArray()
  items?: Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  columns?: Record<string, unknown>[];

  @IsOptional()
  @IsString()
  @Length(1, 100)
  eyebrow?: string;

  @IsOptional()
  @IsObject()
  featuredCard?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
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

export class PublicWebsitePageQueryDto extends PublicWebsiteQueryDto {
  @IsString()
  @Length(1, 180)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/)
  slug!: string;
}
