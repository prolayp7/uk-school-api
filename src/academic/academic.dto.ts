import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  Matches,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export class AcademicQueryDto {
  @IsOptional()
  @IsUUID()
  academicYearId?: string;
}

export class CreateCurriculumPlanDto {
  @IsUUID()
  academicYearId!: string;

  @IsUUID()
  yearGroupId!: string;

  @IsUUID()
  subjectId!: string;

  @IsString()
  @MaxLength(160)
  title!: string;

  @IsString()
  @MaxLength(10000)
  overview!: string;
}

export class CreateGradeBandDto {
  @IsString()
  @MaxLength(24)
  code!: string;

  @IsString()
  @MaxLength(80)
  label!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  minScore!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  maxScore!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder!: number;
}

export class CreateSchemeOfWorkDto {
  @IsString()
  @MaxLength(160)
  title!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sortOrder!: number;

  @IsString()
  @MaxLength(10000)
  summary!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  startsOn?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  endsOn?: string;
}

export class CreateTimetableSlotDto {
  @IsUUID()
  classGroupId!: string;

  @IsUUID()
  teacherStaffId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek!: number;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startsAt!: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  endsAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  room?: string;

  @IsDateString({ strict: true })
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  effectiveTo?: string;
}

export class CreateGradeScaleDto {
  @IsString()
  @MaxLength(32)
  code!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsIn(["numeric", "letter", "descriptor", "custom"])
  scaleType!: string;

  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => CreateGradeBandDto)
  bands!: CreateGradeBandDto[];
}

export class CreateAssessmentDto {
  @IsUUID()
  classGroupId!: string;

  @IsOptional()
  @IsUUID()
  gradeScaleId?: string;

  @IsString()
  @MaxLength(160)
  title!: string;

  @IsIn(["formative", "summative", "benchmark", "mock", "other"])
  assessmentType!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  maxScore!: number;

  @IsDateString({ strict: true })
  assessedOn!: string;
}

export class AssessmentResultInputDto {
  @IsUUID()
  pupilId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  score!: number;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  gradeCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comments?: string;
}

export class UpsertAssessmentResultsDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => AssessmentResultInputDto)
  results!: AssessmentResultInputDto[];
}

export class CreatePupilTargetDto {
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsString()
  @MaxLength(160)
  title!: string;

  @IsString()
  @MaxLength(4000)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  targetGrade?: string;

  @IsDateString({ strict: true })
  startsOn!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  endsOn?: string;
}

export class CreateExamSessionDto {
  @IsUUID()
  subjectId!: string;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  venue?: string;
}

export class CreateExamSeriesDto {
  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @IsString()
  @MaxLength(32)
  code!: string;

  @IsString()
  @MaxLength(160)
  name!: string;

  @IsString()
  @MaxLength(80)
  awardingBody!: string;

  @IsString()
  @MaxLength(80)
  qualification!: string;

  @IsDateString({ strict: true })
  startsOn!: string;

  @IsDateString({ strict: true })
  endsOn!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateExamSessionDto)
  sessions?: CreateExamSessionDto[];
}

export class ExamCandidateInputDto {
  @IsUUID()
  pupilId!: string;

  @IsUUID()
  subjectId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  candidateNumber!: string;
}

export class CreateExamCandidatesDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ExamCandidateInputDto)
  candidates!: ExamCandidateInputDto[];
}

export class ExamResultInputDto {
  @IsUUID()
  candidateId!: string;

  @IsString()
  @MaxLength(24)
  grade!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  score?: number;
}

export class UpsertExamResultsDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ExamResultInputDto)
  results!: ExamResultInputDto[];
}
