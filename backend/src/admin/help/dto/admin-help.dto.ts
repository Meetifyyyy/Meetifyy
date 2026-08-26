import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { HelpContentStatus } from '@prisma/client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Slugs appear in public URLs and are matched exactly, so the shape is pinned
 * here rather than left to whatever the admin typed.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MESSAGE = 'Use lowercase letters, numbers and hyphens only';

export class CreateHelpCategoryDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) title: string;

  /** Derived from the title when omitted. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  slug?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string;

  /** Icon name resolved against the dashboard's allow-list; free text is not rendered. */
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) icon?: string;

  @IsOptional() @IsInt() @Min(0) sortOrder?: number;

  @IsOptional() @IsEnum(HelpContentStatus) status?: HelpContentStatus;
}

export class UpdateHelpCategoryDto extends CreateHelpCategoryDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) declare title: string;
}

export class CreateHelpArticleDto {
  @Transform(trim) @IsString() @MaxLength(60) categoryId: string;

  @Transform(trim) @IsString() @MinLength(3) @MaxLength(300) question: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  slug?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) summary?: string;

  /** Rich text. Sanitized server-side before it is stored. */
  @IsString() @MinLength(1, { message: 'Write an answer' }) @MaxLength(100000) body: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  @Transform(({ value }) =>
    Array.isArray(value)
      ? // Normalised on the way in so search can match them without having to
        // lower-case a column at query time.
        Array.from(new Set(value.map((v) => String(v).trim().toLowerCase()).filter(Boolean)))
      : value,
  )
  keywords?: string[];

  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @IsEnum(HelpContentStatus) status?: HelpContentStatus;
}

export class UpdateHelpArticleDto extends CreateHelpArticleDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) declare categoryId: string;
  @IsOptional() @Transform(trim) @IsString() @MinLength(3) @MaxLength(300) declare question: string;
  @IsOptional() @IsString() @MaxLength(100000) declare body: string;
}

export class SetHelpStatusDto {
  @IsEnum(HelpContentStatus, { message: 'Unknown publication status' })
  status: HelpContentStatus;
}

export class ListHelpContentDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsEnum(HelpContentStatus) status?: HelpContentStatus;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) categoryId?: string;

  // Query strings carry booleans as text, so the raw 'true' has to be mapped
  // before @IsBoolean sees it.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  featuredOnly?: boolean;
}

export class PreviewArticleDto {
  @IsString() @MaxLength(100000) body: string;
}
