import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
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
  @Transform(trim)
  @IsString({ message: 'Attachment key must be a string' })
  @IsNotEmpty({ message: 'Attachment key is required' })
  @MaxLength(300, { message: 'Attachment key is too long' })
  key: string;

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
  @Transform(trim)
  @IsString({ message: 'Filename must be a string' })
  @MaxLength(200, { message: 'Filename is too long' })
  filename?: string;
}

export class CreateSupportRequestDto {
  @Transform(trim)
  @IsString({ message: 'Name must be a string' })
  @IsNotEmpty({ message: 'Enter your name' })
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  @MaxLength(100, { message: 'Name cannot exceed 100 characters' })
  name: string;

  @Transform(trim)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254, { message: 'Email address cannot exceed 254 characters' })
  email: string;

  // Restricted to the public list rather than the whole enum: the legacy
  // members exist only so old rows still parse, and `OTHER` already covers
  // anything the current list does not.
  @IsEnum(SupportCategory, { message: 'Invalid support category' })
  @IsIn(PUBLIC_SUPPORT_CATEGORIES as SupportCategory[], {
    message: 'Choose one of the listed categories',
  })
  category: SupportCategory;

  @Transform(trim)
  @IsString({ message: 'Subject must be a string' })
  @IsNotEmpty({ message: 'Add a subject' })
  @MinLength(3, { message: 'Subject must be at least 3 characters' })
  @MaxLength(200, { message: 'Subject cannot exceed 200 characters' })
  subject: string;

  @Transform(trim)
  @IsString({ message: 'Description must be a string' })
  @IsNotEmpty({ message: 'Please describe the issue' })
  @MinLength(20, {
    message: 'Please describe the issue in at least 20 characters',
  })
  @MaxLength(10000, {
    message: 'Description cannot exceed 10000 characters',
  })
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
