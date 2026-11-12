import { IsOptional, IsString, MaxLength } from 'class-validator';
import { MaxChars } from '../../../common/validation/max-chars.validator';
import {
  MAX_GROUP_AVATAR_LENGTH,
  MAX_GROUP_DESCRIPTION_LENGTH,
  MAX_GROUP_NAME_LENGTH,
} from '../message-limits';

/**
 * `PATCH /api/group-chats/:id/info` and `PATCH /api/messages/:id/group`.
 *
 * Every field is optional and only what is sent changes. The avatar has two
 * spellings: `avatarKey` is current, `avatar` is what older installed apps
 * send, and the service prefers `avatarKey`.
 */
export class UpdateGroupInfoDto {
  @IsOptional()
  @IsString()
  @MaxChars(MAX_GROUP_NAME_LENGTH)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxChars(MAX_GROUP_DESCRIPTION_LENGTH)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_GROUP_AVATAR_LENGTH)
  avatarKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_GROUP_AVATAR_LENGTH)
  avatar?: string;
}
