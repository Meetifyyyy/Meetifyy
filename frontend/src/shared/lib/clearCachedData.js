/**
 * "Clear cached data": frees on-device space without signing out and without
 * losing anything the person has not sent.
 *
 * It empties what can be rebuilt from the server:
 *   - the IndexedDB cache (feed, communities, activities, profiles, search,
 *     config, and the installed app's query snapshots);
 *   - cached message history and its sync cursors;
 *   - the signed media URLs;
 *   - the service worker's image cache;
 *   - the installed app's saved Home feed page.
 *
 * It must NOT touch, and does not reach:
 *   - the session or any auth key (this is not a sign-out, see AuthContext);
 *   - unsent messages: the outbox store is never opened for writing, and the
 *     message rows it names are kept so the chat still shows them;
 *   - text drafts (`meetifyy_draft:` keys) and draft photos;
 *   - theme and cookie-consent preferences.
 *
 * The reference for what a sign-out removes is `resetClientStateForNewUser` in
 * AuthContext; this is deliberately a smaller set.
 */
import { idbClearCache } from './idb';
import { idbClearMessageCache } from '../../features/messages/shared/utils/idbMessages';
import { mediaCache } from '@shared/utils/MediaCacheManager';

/**
 * The installed app's saved Home feed page. The same string as
 * `FEED_SNAPSHOT_KEY` in mobile/feedSnapshot.js, repeated here because shared
 * code may not import from mobile/.
 */
const FEED_SNAPSHOT_KEY = 'meetifyy_feed_snapshot_v1';

/** Prefix of the service worker's image caches (see sw.js; the suffix is a version). */
const IMAGE_CACHE_PREFIX = 'meetifyy-images';

/**
 * The signed URLs, in memory and in the persisted index.
 *
 * `clear()` bumps the manager's generation and resolves every caller still
 * waiting on a signing request with nothing, so an image mid-load would come up
 * blank. Only clear when no request is in flight; otherwise leave it. It holds
 * a few kilobytes of strings, so skipping it costs no meaningful space, and
 * stale entries expire by themselves.
 */
function clearMediaUrls() {
  if (!mediaCache.isIdle()) return true;
  mediaCache.clear();
  return true;
}

async function clearImageCaches() {
  if (typeof caches === 'undefined') return true;
  const names = await caches.keys();
  const results = await Promise.all(
    names.filter((n) => n.startsWith(IMAGE_CACHE_PREFIX)).map((n) => caches.delete(n)),
  );
  return results.every((deleted) => deleted !== false);
}

function clearFeedSnapshot() {
  try {
    localStorage.removeItem(FEED_SNAPSHOT_KEY);
  } catch {
    // Storage disabled: nothing was written, so nothing needs removing.
  }
  return true;
}

/**
 * @param {import('@tanstack/react-query').QueryClient} [queryClient]
 * @returns {Promise<{ ok: boolean, failed: string[] }>} `ok` is true when every
 *   step finished; `failed` names the ones that did not.
 */
export async function clearCachedData(queryClient) {
  const steps = {
    cache: idbClearCache,
    messages: idbClearMessageCache,
    mediaUrls: async () => clearMediaUrls(),
    imageCaches: clearImageCaches,
    feedSnapshot: async () => clearFeedSnapshot(),
  };
  const names = Object.keys(steps);
  const results = await Promise.allSettled(names.map((n) => steps[n]()));
  const failed = names.filter((n, i) => results[i].status !== 'fulfilled' || results[i].value === false);

  /**
   * `invalidateQueries()`, not `clear()`.
   *
   * Everything on disk is gone, but the screens in front of the person are
   * still showing data from React Query's memory. `clear()` would remove it
   * and drop every mounted screen to its loading state, discard the
   * optimistic bubbles of messages still being sent, and reset the infinite
   * lists' scroll position. `invalidateQueries()` marks it all stale and
   * refetches only what is on screen, in place, so the screen refreshes
   * rather than blanking; the rest refetches the next time it is opened.
   * (Sign-out is the one place memory must be wiped, and it uses `clear()`.)
   *
   * Not awaited: the summary describes storage, and the button should not
   * spin for as long as the slowest refetch.
   */
  if (queryClient) {
    Promise.resolve(queryClient.invalidateQueries()).catch(() => {});
  }

  return { ok: failed.length === 0, failed };
}

/**
 * Bytes this origin uses on the device (all of it: caches, IndexedDB, and the
 * app's own files for the service worker), or null where the browser cannot
 * say. An estimate, and for the whole origin rather than only what
 * `clearCachedData` frees, so show it as "storage used", not "will be freed".
 */
export async function estimateCacheUsage() {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return typeof estimate?.usage === 'number' ? estimate.usage : null;
  } catch {
    return null;
  }
}
