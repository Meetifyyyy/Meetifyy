import { whenSessionReady, mayHaveCookieSession } from '../shared/api/apiClient';
import { feedQueryOptions } from '../features/feed/utils/feedQuery';
import { idbEpoch, idbGet } from '../shared/lib/idb';
import { restoreFeedSnapshot, persistFeedSnapshot } from './feedSnapshot';

/**
 * Puts the signed-in user's own profile, as last saved on the device, into the
 * query cache before the Profile tab asks for it.
 *
 * The profile screen used to read it from IndexedDB in an effect after it had
 * mounted, so every first visit after a launch showed the profile skeleton for
 * the length of that read (plus the cover and avatar arriving after it) even
 * though the profile was on the device. Read here, at idle, it is already in
 * the cache when the tab opens: the page paints at once and the network answer
 * replaces it in place, as `useProfile` already does for a stale entry (the
 * save time is kept as `updatedAt`, so it counts as stale and is refetched).
 *
 * Only an entry that is complete (it has `stats`, as `useProfile` requires) and
 * belongs to this account, and only into an empty slot: an answer that has
 * already landed is newer.
 */
export function warmOwnProfile(queryClient, user) {
  const username = typeof user?.username === 'string' ? user.username.toLowerCase() : '';
  if (!username || !user?.id) return;
  const key = ['profile', username]; // PROFILE_KEYS.byUsername, without importing the hook module
  const epoch = idbEpoch();
  const load = () => {
    void idbGet('profiles', username)
      .then((cached) => {
        const profile = cached?.value;
        if (!profile?.stats || profile.id !== user.id || epoch !== idbEpoch()) return;
        if (queryClient.getQueryData(key) !== undefined) return;
        queryClient.setQueryData(key, profile, { updatedAt: cached.storedAt });
        // The cover is the slowest part of the page: fetch and decode it now
        // too, as `useProfile` does when it hydrates.
        return import('../shared/components/ui/CoverImage').then((m) => m.warmCover(profile.cover));
      })
      .catch(() => {}); // nothing was warmed; the screen reads it itself
  };
  // After the first screen: this is for the next tab, not the one being drawn.
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(load, { timeout: 3000 });
  } else {
    setTimeout(load, 500);
  }
}

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
  // Keep the snapshot current for whichever account fetches the feed, started
  // before the checks below so a launch that begins signed out still saves one
  // after the sign-in that follows.
  persistFeedSnapshot(queryClient, null, { storage });

  let cachedUser = null;
  try {
    if (storage.getItem('loggedIn') !== 'true') return;
    cachedUser = JSON.parse(storage.getItem('currentUser') || 'null');
  } catch {
    return;
  }
  const cachedUserId = cachedUser?.id ?? null;
  if (!cachedUserId) return;

  // The last feed page from this device, so the first frame shows real posts
  // rather than a skeleton waiting on the network; the prefetch below
  // refreshes it.
  restoreFeedSnapshot(queryClient, cachedUserId, { storage });
  warmOwnProfile(queryClient, cachedUser);

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
