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

/** Stores and their per-store config */
const STORES = {
  feed:        { name: 'feed',        ttl: 5  * 60 * 1000 },  // 5 min
  communities: { name: 'communities', ttl: 10 * 60 * 1000 },  // 10 min
  activities:  { name: 'activities',  ttl: 5  * 60 * 1000 },  // 5 min
  profiles:    { name: 'profiles',    ttl: 15 * 60 * 1000 },  // 15 min
  search:      { name: 'search',      ttl: 2  * 60 * 1000 },  // 2 min
  config:      { name: 'config',      ttl: 60 * 60 * 1000 },  // 1 hour
  // First pages of the installed app's main tabs (mobile/querySnapshots.js),
  // keyed by account. Always revalidated on use; the TTL only bounds age.
  queries:     { name: 'queries',     ttl: 3 * 24 * 60 * 60 * 1000 },  // 3 days
};

let _db = null;
let _opening = null;

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
    request.onsuccess = (e) => {
      _db = e.target.result;
      resolve(_db);
    };
    request.onerror = () => reject(request.error);
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

/**
 * Clear ALL data in a given store (e.g., on logout or after a long session).
 */
export async function idbClearStore(store) {
  if (!STORES[store]) return;
  try {
    const db = await openDB();
    const config = STORES[store];
    const tx = db.transaction(config.name, 'readwrite');
    tx.objectStore(config.name).clear();
    await committed(tx);
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
