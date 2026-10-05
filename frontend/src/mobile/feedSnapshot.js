/**
 * The last Home feed page, kept on the device and shown at launch.
 *
 * How feed apps open instantly: X keeps the last timeline on disk and shows it
 * while the fresh one loads; Instagram does the same with its feed. Here, the
 * first page the feed last loaded is written to storage, and put back into the
 * query cache before the first render — so a launch paints real posts from
 * local data, and the feed query (stale by construction) refreshes them as soon
 * as the session is renewed.
 *
 * Scoped to the account it was saved for: restored only when the cached user
 * is the same id, and listed in AuthContext's SESSION_SCOPED_KEYS so every
 * sign-out and account switch deletes it. Installed app only — this module is
 * reached from the mobile entry, never from the website, where a shared
 * machine must not show the last person's feed.
 */
import { feedQueryOptions } from '../features/feed/utils/feedQuery';

export const FEED_SNAPSHOT_KEY = 'meetifyy_feed_snapshot_v1';

/** Older than this, a snapshot shows posts too stale to be worth painting. */
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/** Bounded: the first screenful or two is all a launch can show. */
const MAX_POSTS = 12;

/**
 * Puts the saved first page back into the cache for `userId`, if there is one.
 * Returns true when a snapshot was restored.
 */
export function restoreFeedSnapshot(queryClient, userId, { storage = window.localStorage, now = Date.now() } = {}) {
  if (!userId) return false;
  let snap = null;
  try {
    snap = JSON.parse(storage.getItem(FEED_SNAPSHOT_KEY) || 'null');
  } catch {
    return false;
  }
  if (!snap || snap.userId !== userId || !snap.page || !Array.isArray(snap.page.posts)) return false;
  if (typeof snap.savedAt !== 'number' || now - snap.savedAt > MAX_AGE_MS) return false;

  const { queryKey } = feedQueryOptions('', userId);
  if (queryClient.getQueryData(queryKey)) return false;
  // `updatedAt` is when it was really fetched, so the query counts it stale and
  // refetches on first use rather than trusting it as fresh.
  queryClient.setQueryData(
    queryKey,
    { pages: [snap.page], pageParams: [undefined] },
    { updatedAt: snap.savedAt },
  );
  return true;
}

/**
 * Saves the feed's first page whenever it is freshly fetched for `userId`.
 * Writes off the critical path (idle time), and only on a real fetch result —
 * never on the restore above. Returns an unsubscribe function.
 */
export function persistFeedSnapshot(queryClient, userId, { storage = window.localStorage } = {}) {
  if (!userId) return () => {};
  const { queryKey } = feedQueryOptions('', userId);
  const hash = JSON.stringify(queryKey);
  let pending = false;

  const save = () => {
    pending = false;
    const query = queryClient.getQueryCache().find({ queryKey, exact: true });
    const first = query?.state?.data?.pages?.[0];
    if (!first || !Array.isArray(first.posts)) return;
    try {
      storage.setItem(FEED_SNAPSHOT_KEY, JSON.stringify({
        userId,
        savedAt: query.state.dataUpdatedAt || Date.now(),
        // No cursor: a restored page must not pretend to know where page two
        // starts — the refetch that follows a launch supplies the real one.
        page: { ...first, posts: first.posts.slice(0, MAX_POSTS), nextCursor: undefined },
      }));
    } catch {
      // Quota or disabled storage: the next launch simply has no snapshot.
    }
  };

  return queryClient.getQueryCache().subscribe((event) => {
    if (event?.type !== 'updated' || event.action?.type !== 'success') return;
    if (event.action.manual) return; // setQueryData, e.g. the restore above
    if (event.query?.queryHash !== hash || pending) return;
    pending = true;
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(save, { timeout: 3000 });
    } else {
      setTimeout(save, 500);
    }
  });
}
