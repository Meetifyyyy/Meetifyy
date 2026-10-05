/**
 * Thumbnail variants known not to exist, remembered across launches.
 *
 * The grid asks for `<key>_thumb.webp` before the original, and older uploads
 * never got one — or got a database row at presign time for an object that was
 * never written. The bulk signer answers with a URL either way, so every mount
 * of such a post paid an uncacheable 404 (measured ~800 ms on a phone) before
 * falling back to the original, on every launch.
 *
 * A key that 404'd is skipped for a day. Not forever: a post created moments
 * ago can 404 its thumbnail briefly before the upload lands, and the worst a
 * stale entry costs is the original being shown instead of the smaller variant.
 * Bounded, and best-effort: storage that is unavailable just means no memory.
 */
const STORAGE_KEY = 'meetifyy_missing_thumbs_v1';
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 300;

let entries = null; // Map<key, expiresAt>, loaded lazily

function load() {
  if (entries) return entries;
  entries = new Map();
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    const now = Date.now();
    for (const [key, expiresAt] of Object.entries(raw ? JSON.parse(raw) : {})) {
      if (typeof expiresAt === 'number' && expiresAt > now) entries.set(key, expiresAt);
    }
  } catch (_) { /* corrupt or unavailable — start empty */ }
  return entries;
}

function persist() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch (_) { /* quota / disabled — non-fatal */ }
}

/** True when this thumbnail key 404'd recently and should not be requested. */
export function isThumbnailMissing(key) {
  if (!key) return false;
  const map = load();
  const expiresAt = map.get(key);
  if (expiresAt === undefined) return false;
  if (expiresAt > Date.now()) return true;
  map.delete(key);
  return false;
}

/** Records that this thumbnail key did not load. */
export function markThumbnailMissing(key) {
  if (!key) return;
  const map = load();
  map.delete(key);
  map.set(key, Date.now() + TTL_MS);
  while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value);
  persist();
}

/** For tests. */
export function _resetMissingThumbnails() {
  entries = null;
}
