import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { MAX_REFERENCE_ID_LENGTH } from '../message-limits';

/**
 * `POST /api/group-chats/:id/join` (and its older aliases): the invite the
 * person is joining through. Someone not in the group must name one; the
 * server decides whether it is still usable (core/group-invite-access.ts).
 *
 * Both optional, so a body-less request still parses: an existing member
 * re-tapping needs no invite, and an older client sending nothing is answered
 * INVITE_REQUIRED rather than 400.
 */
export class JoinGroupDto {
  /** An invite link's code (meetifyy.app/g/<code>). */
  @IsOptional()
  @IsString()
  @Matches(/^[0-9A-Za-z]{1,16}$/)
  code?: string;

  /** The chat message carrying the invite card. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REFERENCE_ID_LENGTH)
  messageId?: string;
}
