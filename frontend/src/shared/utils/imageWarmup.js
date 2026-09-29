/**
 * Fetches and DECODES an image before a screen needs it, and remembers that it
 * is ready.
 *
 * WHY
 * A cover photo is only known to be needed once its screen has mounted, and
 * then it is fetched, decoded and revealed in front of the user: a blank
 * (skeleton) cover for a couple of hundred milliseconds, then the photo. Every
 * one of those steps can happen earlier — the URL of your own cover is known
 * from sign-in, and anyone else's from the moment their profile is fetched —
 * so the screen can open with the picture already there.
 *
 * `decode()` matters as much as the fetch. `load` fires when the bytes have
 * arrived; the first paint that shows the image still has to decode it on the
 * main thread, which is where the late pop-in of a large photo comes from.
 *
 * The images are retained (a small LRU), because a decoded image an `<img>`
 * can find again is one that something still holds a reference to.
 */

const MAX_RETAINED = 24;

/** url -> HTMLImageElement, oldest first. */
const retained = new Map();
const ready = new Set();
const inFlight = new Map();

/** True once `url` has been fetched and decoded (or never needed to be). */
export function isImageReady(url) {
  if (!url || typeof url !== 'string') return false;
  return url.startsWith('blob:') || url.startsWith('data:') || ready.has(url);
}

/** Records an image the page has itself loaded, so a second view need not wait. */
export function markImageReady(url) {
  if (!url || typeof url !== 'string') return;
  ready.add(url);
}

function retain(url, image) {
  retained.delete(url);
  retained.set(url, image);
  while (retained.size > MAX_RETAINED) {
    const oldest = retained.keys().next().value;
    retained.delete(oldest);
    ready.delete(oldest);
  }
}

/**
 * Starts loading `url` and resolves `true` once it is decoded, `false` if it
 * could not be. Safe to call repeatedly and for the same URL from many places.
 */
export function warmImage(url) {
  if (typeof Image === 'undefined' || !url || typeof url !== 'string') return Promise.resolve(false);
  if (isImageReady(url)) return Promise.resolve(true);
  if (inFlight.has(url)) return inFlight.get(url);

  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  const done = (async () => {
    try {
      // `decode()` rejects for an image that failed to load; there is nothing
      // to warm then, and the screen's own <img> reports the error itself.
      await image.decode();
      ready.add(url);
      retain(url, image);
      return true;
    } catch {
      return false;
    } finally {
      inFlight.delete(url);
    }
  })();
  inFlight.set(url, done);
  return done;
}
