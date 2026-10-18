import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import { LegalDocumentType } from '@prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class SaveLegalDraftDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  subtitle?: string;

  /**
   * Sanitized on save with `sanitizeArticleHtml`, so what is stored is exactly
   * what will be published. Generous but finite: this is rendered into every
   * user's update screen.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(200_000)
  content!: string;
}

/** Opens a draft. With `fromVersionId`, seeds it from that older version. */
export class StartLegalDraftDto {
  @IsOptional()
  @IsUUID()
  fromVersionId?: string;
}

export class PublishLegalDraftDto {
  /**
   * Required, with no default: the admin must choose. `true` puts every user
   * behind the update screen until they choose Got it; `false` publishes the
   * new text silently (typos, formatting).
   */
  @IsBoolean()
  notifyUsers!: boolean;

  /**
   * Shown on the update screen. Required when notifying (checked in the
   * service, where `notifyUsers` is known), optional otherwise.
   */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  changeSummary?: string;

  /** Defaults to now. At most 90 days ahead (checked in the service). */
  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveAt?: string;
}

/**
 * Asks users to review documents whose current text has not changed in this
 * portal (for example after a text change shipped some other way). Publishes a
 * notified copy of each current version.
 */
export class NotifyLegalUpdateDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsEnum(LegalDocumentType, { each: true })
  documentTypes!: LegalDocumentType[];

  @Transform(trim)
  @IsString()
  @Length(10, 500)
  changeSummary!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveAt?: string;
}

export class PreviewLegalContentDto {
  @IsString()
  @MaxLength(200_000)
  content!: string;
}
