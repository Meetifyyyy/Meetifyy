import { IsString, MaxLength } from 'class-validator';

/** The longest discussion message the server will store. */
export const MAX_DISCUSSION_MESSAGE_LENGTH = 2000;

/**
 * `POST /api/activities/:activityId/discussion`.
 *
 * Measured like the service measures it (UTF-16 length), so the two cannot
 * disagree. Emptiness is left to the service, which trims before it judges: a
 * message of only spaces is "cannot be empty" there.
 */
export class SendDiscussionMessageDto {
  @IsString()
  @MaxLength(MAX_DISCUSSION_MESSAGE_LENGTH)
  text!: string;
}
