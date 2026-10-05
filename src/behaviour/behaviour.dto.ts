import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class CreateBehaviourIncidentDto {
  @IsUUID()
  pupilId!: string;

  @IsIn(["minor", "late", "disruption", "detention", "other"])
  category!: string;

  @IsString()
  @MaxLength(120)
  title!: string;

  @IsString()
  @MaxLength(240)
  details!: string;

  @IsOptional()
  @IsInt()
  @Min(-20)
  @Max(0)
  points?: number;

  @IsOptional()
  @IsBoolean()
  parentVisible?: boolean;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

export class CreateBehaviourRewardDto {
  @IsUUID()
  pupilId!: string;

  @IsIn(["positive", "achievement", "reward", "other"])
  category!: string;

  @IsString()
  @MaxLength(120)
  title!: string;

  @IsString()
  @MaxLength(240)
  details!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  points?: number;

  @IsOptional()
  @IsBoolean()
  parentVisible?: boolean;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

export class CreateBehaviourSanctionDto {
  @IsIn(["warning", "detention", "suspension", "other"])
  sanctionType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  details?: string;

  @IsOptional()
  @IsBoolean()
  parentVisible?: boolean;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsDateString()
  detentionAt?: string;
}

export class CreateSafeguardingConcernDto {
  @IsUUID()
  pupilId!: string;

  @IsIn(["welfare", "physical_harm", "emotional_harm", "neglect", "bullying", "online_safety", "other"])
  category!: string;

  @IsString()
  @MaxLength(10000)
  details!: string;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

export class CreateSafeguardingActionDto {
  @IsIn(["contact", "review", "referral", "meeting", "other"])
  actionType!: string;

  @IsString()
  @MaxLength(10000)
  details!: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;
}

export class CreateSafeguardingMeetingDto {
  @IsIn(["internal", "parents", "multi_agency", "other"])
  meetingType!: string;

  @IsDateString()
  scheduledAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  details?: string;
}

export class GrantSafeguardingCaseAccessDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @MaxLength(240)
  reason!: string;
}

export class UpdateSafeguardingCaseStatusDto {
  @IsIn(["open", "under_review", "closed"])
  status!: "open" | "under_review" | "closed";
}
