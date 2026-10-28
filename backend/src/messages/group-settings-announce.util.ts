/**
 * The line a group sees when an admin changes one of its settings, so a
 * change is never silent: members learn that joining now needs approval, or
 * who may edit the group's name and photo, the moment it happens, in the chat
 * where everything else about the group is recorded. Nothing is posted for a
 * save that changed nothing.
 *
 * Values are compared as the server reads them: groups created by the first
 * builds still hold display strings ('Request required', 'Everyone').
 */
export interface GroupSettingsSnapshot {
  whoCanJoin?: string | null;
  editGroupPermission?: string | null;
}

function joinCode(value: string | null | undefined): 'ANYONE' | 'APPROVAL' {
  const v = (value || 'ANYONE').toUpperCase().replace(/[\s-]+/g, '_');
  return v === 'APPROVAL' ||
    v === 'APPROVAL_REQUIRED' ||
    v === 'REQUEST_REQUIRED'
    ? 'APPROVAL'
    : 'ANYONE';
}

function editCode(value: string | null | undefined): 'ADMIN' | 'EVERYONE' {
  const v = (value || '').toUpperCase();
  return v === 'EVERYONE' || v === 'ALL_MEMBERS' || v === 'ALL'
    ? 'EVERYONE'
    : 'ADMIN';
}

export function settingsChangeLines(
  actorHandle: string,
  before: GroupSettingsSnapshot | null | undefined,
  after: GroupSettingsSnapshot | null | undefined,
): string[] {
  if (!before || !after) return [];
  const lines: string[] = [];
  if (after.whoCanJoin !== undefined && after.whoCanJoin !== null) {
    const was = joinCode(before.whoCanJoin);
    const now = joinCode(after.whoCanJoin);
    if (was !== now) {
      lines.push(
        now === 'APPROVAL'
          ? `${actorHandle} turned on approval for new members`
          : `${actorHandle} turned off approval for new members`,
      );
    }
  }
  if (
    after.editGroupPermission !== undefined &&
    after.editGroupPermission !== null
  ) {
    const was = editCode(before.editGroupPermission);
    const now = editCode(after.editGroupPermission);
    if (was !== now) {
      lines.push(
        now === 'EVERYONE'
          ? `${actorHandle} allowed all members to edit group info`
          : `${actorHandle} allowed only admins to edit group info`,
      );
    }
  }
  return lines;
}
