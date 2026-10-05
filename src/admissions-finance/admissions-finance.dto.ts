import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export class CreateApplicationDto {
  @IsOptional()
  @IsUUID()
  targetYearGroupId?: string;

  @IsString()
  @MaxLength(160)
  applicantName!: string;

  @IsEmail()
  @MaxLength(320)
  applicantEmail!: string;

  @IsString()
  @MaxLength(32)
  applicantPhone!: string;

  @IsString()
  @MaxLength(100)
  pupilFirstName!: string;

  @IsString()
  @MaxLength(100)
  pupilLastName!: string;

  @IsDateString({ strict: true })
  pupilDateOfBirth!: string;
}

export class UpdateApplicationStatusDto {
  @IsIn(["reviewing", "documents_requested", "offered", "waitlisted", "declined", "accepted", "withdrawn"])
  status!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class LinkApplicationParentDto {
  @IsUUID()
  parentUserId!: string;
}

export class CreateOfferDto {
  @IsString()
  @MaxLength(10000)
  terms!: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class OfferResponseDto {
  @IsIn(["accepted", "declined"])
  response!: "accepted" | "declined";
}

export class RequestApplicationDocumentDto {
  @IsString()
  @MaxLength(40)
  documentType!: string;
}

export class CreateChargeDto {
  @IsString()
  @MaxLength(32)
  code!: string;

  @IsString()
  @MaxLength(240)
  description!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsUUID()
  pupilId?: string;

  @IsOptional()
  @IsIn(["GBP"])
  currency?: string;
}

export class InvoiceLineDto {
  @IsOptional()
  @IsUUID()
  chargeId?: string;

  @IsString()
  @MaxLength(240)
  description!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitAmount!: number;
}

export class CreateInvoiceDto {
  @IsUUID()
  parentUserId!: string;

  @IsOptional()
  @IsUUID()
  applicationId?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dueAt?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines!: InvoiceLineDto[];
}

export class IssueInvoiceDto {
  @IsIn(["issued", "void"])
  status!: "issued" | "void";
}

export class CreateRefundDto {
  @IsString()
  @MaxLength(160)
  idempotencyKey!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class CreateEnrolmentHandoffDto {
  @IsUUID()
  academicYearId!: string;

  @IsUUID()
  yearGroupId!: string;

  @IsUUID()
  formId!: string;
}
