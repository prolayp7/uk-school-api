import { Type } from "class-transformer";
import {
  IsInt,
  IsOptional,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;

  @IsOptional()
  @MaxLength(512)
  @Matches(/^[A-Za-z0-9_-]+$/)
  after?: string;
}
