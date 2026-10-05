import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from "class-validator";

export class CreateAttendanceSessionDto {
  @IsDateString({ strict: true })
  sessionDate!: string;

  @IsIn(["morning", "afternoon", "lesson"])
  sessionType!: "morning" | "afternoon" | "lesson";

  @IsOptional()
  @IsUUID()
  classGroupId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  lessonPeriod?: string;
}

export class AttendanceSessionsQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  date?: string;

  @IsOptional()
  @IsUUID()
  yearGroupId?: string;

  @IsOptional()
  @IsUUID()
  classGroupId?: string;
}

export class AttendanceMarkDto {
  @IsUUID()
  pupilId!: string;

  @IsString()
  @MaxLength(4)
  attendanceCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsIn(["not_required", "pending", "authorized", "unauthorized"])
  authorizationStatus?: "not_required" | "pending" | "authorized" | "unauthorized";
}

export class BulkAttendanceRecordsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => AttendanceMarkDto)
  records!: AttendanceMarkDto[];
}

export class CreateAttendanceInterventionDto {
  @IsDateString({ strict: true })
  startsOn!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  endsOn?: string;

  @IsString()
  @MaxLength(240)
  reason!: string;
}

export class AttendanceReportQueryDto {
  @IsOptional()
  @IsIn(["day", "week", "month"])
  period: "day" | "week" | "month" = "day";

  @IsOptional()
  @IsDateString({ strict: true })
  date?: string;

  @IsOptional()
  @IsUUID()
  classGroupId?: string;
}
