import { IsString, IsOptional, IsBoolean, MaxLength, IsDateString, IsNumber, Matches } from 'class-validator';

export class CreateActivityDto {
  @IsString()
  @MaxLength(30)
  title: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  description?: string;

  @IsString()
  @IsOptional()
  coverImage?: string;

  /** Media row id produced by the media pipeline for an uploaded cover. */
  @IsString()
  @IsOptional()
  coverMediaId?: string;

  /**
   * Solid-colour cover, as `#RRGGBB`. Mutually exclusive with coverImage —
   * the service clears the image fields whenever this is set.
   */
  @IsString()
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'coverColor must be a #RRGGBB hex colour' })
  coverColor?: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  location?: string;

  @IsBoolean()
  @IsOptional()
  shareToCampus?: boolean;

  @IsString()
  @IsOptional()
  visibility?: string;

  @IsNumber()
  @IsOptional()
  maxMembers?: number;
}
