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
 * The third state. The entry holds `true` (following), `false` (not) or
 * `'requested'` (the account is private and the viewer has a pending request).
 *
 * `true`/`false` are kept as they were so every existing reader and seed keeps
 * working; a payload that only knows `isFollowing` can say "following" or "not
 * following" and never "requested" (see the guard in writeServerFollowState).
 */
export const FOLLOW_REQUESTED = 'requested';

/** A value the entry may hold. Anything else is "I don't know". */
export function isFollowStateValue(value) {
  return typeof value === 'boolean' || value === FOLLOW_REQUESTED;
}

/**
 * Whether the viewer wants the relationship: following, or waiting on a
 * private account to approve. This is the on/off the toggle registry and the
 * serial request queue deal in -- which kind of "on" it is, is the server's
 * (and the account's privacy) to decide.
 */
export function isFollowOn(value) {
  return value === true || value === FOLLOW_REQUESTED;
}

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

/**
 * When the data behind each account's CURRENT entry was generated, as opposed
 * to when it was written.
 *
 * The two differ whenever an entry is filled from data that was already old:
 * a profile rehydrated from IndexedDB is written now but was generated when it
 * was fetched. Comparing a newer answer against the WRITE time rejects any
 * request that started before that write -- including the network answer for
 * the very mount that wrote it. Each record carries the `wroteAt` it was made
 * under, so an entry replaced by something that did not record itself (a direct
 * `setQueryData`) is recognised as unrecorded and falls back to its write time.
 */
const entrySource = new Map();

function recordEntrySource(queryClient, username, generatedAt) {
  const wroteAt = queryClient.getQueryState(followStateKey(username))?.dataUpdatedAt ?? 0;
  entrySource.set(String(username).toLowerCase(), {
    generatedAt: typeof generatedAt === 'number' ? generatedAt : wroteAt,
    wroteAt,
  });
}

/**
 * When the data behind this account's entry was generated (epoch ms), or 0 if
 * there is no entry. Server-derived writes report the time their request
 * started; the viewer's own writes and unstamped ones report the write time.
 */
export function followEntryGeneratedAt(queryClient, username) {
  const wroteAt = queryClient.getQueryState(followStateKey(username))?.dataUpdatedAt ?? 0;
  const source = entrySource.get(String(username).toLowerCase());
  return source && source.wroteAt === wroteAt ? source.generatedAt : wroteAt;
}

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
  if (!username || !isFollowStateValue(isFollowing)) return;
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

  /**
   * A plain `false` does not carry "no pending request": list rows and any
   * payload that predates follow requests say only `isFollowing: false`. So it
   * cannot take the button off Requested unless it was generated after the
   * entry's data was generated. (A profile says `followRequested` explicitly and
   * reaches here as `'requested'` or `false` with a fresh timestamp.)
   */
  if (isFollowing === false && queryClient.getQueryData(followStateKey(username)) === FOLLOW_REQUESTED) {
    const writtenAt = followEntryGeneratedAt(queryClient, username);
    if (!(typeof generatedAt === 'number' && generatedAt > writtenAt)) return;
  }

  queryClient.setQueryData(followStateKey(username), isFollowing);
  recordEntrySource(queryClient, username, generatedAt);
}

/**
 * Write state the SERVER just confirmed for an action the viewer took -- the
 * follow/unfollow response. Authoritative by construction, because it is the
 * write, so it bypasses the arbitration above and re-stamps the clock: any
 * payload still in flight from before this moment now loses to it too.
 */
export function writeConfirmedFollowState(queryClient, username, isFollowing) {
  if (!username || !isFollowStateValue(isFollowing)) return;
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
  if (!username || !isFollowStateValue(isFollowing)) return;
  markFollowGraphChanged(username);
  queryClient.setQueryData(followStateKey(username), isFollowing);
}

/** Current state (`true`, `false` or `'requested'`), or `undefined` when nothing authoritative is known yet. */
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
      const state = !u.isFollowing && u.followRequested === true ? FOLLOW_REQUESTED : u.isFollowing;
      writeServerFollowState(queryClient, u.username, state, generatedAt);
    }
  }
}
