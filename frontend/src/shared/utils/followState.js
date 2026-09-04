/**
 * The one client-side answer to "does the viewer follow this account?".
 *
 * Before this existed, every surface derived follow state its own way and they
 * disagreed:
 *
 *   - `FollowButton` fetched the target's whole profile and read `isFollowing`
 *     off it — one full `GET /api/users/:username` per button on screen.
 *   - The profile sidebar read `currentUser.followingList`, a client-cached
 *     array that `/api/auth/sync` overwrites wholesale on every auth event.
 *   - List payloads that carried no `isFollowing` field at all were read as
 *     `u.isFollowing || false`, so "the field is missing" and "not following"
 *     were the same value.
 *
 * The third is what made the state flip back: a list refetch replaced a row
 * that said `isFollowing: true` with one that said nothing, and nothing reads
 * as false. So the cache entry here is deliberately tri-state — `true`,
 * `false`, or absent — and a payload without the field writes nothing rather
 * than writing `false`.
 *
 * Entries live in the React Query cache so any mounted button re-renders when
 * one changes, without a store of our own and without a fetch: the entry is
 * written by whoever holds authoritative state (a list payload that carries
 * the field, the follow/unfollow response, a profile fetch) and read by every
 * button for that account.
 */
import { toggleRegistry } from './mutationRegistry';

/**
 * When the follow graph was last changed on this client.
 *
 * `/api/auth/sync` answers with a full `followingList`, and AuthContext
 * replaces `currentUser.followingList` with it wholesale. A sync that was
 * already on the wire when the viewer pressed Follow therefore lands with a
 * pre-follow snapshot and undoes the local change — a race no amount of
 * server-side cache invalidation can close, because the response was generated
 * before the write existed. Comparing this timestamp against the moment the
 * sync request was issued tells the reader which of the two is older.
 */
let lastFollowGraphWriteAt = 0;

/** True if a follow/unfollow was applied locally after `since` (epoch ms). */
export function followGraphChangedSince(since) {
  return lastFollowGraphWriteAt > since;
}

/** Cache key for one account's follow state. Usernames are case-insensitive. */
export function followStateKey(username) {
  return ['followState', String(username || '').toLowerCase()];
}

/** The registry key a follow toggle for this account registers under. */
export function followEntityKey(username) {
  return `follow:${String(username || '').toLowerCase()}`;
}

/**
 * Write authoritative (server-derived) follow state.
 *
 * Skipped while a toggle for the same account is still in flight: the user's
 * pending intent is newer than any response that was already on the wire when
 * they clicked, and letting a server payload land on top of it is precisely
 * the "button snaps back for a moment" flicker. The in-flight request will
 * write its own result when it settles.
 */
export function writeServerFollowState(queryClient, username, isFollowing) {
  if (!username || typeof isFollowing !== 'boolean') return;
  if (toggleRegistry.isPending(followEntityKey(username))) return;
  queryClient.setQueryData(followStateKey(username), isFollowing);
}

/**
 * Record that the viewer changed the graph. Called only for their own actions
 * — seeding state from a list payload is not a change, it is a reading of one.
 */
export function markFollowGraphChanged() {
  lastFollowGraphWriteAt = Date.now();
}

/**
 * Write the state a click just asked for. Always wins — this is the user's
 * current intent, and it is what makes the button change on the same frame.
 */
export function writeOptimisticFollowState(queryClient, username, isFollowing) {
  if (!username || typeof isFollowing !== 'boolean') return;
  markFollowGraphChanged();
  queryClient.setQueryData(followStateKey(username), isFollowing);
}

/** Current state, or `undefined` when nothing authoritative is known yet. */
export function readFollowState(queryClient, username) {
  if (!username) return undefined;
  return queryClient.getQueryData(followStateKey(username));
}

/**
 * Seed from a list payload — recommendations, search results, campus users,
 * a followers/following page.
 *
 * Only rows that actually carry a boolean `isFollowing` contribute. A row
 * without the field is skipped rather than treated as "not following", so a
 * payload that has not been taught to include follow state can never downgrade
 * state that another source got right.
 */
export function seedFollowStateFromList(queryClient, users) {
  if (!Array.isArray(users)) return;
  for (const u of users) {
    if (u?.username && typeof u.isFollowing === 'boolean') {
      writeServerFollowState(queryClient, u.username, u.isFollowing);
    }
  }
}
