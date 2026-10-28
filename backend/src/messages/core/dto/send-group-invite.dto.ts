import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  MAX_CLIENT_MESSAGE_ID_LENGTH,
  MAX_REFERENCE_ID_LENGTH,
} from '../message-limits';

/**
 * `POST /api/dm/invite`: invite one person to a group, in one request.
 *
 * Carries ids only. The invite card is built on the server from the group as
 * it is (MessagingCoreService.buildGroupInvite), so a
 * client cannot put another group's name or picture on an invite.
 */
export class SendGroupInviteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_REFERENCE_ID_LENGTH)
  targetUserId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(MAX_REFERENCE_ID_LENGTH)
  groupId!: string;

  /** Idempotency key: a retried invite returns the one already sent. */
  @IsString()
  @IsOptional()
  @MaxLength(MAX_CLIENT_MESSAGE_ID_LENGTH)
  clientId?: string;
}
