import { IsEmail, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from "class-validator";

export class UpdateParentPortalPasswordDto {
  @IsString()
  @MinLength(8)
  password!: string;
}

export class UpdateParentContactDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  title?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== "")
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  mobile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  landline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  postcode?: string;
}