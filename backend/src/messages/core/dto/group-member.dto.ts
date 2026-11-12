import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { MAX_GROUP_PERMISSION_LENGTH } from '../message-limits';

/** `POST …/:id/members`: the person to add. */
export class AddGroupMemberDto {
  @IsUUID('all')
  userId!: string;
}

/** `POST …/:id/owner` and `POST …/:id/admins`: the member whose role changes. */
export class GroupRoleTargetDto {
  @IsUUID('all')
  targetUserId!: string;
}

/**
 * `PATCH …/:id/permissions`: who may edit the group's details.
 *
 * Not narrowed to today's codes, for the reason `UpdateGroupSettingsDto` gives:
 * earlier builds wrote other spellings and installed apps still call this.
 */
export class UpdateGroupPermissionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_GROUP_PERMISSION_LENGTH)
  permission!: string;
}
