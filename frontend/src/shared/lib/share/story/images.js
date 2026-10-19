/**
 * Loads the pictures a story card draws.
 *
 * Fetched as bytes and decoded with `createImageBitmap`, not assigned to an
 * `<img>`. A cross-origin `<img>` drawn onto a canvas taints it, and a tainted
 * canvas refuses `toBlob` — the old DOM-capture path failed exactly that way
 * whenever a media response lacked CORS headers. Bytes read through `fetch`
 * either arrive (and cannot taint) or the request fails visibly, and the card
 * is drawn without that picture.
 */

// A slow picture must not hold the whole card back: past this it is skipped.
const IMAGE_TIMEOUT_MS = 6_000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
/** Pixel size SVG avatars are rasterised at before drawing. */
const SVG_RASTER = 512;

/** The default byte source: a plain `fetch`, for hosts that send CORS. */
async function fetchBytes(url) {
  const response = await fetch(url, {
    // Media is public; credentials would force a stricter CORS mode.
    credentials: 'omit',
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
  });
  return response.ok ? response.blob() : null;
}

/**
 * Bytes → something drawable. Raster formats decode off the main thread with
 * `createImageBitmap`; SVG (Dicebear avatars) is not accepted there, so it is
 * decoded through an <img> from a same-origin blob: URL, which cannot taint.
 */
async function decode(blob) {
  if (/svg/i.test(blob.type)) {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = await loadElement(objectUrl);
      if (!img) return null;
      // An SVG with only a viewBox has no dependable intrinsic size (it
      // reports 150px or 0), so it is rasterised onto a fixed square first.
      // Every SVG drawn here is an avatar, which is square.
      const raster = document.createElement('canvas');
      raster.width = SVG_RASTER;
      raster.height = SVG_RASTER;
      raster.getContext('2d')?.drawImage(img, 0, 0, SVG_RASTER, SVG_RASTER);
      return raster;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  return createImageBitmap(blob);
}

/**
 * Downloaded bytes, kept for the session (newest last). Opening the story
 * panel twice for the same post, or warming it while the share sheet is still
 * open, then costs no second download. Only successes are kept, so a failed
 * picture is retried; the bound keeps memory small.
 */
const BYTE_CACHE_MAX = 16;
const byteCache = new Map();

function cachedBytes(url, fetcher) {
  const hit = byteCache.get(url);
  if (hit) {
    byteCache.delete(url);
    byteCache.set(url, hit); // most recent
    return hit;
  }
  const pending = Promise.resolve(fetcher(url)).then((blob) => {
    if (!blob?.size) byteCache.delete(url);
    return blob;
  }, (err) => {
    byteCache.delete(url);
    throw err;
  });
  byteCache.set(url, pending);
  while (byteCache.size > BYTE_CACHE_MAX) byteCache.delete(byteCache.keys().next().value);
  return pending;
}

/** Starts the downloads without decoding anything. Safe to call repeatedly. */
export function prefetchStoryImages(urls, fetcher = fetchBytes) {
  [...new Set((urls || []).filter(Boolean))].forEach((url) => {
    cachedBytes(url, fetcher).catch(() => {});
  });
}

async function loadOne(url, fetcher) {
  if (!url) return null;
  try {
    const blob = await cachedBytes(url, fetcher);
    if (!blob?.size || blob.size > MAX_IMAGE_BYTES) return null;
    if (blob.type && !/^image\//i.test(blob.type)) return null;
    return await decode(blob);
  } catch {
    return null;
  }
}

/**
 * Every URL in parallel. `fetcher(url) → Blob | null` is where the bytes
 * come from — the installed app passes its native HTTP fetch, which is not
 * subject to CORS. Resolves to a `Map<url, ImageBitmap | null>`: a
 * picture that could not be loaded is `null`, never a rejection — one missing
 * cover must not cost the whole card.
 */
export async function loadStoryImages(urls, fetcher = fetchBytes) {
  const unique = [...new Set(urls.filter(Boolean))];
  const bitmaps = await Promise.all(unique.map((url) => loadOne(url, fetcher)));
  return new Map(unique.map((url, i) => [url, bitmaps[i]]));
}

/** Decodes an image through an <img>; null if it fails. */
function loadElement(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth ? img : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Releases decoded bitmaps; they hold memory outside the JS heap. */
export function releaseStoryImages(images) {
  images?.forEach((bitmap) => bitmap?.close?.());
}
