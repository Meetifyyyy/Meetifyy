import {
  IsString,
  IsOptional,
  MaxLength,
  IsDateString,
  IsIn,
  IsUUID,
  IsBoolean,
} from 'class-validator';

export class CreateCampusEventDto {
  @IsString()
  @MaxLength(50)
  title: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
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
  @MaxLength(50)
  hostedBy: string;

  @IsString()
  @MaxLength(100)
  venue: string;

  // Authoritative validation/sanitization happens server-side (see sanitizeRegistrationUrl).
  @IsString()
  @IsOptional()
  @MaxLength(2048)
  registrationUrl?: string;

  /**
   * A key the client generates once per Create-Event dialog and resends on
   * every attempt. Two requests carrying the same key from the same rep resolve
   * to one event: the second gets the first one back rather than creating a
   * duplicate. Optional, so an older client keeps working (without the
   * guarantee).
   */
  @IsUUID()
  @IsOptional()
  idempotencyKey?: string;

  /**
   * Publish as part of creation instead of leaving a DRAFT for a follow-up
   * `POST /:id/publish`. The two-call sequence was not atomic: when the second
   * call failed the rep saw an error and was left with an invisible draft that
   * no discovery scope returns.
   */
  @IsBoolean()
  @IsOptional()
  publish?: boolean;
}

export class UpdateCampusEventDto {
  @IsString()
  @IsOptional()
  @MaxLength(50)
  title?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
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
  @MaxLength(50)
  hostedBy?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  venue?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2048)
  registrationUrl?: string;
}

export type CampusEventScope = 'upcoming' | 'ongoing' | 'past';

export const CAMPUS_EVENT_SCOPES: CampusEventScope[] = [
  'upcoming',
  'ongoing',
  'past',
];
