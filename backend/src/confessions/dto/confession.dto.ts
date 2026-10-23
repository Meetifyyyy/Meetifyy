import { IsEnum, IsString, MaxLength } from 'class-validator';
import { ConfessionStatus } from '@prisma/client';

/**
 * The DTOs only establish that the field is a string of sane size. The real
 * rules (handle charset/reserved words, content length after normalising) are
 * applied in ConfessionsService so the client gets the specific error codes
 * the contract promises (`handle_invalid`, `content_invalid`) rather than a
 * generic validation message.
 */
export class CreateConfessionProfileDto {
  @IsString()
  @MaxLength(64)
  handle!: string;
}

export class CreateConfessionDto {
  @IsString()
  // Raw cap before normalising; the 1000-character limit applies after.
  @MaxLength(10000)
  content!: string;
}

/** A moderator's decision, from the admin panel. */
export class ModerateConfessionDto {
  @IsEnum(ConfessionStatus)
  status!: ConfessionStatus;
}
