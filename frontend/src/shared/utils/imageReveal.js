/**
 * Whether an image needs a loading state at all.
 *
 * WHY
 * Every image here used to start hidden and fade in when its `load` event fired,
 * behind a skeleton. That is right for a picture crossing the network and wrong
 * for one the WebView already has: it comes from the memory or disk cache a
 * frame or two after it mounts, and the person sees a grey tile flash and a
 * 250-300ms fade for something they were looking at a moment ago. It happens on
 * every return to a screen after a restart, because the app's own "already
 * loaded" sets are plain in-memory sets and start empty.
 *
 * The fix is to ask the image, not a list. An image that is already complete
 * when it mounts, or loads within `FAST_LOAD_MS` of it, was cached: it is shown
 * at once, with no fade, and a skeleton that was waiting for it never appears
 * (the skeleton holds itself invisible for the same window in CSS). One that
 * takes longer was a real download and keeps the fade.
 */

/**
 * An image that loads faster than this was not "loading" as far as a person can
 * tell. The CSS that holds a skeleton or blur layer back uses the same figure
 * (see `.skeleton`, `.avatarSkeleton` and `.placeholder`): keep them in step.
 */
export const FAST_LOAD_MS = 100;

/** img element -> where its current source started loading. */
const started = new WeakMap();

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Starts an `<img>`'s load clock. Safe to call on every render (from a ref
 * callback, say): it only restarts when the element's source has changed.
 */
export function noteImageStart(img) {
  if (!img || typeof img.getAttribute !== 'function') return;
  const src = img.getAttribute('src');
  const record = started.get(img);
  if (!record || record.src !== src) started.set(img, { src, at: now() });
}

/** True when the browser already has the picture (cached, decoded or not). */
export function isImageComplete(img) {
  return Boolean(img && img.complete === true && img.naturalWidth > 0);
}

/**
 * True when `img` arrived fast enough to be shown without a fade.
 *
 * An element whose load was never timed is not assumed fast: it keeps the fade
 * it always had.
 */
export function loadedQuickly(img) {
  if (!img) return false;
  const record = started.get(img);
  if (!record) return false;
  return now() - record.at < FAST_LOAD_MS;
}
