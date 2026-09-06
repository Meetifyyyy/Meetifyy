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

/**
 * Per-account version of the same clock: when the viewer last changed THIS
 * account's follow state on this client.
 *
 * The global timestamp above cannot arbitrate a single account, because any
 * follow anywhere advances it. This map can, and it is what stops a cached
 * list payload from undoing a click.
 *
 * Cleared only by a reload, which is correct: a reload refetches every list
 * from the server, so nothing stale survives to be arbitrated against.
 */
const accountWriteAt = new Map();

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
export function writeServerFollowState(
  queryClient,
  username,
  isFollowing,
  generatedAt,
) {
  if (!username || typeof isFollowing !== 'boolean') return;
  if (toggleRegistry.isPending(followEntityKey(username))) return;

  /**
   * A payload may only overwrite the viewer's own change to this account if it
   * can PROVE it is newer than that change.
   *
   * This is the bug that survived two earlier attempts, and it needs no
   * network request to happen -- it is a remount. `ProfileRightSidebar` lives
   * inside `ProfilePage`, so opening someone's profile unmounts and remounts
   * it. On mount, two seeds fire from the CACHED recommendation rows:
   * `seedFollowStateFromList`, and `FollowButton`'s `initialFollowing` effect.
   * Those rows were generated before the follow -- the server excludes
   * already-followed accounts, so the row still says `isFollowing: false` --
   * and both wrote that `false` straight over the `true` the click had
   * produced. Traced live: one `true` from the mutation, then four `false`
   * writes from the two seeds, with zero fetches in between.
   *
   * Seeding is a READING of the graph, never a change to it, so a reading
   * taken before the change cannot outrank it. A caller that holds a real
   * timestamp (`dataUpdatedAt` on the query that produced the payload) passes
   * it and wins whenever the data genuinely is newer -- which is what lets a
   * post-follow refetch still correct the client.
   *
   * Callers with no timestamp are trusted only for accounts the viewer has not
   * touched this session. That keeps first paint working everywhere while
   * making the viewer's own action authoritative for the account they acted
   * on.
   */
  const changedAt = accountWriteAt.get(String(username).toLowerCase());
  if (changedAt !== undefined) {
    const provablyNewer =
      typeof generatedAt === 'number' && generatedAt > changedAt;
    if (!provablyNewer) return;
  }

  queryClient.setQueryData(followStateKey(username), isFollowing);
}

/**
 * Write state the SERVER just confirmed for an action the viewer took -- the
 * follow/unfollow response. Authoritative by construction, because it is the
 * write, so it bypasses the arbitration above and re-stamps the clock: any
 * payload still in flight from before this moment now loses to it too.
 */
export function writeConfirmedFollowState(queryClient, username, isFollowing) {
  if (!username || typeof isFollowing !== 'boolean') return;
  markFollowGraphChanged(username);
  queryClient.setQueryData(followStateKey(username), isFollowing);
}

/**
 * Record that the viewer changed the graph. Called only for their own actions
 * — seeding state from a list payload is not a change, it is a reading of one.
 */
export function markFollowGraphChanged(username) {
  lastFollowGraphWriteAt = Date.now();
  if (username) accountWriteAt.set(String(username).toLowerCase(), Date.now());
}

/**
 * Write the state a click just asked for. Always wins — this is the user's
 * current intent, and it is what makes the button change on the same frame.
 */
export function writeOptimisticFollowState(queryClient, username, isFollowing) {
  if (!username || typeof isFollowing !== 'boolean') return;
  markFollowGraphChanged(username);
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
export function seedFollowStateFromList(queryClient, users, generatedAt) {
  if (!Array.isArray(users)) return;
  for (const u of users) {
    if (u?.username && typeof u.isFollowing === 'boolean') {
      writeServerFollowState(queryClient, u.username, u.isFollowing, generatedAt);
    }
  }
}
