import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { LegalDocumentType } from '@prisma/client';

export class SaveLegalDraftDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  subtitle?: string;

  /**
   * Sanitized on save, so what is stored is exactly what will be published.
   * The upper bound is generous — a Privacy Policy is a long document — but
   * finite, because this is rendered into every user's consent modal.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(200_000)
  content!: string;
}

export class PublishLegalVersionDto {
  /**
   * Mandatory, and mandatory for a reason: this string is what the version
   * history, the audit log and (when acknowledgement is required) every user's
   * consent modal show as the explanation for the change. A published version
   * with no stated reason is the thing this workflow exists to prevent.
   */
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  changeSummary!: string;

  /** When the text takes effect. Defaults to the moment of publication. */
  @IsOptional()
  @IsDateString()
  effectiveAt?: string;

  /**
   * Turns on the mandatory consent gate for this version.
   *
   * Configured here rather than editable afterwards: a published version is
   * immutable, and "we made acceptance mandatory retroactively" is not a state
   * a consent record should ever have to describe.
   */
  @IsOptional()
  @IsBoolean()
  requiresAcknowledgement?: boolean;
}

export class RollbackLegalVersionDto extends PublishLegalVersionDto {
  /** The historical version whose text is being restored. */
  @IsInt()
  @Type(() => Number)
  targetVersionNumber!: number;
}

export class LegalDocumentTypeParam {
  @IsEnum(LegalDocumentType)
  type!: LegalDocumentType;
}

export class PreviewLegalContentDto {
  @IsString()
  @MaxLength(200_000)
  content!: string;
}
