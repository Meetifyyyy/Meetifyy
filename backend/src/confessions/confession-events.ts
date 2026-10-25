/**
 * Live confession activity over the socket.
 *
 * A campus's confessions page joins one room, named from the viewer's own
 * ACTIVE affiliation by the server (never from the client), and receives
 * reaction totals as they change. Only totals travel: never who reacted,
 * never the caller's own reaction, never content.
 */
export const CONFESSION_REACTIONS_EVENT = 'confession.reactions';

/** Prefix of every campus confessions room. */
export const CONFESSION_ROOM_PREFIX = 'confessions_';

export function confessionRoom(collegeId: string): string {
  return `${CONFESSION_ROOM_PREFIX}${collegeId}`;
}
