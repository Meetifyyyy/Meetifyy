/**
 * A group's two admin settings, as the client reads them.
 *
 * The first builds stored display strings rather than codes ('Request
 * required', 'Everyone'), and groups made then still have them; the server
 * reads them the same way (normalizeWhoCanJoin, and the edit check in
 * updateGroupInfo). Every reader here goes through these, instead of each
 * screen comparing against its own list of spellings.
 */
export const WHO_CAN_JOIN = { ANYONE: 'ANYONE', APPROVAL: 'APPROVAL' };
export const EDIT_PERMISSION = { ADMIN: 'ADMIN', EVERYONE: 'EVERYONE' };

/** The same reading as the server's normalizeWhoCanJoin (messaging-core). */
export function normalizeWhoCanJoin(value) {
  const v = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return v === 'APPROVAL' || v === 'APPROVAL_REQUIRED' || v === 'REQUEST_REQUIRED'
    ? WHO_CAN_JOIN.APPROVAL
    : WHO_CAN_JOIN.ANYONE;
}

export function normalizeEditPermission(value) {
  const v = String(value || '').trim().toUpperCase();
  return v === 'EVERYONE' || v === 'ALL_MEMBERS' || v === 'ALL'
    ? EDIT_PERMISSION.EVERYONE
    : EDIT_PERMISSION.ADMIN;
}
