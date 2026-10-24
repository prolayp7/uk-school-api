import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsIn,
  Matches,
  Max,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
  ValidateNested,
} from "class-validator";

export class ListSendPupilsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CreateSendTargetDto {
  @IsString()
  @MaxLength(160)
  title!: string;

  @IsString()
  @MaxLength(4000)
  description!: string;

  @IsString()
  @MaxLength(500)
  successCriteria!: string;

  @IsDateString({ strict: true })
  startsOn!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  reviewDue?: string;

  @IsOptional()
  @IsBoolean()
  parentVisible?: boolean;
}

export class CreateSendInterventionDto {
  @IsString()
  @MaxLength(40)
  interventionType!: string;

  @IsString()
  @MaxLength(4000)
  description!: string;

  @IsDateString({ strict: true })
  startsOn!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  endsOn?: string;
}

export class CreateProvisionRecordDto {
  @IsString()
  @MaxLength(40)
  provisionType!: string;

  @IsString()
  @MaxLength(4000)
  description!: string;

  @IsString()
  @MaxLength(80)
  frequency!: string;

  @IsDateString({ strict: true })
  startsOn!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  endsOn?: string;
}

export class CreateSupportPlanDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsString()
  @MaxLength(10000)
  summary!: string;

  @IsDateString({ strict: true })
  startsOn!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  endsOn?: string;

  @IsOptional()
  @IsBoolean()
  parentVisible?: boolean;

  @IsOptional()
  @IsIn(["sen_support", "ehcp", "monitoring", "no_additional_needs"])
  senStatus?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  primaryNeed?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  supportLevel?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  reviewDue?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => CreateSendTargetDto)
  targets?: CreateSendTargetDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CreateSendInterventionDto)
  interventions?: CreateSendInterventionDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CreateProvisionRecordDto)
  provisions?: CreateProvisionRecordDto[];
}

export class CreateSendTargetReviewDto {
  @IsUUID()
  targetId!: string;

  @IsIn(["achieved", "on_track", "partially_met", "not_met"])
  outcome!: string;

  @IsString()
  @MaxLength(4000)
  note!: string;

  @IsOptional()
  @IsDateString()
  reviewedAt?: string;
}

export class CreateMedicationDto {
  @IsString()
  @MaxLength(32)
  code!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  strength?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  form?: string;
}

export class CreateMedicalConditionDto {
  @IsString()
  @MaxLength(32)
  code!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsString()
  @MaxLength(24)
  category!: string;
}

export class AddPupilMedicalConditionDto {
  @IsUUID()
  conditionId!: string;

  @IsIn(["mild", "moderate", "severe", "critical"])
  severity!: string;

  @IsString()
  @MaxLength(240)
  careNote!: string;

  @IsDateString({ strict: true })
  startsOn!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  endsOn?: string;

  @IsOptional()
  @IsBoolean()
  parentVisible?: boolean;
}

export class CreateMedicationAuthorizationDto {
  @IsUUID()
  medicationId!: string;

  @IsUUID()
  guardianPersonId!: string;

  @IsString()
  @MaxLength(500)
  dosageInstructions!: string;

  @IsDateString({ strict: true })
  startsOn!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  endsOn?: string;
}

export class CreateMedicationAdministrationDto {
  @IsUUID()
  authorizationId!: string;

  @IsDateString()
  administeredAt!: string;

  @IsString()
  @MaxLength(120)
  doseGiven!: string;

  @IsIn(["administered", "refused", "not_available"])
  status!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsUUID()
  scheduleId?: string;

  @IsOptional()
  @IsUUID()
  correctionOfId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  correctionReason?: string;
}

export class CreateMedicationScheduleDto {
  @IsUUID()
  authorizationId!: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  scheduledTime!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  daysOfWeek!: number[];

  @IsString()
  @MaxLength(120)
  doseInstructions!: string;

  @IsDateString({ strict: true })
  startsOn!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  endsOn?: string;
}

export class CreateHealthcarePlanDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsString()
  @MaxLength(10000)
  instructions!: string;

  @IsString()
  @MaxLength(10000)
  emergencyActions!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  emergencyLocation?: string;

  @IsDateString({ strict: true })
  startsOn!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  reviewDue?: string;
}

export class CreateMedicalIncidentDto {
  @IsString()
  @MaxLength(32)
  incidentType!: string;

  @IsString()
  @MaxLength(10000)
  details!: string;

  @IsString()
  @MaxLength(10000)
  actionTaken!: string;

  @IsOptional()
  @IsBoolean()
  followUpRequired?: boolean;

  @IsDateString()
  occurredAt!: string;
}
