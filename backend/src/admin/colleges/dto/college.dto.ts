import { CollegeStatus } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';

/**
 * The fields an admin may set on a college. Everything else on the row —
 * `id`, `deletedAt`, `isVerified`, timestamps — is the service's to manage, and
 * the global pipe refuses a body that names it.
 */
class CollegeFieldsDto {
  @IsOptional()
  @IsString()
  shortName?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  logoKey?: string;

  @IsOptional()
  @IsString()
  bannerKey?: string;

  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;
}

/** `POST /admin/colleges`. */
export class CreateCollegeDto extends CollegeFieldsDto {
  @IsString()
  name!: string;

  @IsArray()
  @IsString({ each: true })
  domains!: string[];
}

/** `PATCH /admin/colleges/:id`. Every field optional; only what is sent changes. */
export class UpdateCollegeDto extends CollegeFieldsDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  domains?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsEnum(CollegeStatus)
  status?: CollegeStatus;
}

/** `PATCH /admin/colleges/:id/status`. */
export class ChangeCollegeStatusDto {
  @IsEnum(CollegeStatus)
  status!: CollegeStatus;
}
