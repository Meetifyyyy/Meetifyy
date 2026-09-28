import { IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * A group's settings, as `PATCH …/:id/settings` accepts them (both the
 * `api/group-chats` and the older `api/messages` route).
 *
 * `groupUpdatesActive` is the caller's own notification switch; the other four
 * are admin-only and checked in the service.
 *
 * The string fields are deliberately not restricted to today's codes
 * (`ANYONE`/`APPROVAL`, `PUBLIC`/`COLLEGE`/`HIDDEN`, `ADMIN`/`EVERYONE`): the
 * first builds wrote display strings such as `'Request required'` or
 * `'Visible only to <university>'`, and installed apps from that era still call
 * this route. Narrowing them is a client-contract change, not a typing one.
 */
export class UpdateGroupSettingsDto {
  @IsOptional()
  @IsBoolean()
  groupUpdatesActive?: boolean;

  @IsOptional()
  @IsString()
  whoCanJoin?: string;

  @IsOptional()
  @IsString()
  visibility?: string;

  @IsOptional()
  @IsBoolean()
  allowSharing?: boolean;

  @IsOptional()
  @IsString()
  editGroupPermission?: string;
}

/** The admin-only settings a caller supplied, and only those. */
export type GroupSettingsUpdate = Pick<
  UpdateGroupSettingsDto,
  'whoCanJoin' | 'visibility' | 'allowSharing' | 'editGroupPermission'
>;

/**
 * The admin-editable columns out of a settings body — never the raw body, so
 * a conversation's ownerId, type, status or expiry can't be mass-assigned.
 * A field left undefined is omitted rather than written.
 */
export function pickGroupSettings(
  data: UpdateGroupSettingsDto,
): GroupSettingsUpdate {
  const picked: GroupSettingsUpdate = {};
  if (data.whoCanJoin !== undefined) picked.whoCanJoin = data.whoCanJoin;
  if (data.visibility !== undefined) picked.visibility = data.visibility;
  if (data.allowSharing !== undefined) picked.allowSharing = data.allowSharing;
  if (data.editGroupPermission !== undefined)
    picked.editGroupPermission = data.editGroupPermission;
  return picked;
}
