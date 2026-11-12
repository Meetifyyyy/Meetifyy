import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MAX_REACTION_LENGTH } from '../message-limits';

/** `POST …/:messageId/react`, on `/api/messages`, `/api/dm` and `/api/group-chats`. */
export class ReactToMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REACTION_LENGTH)
  reaction!: string;
}
