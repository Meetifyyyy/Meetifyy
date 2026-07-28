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
const DB_VERSION = 2;

/** Stores and their per-store config */
const STORES = {
  feed:        { name: 'feed',        ttl: 5  * 60 * 1000 },  // 5 min
  communities: { name: 'communities', ttl: 10 * 60 * 1000 },  // 10 min
  activities:  { name: 'activities',  ttl: 5  * 60 * 1000 },  // 5 min
  profiles:    { name: 'profiles',    ttl: 15 * 60 * 1000 },  // 15 min
  search:      { name: 'search',      ttl: 2  * 60 * 1000 },  // 2 min
  config:      { name: 'config',      ttl: 60 * 60 * 1000 },  // 1 hour
};

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
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
  });
}

/**
 * Write a value to IndexedDB.
 * @param {string} store - One of the STORES keys.
 * @param {string} key - Cache key.
 * @param {*} value - Serializable value.
 */
export async function idbSet(store, key, value) {
  if (!STORES[store]) return;
  try {
    const db = await openDB();
    const config = STORES[store];
    const tx = db.transaction(config.name, 'readwrite');
    tx.objectStore(config.name).put({
      key,
      value,
      storedAt: Date.now(),
      ttl: config.ttl,
    });
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    // IndexedDB unavailable (private browsing, quota exceeded) — silent fail
  }
}

/**
 * Read a value from IndexedDB.
 * Returns `{ value, isStale }`. Both fresh and stale entries are returned
 * so the UI can render immediately while revalidating in the background.
 * Returns `null` if the entry doesn't exist.
 *
 * @param {string} store
 * @param {string} key
 * @returns {Promise<{ value: any, isStale: boolean } | null>}
 */
export async function idbGet(store, key) {
  if (!STORES[store]) return null;
  try {
    const db = await openDB();
    const config = STORES[store];
    const tx = db.transaction(config.name, 'readonly');
    const request = tx.objectStore(config.name).get(key);
    const entry = await new Promise((res, rej) => {
      request.onsuccess = () => res(request.result);
      request.onerror = () => rej(request.error);
    });
    if (!entry) return null;
    const age = Date.now() - entry.storedAt;
    return { value: entry.value, isStale: age > entry.ttl };
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
  } catch {
    // silent
  }
}

/**
 * Clear all stores — called on logout.
 */
export async function idbClearAll() {
  await Promise.allSettled(Object.keys(STORES).map(idbClearStore));
}
