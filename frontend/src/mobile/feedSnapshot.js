/**
 * The Home posts the person last looked at, kept on the device and shown at
 * launch, online or not.
 *
 * WHAT IS KEPT
 * Up to 15 posts, and only posts that were actually viewed (useViewedPosts: on
 * screen long enough to be read), never everything the feed happened to load.
 * Each is the whole post as the feed had it: author name and avatar, text,
 * media details and every counter. Comments are not kept. The pictures it
 * showed (avatar, images, video thumbnails, never video files) are stored by
 * offlineFeedMedia.js so they draw without a network.
 *
 * HOW IT IS USED
 * Put back into the feed query before the first render as stale data, so a
 * launch paints them at once and the feed refetches behind them; the fresh page
 * replaces them only when it arrives (Feed's refresh never empties the list
 * first). Offline, they are simply what Home shows, without an offline notice.
 *
 * Scoped to the account that viewed them, listed in AuthContext's
 * SESSION_SCOPED_KEYS, and cleared by "Clear cached data". Installed app only:
 * this module is reached from the mobile entry, never the website.
 */
import { feedQueryOptions } from '../features/feed/utils/feedQuery';
import { setOfflineFeedStore } from '../shared/lib/offlineFeed';
import { isStorableUrl, keepFeedMedia, resolveOfflineMedia } from './offlineFeedMedia';

export const FEED_SNAPSHOT_KEY = 'meetifyy_feed_snapshot_v1';

/** Older than this, the kept posts are too stale to be worth painting. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** The most recently viewed posts kept. */
export const MAX_KEPT_POSTS = 15;

function read(storage) {
  try {
    const snap = JSON.parse(storage.getItem(FEED_SNAPSHOT_KEY) || 'null');
    // Only this shape; an older one (a fetched page) is ignored and replaced.
    return snap && snap.version === 2 && Array.isArray(snap.kept) ? snap : null;
  } catch {
    return null;
  }
}

/** Kept posts in the order the feed showed them. */
function inFeedOrder(kept) {
  return [...kept].sort((a, b) => a.order - b.order).map((k) => k.post);
}

/**
 * Puts the kept posts back into the cache for `userId`, if there are any.
 * Returns true when it restored something.
 */
export function restoreFeedSnapshot(queryClient, userId, { storage = window.localStorage, now = Date.now() } = {}) {
  if (!userId) return false;
  const snap = read(storage);
  if (!snap || snap.userId !== userId || !snap.kept.length) return false;
  if (typeof snap.savedAt !== 'number' || now - snap.savedAt > MAX_AGE_MS) return false;

  const { queryKey } = feedQueryOptions('', userId);
  if (queryClient.getQueryData(queryKey)) return false;
  // `updatedAt` is when it was saved, so the query counts it stale and
  // refetches on first use rather than trusting it as fresh. No cursor: a
  // restored page must not pretend to know where page two starts.
  queryClient.setQueryData(
    queryKey,
    { pages: [{ posts: inFeedOrder(snap.kept), nextCursor: undefined }], pageParams: [undefined] },
    { updatedAt: snap.savedAt },
  );
  return true;
}

/**
 * Keeps the viewed posts up to date: records each view (from the feed, through
 * shared/lib/offlineFeed), refreshes the kept copies whenever the feed fetches
 * (so counters are current), stores their pictures, and saves at idle time.
 *
 * The account comes from the feed's own query key (`['feed', '', userId]`), so
 * this can be started at every launch, signed in or not. Returns an
 * unsubscribe function.
 */
export function persistFeedSnapshot(queryClient, userId = null, { storage = window.localStorage } = {}) {
  /** The account a Home feed key belongs to, or null for any other query. */
  const ownerOf = (queryKey) => {
    if (!Array.isArray(queryKey) || queryKey.length !== 3) return null;
    const [root, search, owner] = queryKey;
    if (root !== 'feed' || search !== '' || !owner) return null;
    return userId && owner !== userId ? null : owner;
  };

  /** The Home feed query currently in the cache (one account at a time). */
  const homeFeed = () => queryClient.getQueryCache().findAll({ queryKey: ['feed', ''] })
    .find((q) => ownerOf(q.queryKey));

  /** id -> { post, viewedAt, order, media: string[] }, for `owner`. */
  let owner = null;
  let kept = new Map();
  const load = (forOwner) => {
    if (owner === forOwner) return;
    owner = forOwner;
    kept = new Map();
    const snap = read(storage);
    if (snap && snap.userId === forOwner) {
      for (const k of snap.kept) kept.set(String(k.post.id), k);
    }
  };

  let scheduled = false;
  const save = () => {
    scheduled = false;
    if (!owner) return;
    // A sign-out in between has cleared the cache: nothing to save.
    if (!homeFeed()) return;
    const entries = [...kept.values()]
      .sort((a, b) => b.viewedAt - a.viewedAt)
      .slice(0, MAX_KEPT_POSTS);
    kept = new Map(entries.map((k) => [String(k.post.id), k]));
    try {
      storage.setItem(FEED_SNAPSHOT_KEY, JSON.stringify({
        version: 2,
        userId: owner,
        savedAt: Date.now(),
        kept: entries,
      }));
    } catch {
      // Quota or disabled storage: the next launch simply has nothing saved.
    }
    void keepFeedMedia(new Set(entries.flatMap((k) => k.media || [])));
  };
  const scheduleSave = () => {
    if (scheduled) return;
    scheduled = true;
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(save, { timeout: 3000 });
    } else {
      setTimeout(save, 500);
    }
  };

  /** Every picture a viewed row drew: avatars, images, video thumbnails. */
  const picturesIn = (rowEl) => {
    if (!rowEl?.querySelectorAll) return [];
    const urls = new Set();
    rowEl.querySelectorAll('img').forEach((img) => {
      const src = img.currentSrc || img.src;
      if (isStorableUrl(src)) urls.add(src);
    });
    // A video's poster, never its file.
    rowEl.querySelectorAll('video[poster]').forEach((v) => {
      if (isStorableUrl(v.poster)) urls.add(v.poster);
    });
    return [...urls];
  };

  const onViewed = (postId, rowEl) => {
    const query = homeFeed();
    if (!query) return;
    load(ownerOf(query.queryKey));
    const posts = (query.state.data?.pages || []).flatMap((p) => p?.posts || []);
    const order = posts.findIndex((p) => String(p?.id) === String(postId));
    if (order < 0) return;
    const before = kept.get(String(postId));
    const media = picturesIn(rowEl);
    kept.set(String(postId), {
      post: posts[order],
      viewedAt: Date.now(),
      order,
      // Offline the row draws stored copies (blob: URLs); keep what it had.
      media: media.length ? media : (before?.media || []),
    });
    scheduleSave();
  };

  setOfflineFeedStore({ onViewed, resolveMedia: resolveOfflineMedia });

  return queryClient.getQueryCache().subscribe((event) => {
    if (event?.type !== 'updated' || event.action?.type !== 'success') return;
    if (event.action.manual) return; // setQueryData, e.g. the restore above
    const forOwner = ownerOf(event.query?.queryKey);
    if (!forOwner) return;
    load(forOwner);
    // Fresh copies of the kept posts (counters, edits), in the new order.
    const posts = (event.query.state.data?.pages || []).flatMap((p) => p?.posts || []);
    let changed = false;
    posts.forEach((post, order) => {
      const k = kept.get(String(post?.id));
      if (!k) return;
      kept.set(String(post.id), { ...k, post, order });
      changed = true;
    });
    if (changed) scheduleSave();
  });
}
