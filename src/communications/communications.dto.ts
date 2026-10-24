import { Type } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from "class-validator";

const EVENT_AUDIENCES = ["internal", "staff", "parent", "student", "public"];
const DOCUMENT_AUDIENCES = ["staff", "parent", "student"];

export class CalendarEventsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  pupilId?: string;
}

export class CreateCalendarEventDto {
  @IsString()
  @Length(1, 160)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(1, 4000)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(1, 240)
  location?: string;

  @IsIn(EVENT_AUDIENCES)
  audience!: string;

  @IsOptional()
  @IsUUID()
  pupilId?: string;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsOptional()
  @IsBoolean()
  allDay?: boolean;
}

export class CreateDocumentUploadRequestDto {
  @IsString()
  @Length(1, 160)
  title!: string;

  @IsString()
  @Length(1, 255)
  originalFilename!: string;

  @IsString()
  @Length(1, 120)
  contentType!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10 * 1024 * 1024)
  byteSize!: number;

  @IsOptional()
  @IsUUID()
  pupilId?: string;

  @IsOptional()
  @IsIn(DOCUMENT_AUDIENCES)
  audience?: string;
}

export class CreateCommunicationMessageDto {
  @IsUUID()
  pupilId!: string;

  @IsUUID()
  recipientUserId!: string;

  @IsString()
  @Length(1, 180)
  subject!: string;

  @IsString()
  @Length(1, 8000)
  body!: string;
}

export class CommunicationMessagesQueryDto {
  @IsUUID()
  pupilId!: string;
}

export class ParentMessagesQueryDto {
  @IsOptional()
  @IsUUID()
  pupilId?: string;
}
