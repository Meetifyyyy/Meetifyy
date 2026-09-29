import { whenSessionReady, mayHaveCookieSession } from '../shared/api/apiClient';
import { feedQueryOptions } from '../features/feed/utils/feedQuery';

/**
 * Starts a returning user's first screen while the session is still being
 * restored, instead of after it.
 *
 * A signed-in cold start used to run strictly in series: read the Keychain,
 * renew the session, probe it, redirect `/` to `/home`, fetch the home route's
 * chunk, and only then ask for the feed. The chunk needs no credential at all,
 * and the feed needs only the one the renewal is already fetching — so both are
 * started here and the probe, the redirect and the chunk overlap them.
 *
 * Nothing here decides who is signed in; that is still AuthContext's alone.
 * The feed request goes through the transport, which holds it until the stored
 * credential is loaded and renewed, so it never goes out without one. If the
 * account that comes back is not the cached one, `adoptUser` resets the query
 * cache and this result is discarded with everything else of theirs. If the
 * session turns out to be dead, the request fails like any other and the app
 * signs out exactly as it would have.
 */
export function warmSignedInLanding(queryClient, { storage = window.localStorage } = {}) {
  let cachedUserId = null;
  try {
    if (storage.getItem('loggedIn') !== 'true') return;
    cachedUserId = JSON.parse(storage.getItem('currentUser') || 'null')?.id ?? null;
  } catch {
    return;
  }
  if (!cachedUserId) return;

  // Same specifier as the route's `lazyRoute`, so it is the same chunk.
  void import('../features/feed/pages/FeedRoute').catch(() => {});

  void Promise.resolve(whenSessionReady())
    .then(() => {
      if (!mayHaveCookieSession()) return undefined;
      // '' is the feed's own default search (see stores/uiStore).
      return queryClient.prefetchInfiniteQuery(feedQueryOptions('', cachedUserId));
    })
    .catch(() => {});
}
