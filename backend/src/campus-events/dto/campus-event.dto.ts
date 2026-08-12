import {
  IsString,
  IsOptional,
  MaxLength,
  IsDateString,
  IsIn,
} from 'class-validator';

export class CreateCampusEventDto {
  @IsString()
  @MaxLength(120)
  title: string;

  @IsString()
  @IsOptional()
  @MaxLength(4000)
  description?: string;

  // Media key/URL returned by POST /api/media/upload (same convention as CrewActivity.coverImage).
  @IsString()
  @IsOptional()
  @MaxLength(2048)
  posterUrl?: string;

  @IsDateString()
  eventDate: string;

  @IsDateString()
  startTime: string;

  @IsDateString()
  endTime: string;

  @IsString()
  @MaxLength(120)
  hostedBy: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  venue?: string;

  // Authoritative validation/sanitization happens server-side (see sanitizeRegistrationUrl).
  @IsString()
  @IsOptional()
  @MaxLength(2048)
  registrationUrl?: string;
}

export class UpdateCampusEventDto {
  @IsString()
  @IsOptional()
  @MaxLength(120)
  title?: string;

  @IsString()
  @IsOptional()
  @MaxLength(4000)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2048)
  posterUrl?: string;

  @IsDateString()
  @IsOptional()
  eventDate?: string;

  @IsDateString()
  @IsOptional()
  startTime?: string;

  @IsDateString()
  @IsOptional()
  endTime?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  hostedBy?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  venue?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2048)
  registrationUrl?: string;
}

export type CampusEventScope = 'upcoming' | 'ongoing' | 'past';

export const CAMPUS_EVENT_SCOPES: CampusEventScope[] = ['upcoming', 'ongoing', 'past'];
