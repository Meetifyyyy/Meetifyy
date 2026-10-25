import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ConfessionStatus } from '@prisma/client';
import {
  CONFESSION_REACTIONS,
  type ConfessionReactionKey,
} from '../confession-reactions';

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

/** Setting (or changing) the caller's reaction to a confession. */
export class SetConfessionReactionDto {
  @IsIn(CONFESSION_REACTIONS)
  reaction!: ConfessionReactionKey;
}

/** Most confessions a sync refreshes the totals of: a few pages' worth. */
export const SYNC_MAX_IDS = 100;

/**
 * What the feed has, for `POST /api/confessions/sync`: the newest confession
 * it holds (as a feed cursor) and the ids it shows.
 */
export class SyncConfessionsDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  after?: string;

  @IsArray()
  @ArrayMaxSize(SYNC_MAX_IDS)
  @IsUUID('all', { each: true })
  ids!: string[];
}
