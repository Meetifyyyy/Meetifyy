import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SupportCategory } from '@prisma/client';
import { PUBLIC_SUPPORT_CATEGORIES } from '../support.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Diagnostic hints the client volunteers. Everything here is attacker-controlled
 * and is only ever displayed to an admin - none of it is used for a decision.
 */
export class SupportBrowserInfoDto {
  @IsOptional() @IsString() @MaxLength(120) browser?: string;
  @IsOptional() @IsString() @MaxLength(120) browserVersion?: string;
  @IsOptional() @IsString() @MaxLength(120) os?: string;
  @IsOptional() @IsString() @MaxLength(40) deviceType?: string;
  @IsOptional() @IsString() @MaxLength(40) screen?: string;
  @IsOptional() @IsString() @MaxLength(40) language?: string;
  @IsOptional() @IsString() @MaxLength(60) timezone?: string;
}

export class SupportAttachmentRefDto {
  /** Storage key returned by POST /support/attachments. */
  @IsString() @MaxLength(300) key: string;

  /**
   * Original filename, for display only.
   *
   * Unlike the type and size, which are read back from the stored Media row so
   * a caller cannot misdescribe them, the filename has no server-side source:
   * the storage key is generated here and carries no trace of what the file was
   * called. It is therefore taken from the client and sanitized on arrival. The
   * worst a caller can do is mislabel their own attachment in their own receipt.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  filename?: string;
}

export class CreateSupportRequestDto {
  @Transform(trim)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  name?: string;

  // Restricted to the public list rather than the whole enum: the legacy
  // members exist only so old rows still parse, and `OTHER` already covers
  // anything the current list does not.
  @IsEnum(SupportCategory)
  @IsIn(PUBLIC_SUPPORT_CATEGORIES as SupportCategory[], {
    message: 'Choose one of the listed categories',
  })
  category: SupportCategory;

  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Subject must be at least 3 characters' })
  @MaxLength(200)
  subject: string;

  @Transform(trim)
  @IsString()
  @MinLength(20, {
    message: 'Please describe the issue in at least 20 characters',
  })
  @MaxLength(10000)
  description: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => SupportAttachmentRefDto)
  attachments?: SupportAttachmentRefDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => SupportBrowserInfoDto)
  browserInfo?: SupportBrowserInfoDto;

  /** Path the user was on when they opened the form, e.g. `/communities/42`. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  pageContext?: string;

  /**
   * Honeypot. A real form leaves it empty because the field is hidden; the
   * simplest scripted submitters fill in every input they find.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
