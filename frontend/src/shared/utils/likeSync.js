/**
 * Like/unlike state for posts and comments: instant on screen, ordered on the
 * server, and immune to responses and realtime events arriving out of order.
 *
 * WHAT WENT WRONG BEFORE
 * Likes went through the generic toggle hook: debounce, then on a newer tap
 * abort the request in flight and send another. Three things broke under rapid
 * tapping:
 *
 *  1. Aborting a fetch does not un-send it. The server usually had the first
 *     request already, so like and unlike were both processed — by whichever
 *     replica got them, in whichever order they landed. The server could end
 *     up liked while the screen said unliked.
 *  2. Every settled toggle refetched the whole post. A tap made while that
 *     refetch was in flight was overwritten by its older snapshot: the count
 *     went 3 → 2 → 4 as the snapshot and then the next optimistic step landed.
 *  3. Realtime counts from other people were dropped while a toggle was
 *     pending and never re-applied, and nothing ordered two events against
 *     each other, so a late event could carry an older count over a newer one.
 *
 * THE MODEL
 * Per post or comment, this keeps the last state the SERVER confirmed
 * (`server`: liked, count, version) and what the person wants (`desired`).
 * What is shown is always derived from the two:
 *
 *     shown.liked = desired
 *     shown.count = server.count + (desired ? 1 : 0) − (server.liked ? 1 : 0)
 *
 * so the number can never drift from arithmetic on an arithmetic.
 *
 *  - A tap flips `desired` and repaints at once. No debounce: the first tap's
 *    request goes immediately.
 *  - At most ONE request per entity is in flight. Taps during it only move
 *    `desired`; when it returns, one follow-up is sent if `desired` still
 *    differs from what the server now says, otherwise nothing. Requests reach
 *    the server in the order the person made them, and like → unlike → like
 *    collapses to the single request already sent.
 *  - The server stamps every change with a `version` taken under the row lock
 *    (see likeVersion in posts.service.ts). Anything older than what has been
 *    applied — a late response, a late event — is dropped.
 *  - Nothing refetches. The response carries the authoritative count.
 *  - A remote change (someone else's like) moves `server.count`; the person's
 *    pending intent is preserved on top of it.
 *  - After settling, the entry stays for a short grace period so a list or
 *    post refetch that STARTED before the last write cannot paint its older
 *    snapshot over the confirmed state.
 */

/** How long a settled entry keeps overriding fetched snapshots. */
const SETTLE_GRACE_MS = 5000;
/** Bound on the per-entity "newest version seen" memory. */
const VERSION_MEMORY_MAX = 2000;

/** key → entry; key is e.g. `post:<id>` or `comment:<id>`. */
const entries = new Map();
/** key → newest version applied, kept after the entry is gone. */
const versions = new Map();

function rememberVersion(key, version) {
  if (typeof version !== 'number') return;
  versions.delete(key);
  versions.set(key, version);
  if (versions.size > VERSION_MEMORY_MAX) {
    versions.delete(versions.keys().next().value);
  }
}

function newestVersion(key) {
  return versions.get(key) ?? 0;
}

function shownOf(entry) {
  const { server, desired } = entry;
  const count = server.count + (desired ? 1 : 0) - (server.liked ? 1 : 0);
  return { liked: desired, count: Math.max(0, count) };
}

/** Writes the shown state into the caches; components re-render from those. */
function publish(entry) {
  entry.write?.(shownOf(entry));
}

function settle(key, entry) {
  clearTimeout(entry.graceTimer);
  entry.graceTimer = setTimeout(() => {
    if (entries.get(key) === entry && !entry.inFlight && entry.desired === entry.server.liked) {
      entries.delete(key);
    }
  }, SETTLE_GRACE_MS);
}

/**
 * Folds a server answer into the entry when it is not older than what is
 * already applied. A response with no version (an older API) is trusted only
 * because it answers this entity's one in-flight request, which by construction
 * is the newest thing this client sent.
 */
function acceptServer(key, entry, next) {
  if (typeof next.version === 'number') {
    if (next.version < entry.server.version) return false;
    rememberVersion(key, next.version);
  }
  entry.server = {
    liked: next.liked,
    count: Math.max(0, next.count),
    version: typeof next.version === 'number' ? next.version : entry.server.version,
  };
  return true;
}

function pump(key, entry) {
  if (entry.inFlight) return;
  if (entry.desired === entry.server.liked) {
    settle(key, entry);
    return;
  }
  clearTimeout(entry.graceTimer);
  entry.inFlight = true;
  const target = entry.desired;
  const before = entry.server;

  Promise.resolve()
    .then(() => entry.send(target))
    .then((res) => {
      entry.inFlight = false;
      const liked = typeof res?.liked === 'boolean' ? res.liked
        : typeof res?.isLiked === 'boolean' ? res.isLiked
          : target;
      const count = typeof res?.likeCount === 'number' ? res.likeCount
        // An API that does not return the count: the request did what it was
        // asked, so step the confirmed count the same way.
        : before.count + (liked ? 1 : 0) - (before.liked ? 1 : 0);
      acceptServer(key, entry, { liked, count, version: res?.version });
      publish(entry);
      pump(key, entry);
    })
    .catch((err) => {
      entry.inFlight = false;
      // The request failed, so the server is still where it was last
      // confirmed. Go back there, not to "the opposite of the last tap": after
      // like → unlike → like with the second one failing, the confirmed state
      // is the truth, whatever the taps in between were.
      entry.desired = entry.server.liked;
      publish(entry);
      settle(key, entry);
      entry.onError?.(err);
    });
}

/**
 * One tap.
 *
 * @param {string} key entity key, `post:<id>` / `comment:<id>`
 * @param {{ liked: boolean, count: number }} snapshot what the cache shows now;
 *   only used when no toggle for this entity is already being tracked
 * @param {{ send: (liked: boolean) => Promise<object>,
 *           write: (shown: { liked: boolean, count: number }) => void,
 *           onError?: (err: unknown) => void }} io
 * @returns {{ liked: boolean, count: number }} what is now shown
 */
export function toggleLike(key, snapshot, io) {
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      server: { liked: !!snapshot.liked, count: Number(snapshot.count) || 0, version: newestVersion(key) },
      desired: !!snapshot.liked,
      inFlight: false,
      graceTimer: null,
    };
    entries.set(key, entry);
  }
  // The latest callbacks win: they close over the newest render's caches.
  entry.send = io.send;
  entry.write = io.write;
  entry.onError = io.onError;

  entry.desired = !entry.desired;
  publish(entry);
  pump(key, entry);
  return shownOf(entry);
}

/**
 * The state to render for an entity: the tracked state while a toggle is
 * pending or just settled, otherwise whatever the cache says.
 */
export function readLike(key, fallback) {
  const entry = entries.get(key);
  return entry ? shownOf(entry) : fallback;
}

/**
 * A like/unlike observed from elsewhere (a realtime event).
 *
 * @param {string} key
 * @param {{ count: number, version?: number, liked?: boolean, byMe?: boolean }} change
 *   `liked` is applied only when `byMe` — another device of the same person.
 *   Someone else's like moves the count and never this person's heart.
 * @returns {{ liked?: boolean, count: number } | null} what to write to the
 *   caches, or null when the change is stale and must be ignored.
 */
export function applyRemoteLike(key, change) {
  if (typeof change?.count !== 'number') return null;
  const hasVersion = typeof change.version === 'number';
  if (hasVersion && change.version <= newestVersion(key)) return null;

  const entry = entries.get(key);
  if (!entry) {
    if (hasVersion) rememberVersion(key, change.version);
    return {
      count: Math.max(0, change.count),
      ...(change.byMe && typeof change.liked === 'boolean' ? { liked: change.liked } : {}),
    };
  }

  // With something pending and no way to order this event, it is safer to
  // ignore it: the pending request's own response will carry the truth.
  if (!hasVersion) return null;

  acceptServer(key, entry, {
    liked: change.byMe && typeof change.liked === 'boolean' ? change.liked : entry.server.liked,
    count: change.count,
    version: change.version,
  });
  if (change.byMe && !entry.inFlight && entry.desired !== entry.server.liked) {
    // The other device moved the server to the opposite of this one's last
    // tap and nothing here is pending: that device's action is the newer one.
    entry.desired = entry.server.liked;
  }
  const shown = shownOf(entry);
  if (!entry.inFlight) settle(key, entry);
  return shown;
}

/** For tests: forget everything. */
export function __resetLikeSync() {
  entries.forEach((e) => clearTimeout(e.graceTimer));
  entries.clear();
  versions.clear();
}
