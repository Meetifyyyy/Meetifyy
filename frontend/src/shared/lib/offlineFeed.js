/**
 * The seam between the feed (shared code) and the installed app's offline
 * store for it (mobile/feedSnapshot.js, mobile/offlineFeedMedia.js).
 *
 * Shared code only ever calls the two functions below. On the website nothing
 * registers, so `notePostViewed` does nothing and `offlineMediaUrl` returns the
 * URL it was given: no feed or media is kept on a machine that may be shared.
 */

let viewedListener = null;
let mediaResolver = null;

/** The app's store registers here (mobile entry only). */
export function setOfflineFeedStore({ onViewed, resolveMedia } = {}) {
  viewedListener = typeof onViewed === 'function' ? onViewed : null;
  mediaResolver = typeof resolveMedia === 'function' ? resolveMedia : null;
}

/**
 * A Home post has really been looked at (see useViewedPosts): its id and the
 * row it is drawn in, from which the media it showed are read.
 */
export function notePostViewed(postId, rowEl) {
  if (!viewedListener || !postId) return;
  try { viewedListener(postId, rowEl); } catch { /* never breaks the feed */ }
}

/**
 * The URL to load for `url`: offline, the stored copy of a picture or video a
 * kept post showed (a blob: URL); otherwise `url` itself, untouched.
 */
export function offlineMediaUrl(url) {
  if (!mediaResolver || !url || typeof url !== 'string') return url;
  try { return mediaResolver(url) || url; } catch { return url; }
}
