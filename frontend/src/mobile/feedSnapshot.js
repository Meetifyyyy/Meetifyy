/**
 * The Home posts the person last looked at, kept on the device and shown at
 * launch, online or not.
 *
 * WHAT IS KEPT
 * Two things, each the whole post as the feed had it (author name and avatar,
 * text, media details and every counter; comments are not kept):
 *
 *  - The feed's first page as last fetched, up to 20 posts, viewed or not.
 *    This is what a launch paints: a full Home rather than only the one or
 *    two posts the person happened to dwell on last time (2026-11-11: a phone
 *    that had only looked at the top post opened on a single post).
 *  - Beyond that page, up to 15 posts that were actually viewed
 *    (useViewedPosts: on screen long enough to be read), most recent first,
 *    so what was read further down is still there offline.
 *
 * The pictures a VIEWED post showed (avatar, images, video thumbnails, never
 * video files) are stored by offlineFeedMedia.js so they draw without a
 * network. A first-page post that was never on screen has no stored pictures:
 * online they load as usual, offline it shows without them.
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
import { feedQueryOptions, FEED_PAGE_SIZE, FEED_STALE_MS } from '../features/feed/utils/feedQuery';
import { setOfflineFeedStore } from '../shared/lib/offlineFeed';
import { isStorableUrl, keepFeedMedia, resolveOfflineMedia } from './offlineFeedMedia';

export const FEED_SNAPSHOT_KEY = 'meetifyy_feed_snapshot_v1';

/** Older than this, the kept posts are too stale to be worth painting. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** The most recently viewed posts kept beyond the first page. */
export const MAX_KEPT_POSTS = 15;
/** The first page is kept whole. */
export const MAX_PAGE_POSTS = FEED_PAGE_SIZE;

/** What is saved: the first page in feed order, then the viewed posts beyond it. */
function entriesToKeep(kept) {
  const all = [...kept.values()];
  const page = all.filter((k) => k.page).sort((a, b) => a.order - b.order).slice(0, MAX_PAGE_POSTS);
  const viewed = all.filter((k) => !k.page).sort((a, b) => b.viewedAt - a.viewedAt).slice(0, MAX_KEPT_POSTS);
  return [...page, ...viewed];
}

function read(storage) {
  try {
    const snap = JSON.parse(storage.getItem(FEED_SNAPSHOT_KEY) || 'null');
    // Only this shape; an older one (a fetched page) is ignored and replaced.
    return snap && snap.version === 2 && Array.isArray(snap.kept) ? snap : null;
  } catch {
    return null;
  }
}

/** Kept posts in the order the feed showed them: the first page, then what was viewed below it. */
function inFeedOrder(kept) {
  const byOrder = (a, b) => a.order - b.order;
  return [
    ...kept.filter((k) => k.page).sort(byOrder),
    ...kept.filter((k) => !k.page).sort(byOrder),
  ].map((k) => k.post);
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
  // Always stale, so the launch refetches behind it rather than trusting it
  // as fresh. No cursor: a restored page must not pretend to know where page
  // two starts.
  //
  // Not simply "when it was saved": viewing a post saves again, and the top
  // post is viewed on every launch, so `savedAt` is usually seconds before the
  // app was closed. Reopened within the feed's stale time, the kept posts
  // counted as a fresh feed: nothing was fetched at launch or on mount, and
  // with no cursor nothing could be paged in either. Home sat on the one or
  // two posts last looked at until it was pulled to refresh (seen on the
  // I2208, 2026-11-11: one kept post, no feed request in 7 s).
  queryClient.setQueryData(
    queryKey,
    { pages: [{ posts: inFeedOrder(snap.kept), nextCursor: undefined }], pageParams: [undefined] },
    { updatedAt: Math.min(snap.savedAt, now - FEED_STALE_MS - 1) },
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
    const entries = entriesToKeep(kept);
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
      page: before?.page === true,
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
    const pages = event.query.state.data?.pages || [];
    const posts = pages.flatMap((p) => p?.posts || []);
    let changed = false;
    posts.forEach((post, order) => {
      const k = kept.get(String(post?.id));
      if (!k) return;
      kept.set(String(post.id), { ...k, post, order });
      changed = true;
    });
    // The first page, whole. A post that has left it stays only if it was
    // viewed (it then counts among the viewed posts, with their limit).
    const firstPage = (pages[0]?.posts || []).filter((post) => post?.id != null).slice(0, MAX_PAGE_POSTS);
    const onPage = new Set(firstPage.map((post) => String(post.id)));
    for (const [id, k] of [...kept]) {
      if (!k.page || onPage.has(id)) continue;
      if (k.viewedAt) kept.set(id, { ...k, page: false });
      else kept.delete(id);
      changed = true;
    }
    firstPage.forEach((post, order) => {
      const id = String(post.id);
      const k = kept.get(id);
      if (k?.page) return;
      kept.set(id, k ? { ...k, page: true } : { post, viewedAt: 0, order, media: [], page: true });
      changed = true;
    });
    if (changed) scheduleSave();
  });
}
