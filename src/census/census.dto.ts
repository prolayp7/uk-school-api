import { Type } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class CensusReadinessQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  censusDate?: string;
}

export class ListStaffComplianceQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class UpdateStaffComplianceDto {
  @IsIn(["not_started", "in_progress", "clear", "review_required"])
  dbsCheckStatus!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  identityVerifiedOn?: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  rightToWorkVerifiedOn?: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  dbsCheckedOn?: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  barredListCheckedOn?: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  prohibitionCheckedOn?: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  qualificationsVerifiedOn?: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  referencesVerifiedOn?: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  employmentHistoryVerifiedOn?: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  safeguardingTrainingCompletedOn?: string | null;
}
