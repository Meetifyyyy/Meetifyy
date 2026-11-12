import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  MAX_FORWARD_TARGETS,
  MAX_REFERENCE_ID_LENGTH,
} from '../message-limits';

/**
 * `POST …/msg/:messageId/forward`, on `/api/messages`, `/api/dm` and
 * `/api/group-chats` alike.
 *
 * The messages say the same thing the service and controller used to, so a
 * client that shows the server's words keeps showing them. Targets are
 * conversation references: an internal UUID or a public id, either of which
 * `resolveConversationId` accepts.
 */
export class ForwardMessageDto {
  @IsArray({ message: 'targetConversationIds array is required' })
  @ArrayNotEmpty({ message: 'targetConversationIds array is required' })
  @ArrayMaxSize(MAX_FORWARD_TARGETS, {
    message: `You can forward to at most ${MAX_FORWARD_TARGETS} chats at once.`,
  })
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(MAX_REFERENCE_ID_LENGTH, { each: true })
  targetConversationIds!: string[];
}
