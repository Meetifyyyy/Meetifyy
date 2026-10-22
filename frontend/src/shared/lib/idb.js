/**
 * Lightweight IndexedDB wrapper for cross-session persistence.
 *
 * Persistence policy (per user answer):
 *   PERSIST: feed posts (recent), community feed, crew/activity cards, profiles,
 *            community metadata, search history, user preferences, app config.
 *   NO PERSIST: typing indicators, online presence, active chat state,
 *               unread counts, notifications state, temporary drafts.
 *
 * Every entry has a TTL. On read, stale entries are served immediately and
 * flagged so the caller can revalidate in the background (stale-while-revalidate).
 */

const DB_NAME = 'meetifyy_cache';
// 3 added `queries`. An upgrade only creates missing stores, so existing data
// in the others is kept.
const DB_VERSION = 3;

/**
 * Stores and their per-store config.
 *
 * `max` is the most entries a store keeps (see `idbMaintainCache`). Entries are
 * keyed by what a screen asks for, not by anything the user accumulates, so the
 * numbers are a few times what one session touches rather than a quota:
 *   feed 20          one entry per feed variant (home, each filter)
 *   communities 20   the list plus the few detail pages visited
 *   activities 20    likewise for crew/activity cards
 *   profiles 50      the busiest store: every profile opened or hovered, ~1 KB each
 *   search 30        recent queries; their 2 min TTL makes older ones dead weight
 *   config 50        small flags and settings, deliberately the most generous
 *   queries 40       snapshots of the app's main tabs, per account: ~8 queries
 *                    each, so a handful of accounts on one device still fit
 */
const STORES = {
  feed:        { name: 'feed',        ttl: 5  * 60 * 1000,           max: 20 },  // 5 min
  communities: { name: 'communities', ttl: 10 * 60 * 1000,           max: 20 },  // 10 min
  activities:  { name: 'activities',  ttl: 5  * 60 * 1000,           max: 20 },  // 5 min
  profiles:    { name: 'profiles',    ttl: 15 * 60 * 1000,           max: 50 },  // 15 min
  search:      { name: 'search',      ttl: 2  * 60 * 1000,           max: 30 },  // 2 min
  config:      { name: 'config',      ttl: 60 * 60 * 1000,           max: 50 },  // 1 hour
  // First pages of the installed app's main tabs (mobile/querySnapshots.js),
  // keyed by account. Always revalidated on use; the TTL only bounds age.
  queries:     { name: 'queries',     ttl: 3 * 24 * 60 * 60 * 1000,  max: 40 },  // 3 days
};

/**
 * An entry is served stale up to its TTL (stale-while-revalidate), so a TTL of
 * age is the point where it is merely old, not yet useless. Maintenance deletes
 * it only once it is this many TTLs old: long past any chance of being a useful
 * head start, still short enough that nothing lingers for weeks.
 */
const EXPIRY_TTL_MULTIPLE = 3;

let _db = null;
let _opening = null;

/** How long a blocked upgrade is waited for before the open gives up. */
const OPEN_BLOCKED_TIMEOUT_MS = 3000;

/**
 * Bumped whenever the whole cache is emptied (logout, account switch).
 *
 * The queryFns that mirror a response into IndexedDB write AFTER their network
 * await, and `queryClient.clear()` does not abort a fetch that is already in
 * flight. Without this, account A's response landing a moment after A's logout
 * cleared the store wrote A's data straight back, and account B's next mount
 * seeded it (a profile's `isFollowing`, a community's `isJoined`).
 *
 * A caller captures `idbEpoch()` BEFORE it starts the request and hands it to
 * `idbSet`, which drops the write if a clear happened in between. Reads do the
 * same check on their own, so a hydration that resolves after a clear seeds
 * nothing.
 */
let _epoch = 0;

/** The current clear generation. Capture it before the work whose result you will write. */
export function idbEpoch() {
  return _epoch;
}

/**
 * Starts a new clear generation. Shared with the messages cache, so either
 * clear invalidates writes to both; `idbClearAll` calls it synchronously.
 */
export function bumpIdbEpoch() {
  _epoch += 1;
}

function openDB() {
  if (_db) return Promise.resolve(_db);
  // One connection however many callers arrive before the first one resolves.
  if (_opening) return _opening;
  _opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      Object.values(STORES).forEach(({ name }) => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'key' });
        }
      });
    };
    // A tab still running an older bundle holds the previous version open and
    // blocks this upgrade. Give up after a while, so callers fall back to a
    // cache miss instead of hanging (sign-out's clear included); the next call
    // tries again.
    let blockedTimer = null;
    request.onblocked = () => {
      if (blockedTimer) return;
      blockedTimer = setTimeout(() => reject(new Error('IndexedDB open blocked')), OPEN_BLOCKED_TIMEOUT_MS);
    };
    request.onsuccess = (e) => {
      if (blockedTimer) clearTimeout(blockedTimer);
      const db = e.target.result;
      // Another tab wants a newer version: let it, and reopen on next use.
      db.onversionchange = () => {
        db.close();
        if (_db === db) _db = null;
      };
      _db = db;
      resolve(db);
    };
    request.onerror = () => {
      if (blockedTimer) clearTimeout(blockedTimer);
      reject(request.error);
    };
  }).finally(() => {
    _opening = null;
  });
  return _opening;
}

/** Resolves when the transaction has committed, rejects if it failed or aborted. */
function committed(tx) {
  return new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}

/**
 * Write a value to IndexedDB.
 * @param {string} store - One of the STORES keys.
 * @param {string} key - Cache key.
 * @param {*} value - Serializable value.
 * @param {number} [epoch] - `idbEpoch()` captured before the request this value
 *   came from. The write is dropped if the cache was cleared since.
 */
export async function idbSet(store, key, value, epoch) {
  if (!STORES[store]) return;
  if (epoch !== undefined && epoch !== _epoch) return;
  try {
    const db = await openDB();
    // Re-checked after the open: it is the only await before the write.
    if (epoch !== undefined && epoch !== _epoch) return;
    const config = STORES[store];
    const tx = db.transaction(config.name, 'readwrite');
    tx.objectStore(config.name).put({
      key,
      value,
      storedAt: Date.now(),
      ttl: config.ttl,
    });
    await committed(tx);
  } catch {
    // IndexedDB unavailable (private browsing, quota exceeded) — silent fail
  }
}

/**
 * Read a value from IndexedDB.
 * Returns `{ value, isStale, storedAt }`. Both fresh and stale entries are
 * returned so the UI can render immediately while revalidating in the
 * background. Returns `null` if the entry doesn't exist.
 *
 * `storedAt` is when the value was written, and a caller that hands a
 * rehydrated payload to React Query should pass it as `setQueryData`'s
 * `updatedAt`. Without it the entry is timestamped "now" and `staleTime`
 * suppresses the revalidating fetch this cache depends on -- the payload stops
 * being a head start and becomes the answer.
 *
 * @param {string} store
 * @param {string} key
 * @returns {Promise<{ value: any, isStale: boolean, storedAt: number } | null>}
 */
export async function idbGet(store, key) {
  if (!STORES[store]) return null;
  const epoch = _epoch;
  try {
    const db = await openDB();
    const config = STORES[store];
    const tx = db.transaction(config.name, 'readonly');
    const request = tx.objectStore(config.name).get(key);
    const entry = await new Promise((res, rej) => {
      request.onsuccess = () => res(request.result);
      request.onerror = () => rej(request.error);
    });
    // Cleared while the read was in flight: whatever came back belongs to the
    // account that just signed out.
    if (!entry || epoch !== _epoch) return null;
    const age = Date.now() - entry.storedAt;
    return {
      value: entry.value,
      isStale: age > entry.ttl,
      storedAt: entry.storedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Delete a specific key from a store.
 */
export async function idbDelete(store, key) {
  if (!STORES[store]) return;
  try {
    const db = await openDB();
    const config = STORES[store];
    const tx = db.transaction(config.name, 'readwrite');
    tx.objectStore(config.name).delete(key);
    await committed(tx);
  } catch {
    // silent
  }
}

/** Empties one store; rejects if the clear did not commit. */
async function clearStore(store) {
  const db = await openDB();
  const config = STORES[store];
  const tx = db.transaction(config.name, 'readwrite');
  tx.objectStore(config.name).clear();
  await committed(tx);
}

/**
 * Clear ALL data in a given store (e.g., on logout or after a long session).
 */
export async function idbClearStore(store) {
  if (!STORES[store]) return;
  try {
    await clearStore(store);
  } catch {
    // silent
  }
}

/**
 * Clear all stores — called on logout.
 */
export async function idbClearAll() {
  // First, so a write or read already in flight is refused before the clear lands.
  bumpIdbEpoch();
  await Promise.allSettled(Object.keys(STORES).map(idbClearStore));
}

/**
 * Empties every store WITHOUT starting a new clear generation, and says whether
 * every one of them committed.
 *
 * For "free up space" while staying signed in. A new generation is what makes
 * sign-out safe, but it is shared with the outbox: work it has in flight under
 * the old generation (a send waiting on its ACK, a flush mid-request) abandons
 * itself when the generation changes, and an unsent message must not be
 * abandoned to tidy a cache. Nothing here needs it, because a response that
 * lands afterwards belongs to the same account and only refills what was
 * emptied.
 */
export async function idbClearCache() {
  const results = await Promise.allSettled(Object.keys(STORES).map(clearStore));
  return results.every((r) => r.status === 'fulfilled');
}

/** Keys to delete from one store's entries: the expired, then the oldest over `max`. */
function pickEvictions(entries, { ttl, max }, now) {
  const writtenAt = (e) => (typeof e.storedAt === 'number' ? e.storedAt : 0);
  const evict = new Set();
  const live = [];
  for (const e of entries) {
    if (!e) continue;
    if (now - writtenAt(e) > ttl * EXPIRY_TTL_MULTIPLE) evict.add(e.key);
    else live.push(e);
  }
  if (live.length > max) {
    live.sort((a, b) => writtenAt(a) - writtenAt(b)); // least recently written first
    live.slice(0, live.length - max).forEach((e) => evict.add(e.key));
  }
  return [...evict];
}

function maintainStore(db, config, now, epoch) {
  return new Promise((resolve) => {
    const tx = db.transaction(config.name, 'readwrite');
    const store = tx.objectStore(config.name);
    let removed = 0;
    const request = store.getAll();
    request.onsuccess = () => {
      // Signed out while the read was in flight: leave the (now empty) store alone.
      if (epoch !== _epoch) return;
      const victims = pickEvictions(request.result || [], config, now);
      victims.forEach((key) => store.delete(key));
      removed = victims.length;
    };
    tx.oncomplete = () => resolve(removed);
    tx.onerror = () => resolve(0);
    tx.onabort = () => resolve(0);
  });
}

/**
 * Keeps the cache from growing without bound. Deletes entries older than
 * `EXPIRY_TTL_MULTIPLE` TTLs, then trims each store to its `max` entries,
 * least recently written first. Returns how many entries were removed.
 *
 * Each store is read and trimmed inside one transaction, so a write cannot
 * slip between the count and the delete, and a sign-out that lands meanwhile
 * (a new epoch) makes the pass stand down. Never throws: it is housekeeping.
 */
export async function idbMaintainCache(now = Date.now()) {
  const epoch = _epoch;
  try {
    const db = await openDB();
    if (epoch !== _epoch) return 0;
    const counts = await Promise.all(Object.values(STORES).map((c) => maintainStore(db, c, now, epoch)));
    return counts.reduce((a, b) => a + b, 0);
  } catch {
    return 0;
  }
}
