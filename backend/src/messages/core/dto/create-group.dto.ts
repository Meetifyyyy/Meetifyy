import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { MaxChars } from '../../../common/validation/max-chars.validator';
import {
  MAX_GROUP_NAME_LENGTH,
  MAX_NEW_GROUP_MEMBERS,
} from '../message-limits';
import { IsUserIdReferences } from './user-id-references.validator';

/**
 * `POST /api/group-chats`.
 *
 * `userIds` is optional because the controller has always read a missing one as
 * "just the creator"; the name is what makes a group. Ids are UUIDs: they are
 * `User.id`, which Supabase issues.
 */
export class CreateGroupDto {
  @IsString()
  @IsNotEmpty({ message: 'Group name is required' })
  @MaxChars(MAX_GROUP_NAME_LENGTH)
  name!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_NEW_GROUP_MEMBERS, {
    message: `A new group can start with at most ${MAX_NEW_GROUP_MEMBERS} people.`,
  })
  @IsUUID('all', { each: true })
  userIds?: string[];
}

/**
 * `POST /api/messages`: start a DM, or a group when a name is given.
 *
 * `userIds` is also accepted from the query string (`?userIds=a,b`), so the
 * body's is optional. In the body it has been sent as an id, a list of ids, or
 * either as `{ id }` / `{ userId }` objects, and every one stays valid.
 */
export class StartConversationDto {
  @IsOptional()
  @IsUserIdReferences({ max: MAX_NEW_GROUP_MEMBERS, allowObjects: true })
  userIds?: unknown;

  @IsOptional()
  @IsString()
  @MaxChars(MAX_GROUP_NAME_LENGTH)
  name?: string;
}

/**
 * `POST /api/dm`. `targetUserId` is the current field; `userIds` is what older
 * clients sent, of which only the first is used.
 */
export class StartDirectMessageDto {
  @IsOptional()
  @IsUUID('all')
  targetUserId?: string;

  @IsOptional()
  @IsUserIdReferences({ max: MAX_NEW_GROUP_MEMBERS, allowObjects: false })
  userIds?: string | string[];
}
