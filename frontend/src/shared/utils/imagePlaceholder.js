/**
 * Low-quality image placeholders (blur-up) for post images.
 *
 * While an image is being compressed for upload we also shrink it to ~16px and
 * encode that as a WebP (JPEG where the browser cannot encode WebP). The data
 * URL travels with the width and height the upload already reports, the server
 * stores it with the media row, and the feed paints it blurred under the real
 * image until that has loaded. ~150-700 bytes, no extra request.
 *
 * The same shape check runs on both ends: the server refuses anything else, and
 * this module refuses it again before a string reaches a CSS `url()`.
 */

/** Longest edge of the placeholder, in pixels. */
export const PLACEHOLDER_EDGE = 16;
/** Must match IMAGE_PLACEHOLDER_MAX_CHARS in the backend. */
export const PLACEHOLDER_MAX_CHARS = 1500;

const DATA_URL = /^data:image\/(?:webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * `value` when it is a placeholder this app would have produced (and the server
 * would accept by shape), otherwise null. Used before anything is painted.
 */
export const safePlaceholder = (value) => (
  typeof value === 'string'
  && value.length <= PLACEHOLDER_MAX_CHARS
  && DATA_URL.test(value)
    ? value
    : null
);

/**
 * The size to draw at: the longest side is `edge`, the other keeps the image's
 * shape, neither is ever below 1. Pure.
 */
export const placeholderSize = (width, height, edge = PLACEHOLDER_EDGE) => {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0)) return null;
  const scale = Math.min(1, edge / Math.max(w, h));
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
};

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

const encode = async (canvas, type, quality) => {
  if (canvas.convertToBlob) {
    const blob = await canvas.convertToBlob({ type, quality });
    // A browser that cannot encode `type` silently returns PNG.
    return blob && blob.type === type ? blobToDataUrl(blob) : null;
  }
  const url = canvas.toDataURL(type, quality);
  return typeof url === 'string' && url.startsWith(`data:${type};`) ? url : null;
};

/** An upload never waits longer than this for its placeholder. */
export const PLACEHOLDER_TIMEOUT_MS = 2000;

// Decoded straight to a small size where the engine supports it, so a large
// original (no thumbnail was made) is never decoded at full resolution just to
// be shrunk to 16px. An engine that rejects the options decodes normally.
const decodeSmall = async (source) => {
  try {
    return await createImageBitmap(source, { resizeWidth: 64, resizeQuality: 'low' });
  } catch (_) {
    return createImageBitmap(source);
  }
};

const build = async (source) => {
  try {
    const bitmap = await decodeSmall(source);
    const size = placeholderSize(bitmap.width, bitmap.height);
    if (!size) {
      if (bitmap.close) bitmap.close();
      return null;
    }
    let canvas;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(size.width, size.height);
    } else {
      canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      if (bitmap.close) bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    if (bitmap.close) bitmap.close();

    // WebP is smallest; JPEG is the fallback where WebP cannot be encoded.
    for (const [type, quality] of [['image/webp', 0.5], ['image/jpeg', 0.4]]) {
      if (type === 'image/jpeg') {
        // JPEG has no alpha: a transparent image would turn black. Fill
        // behind what was drawn instead.
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, size.width, size.height);
      }
      const url = await encode(canvas, type, quality);
      const safe = safePlaceholder(url);
      if (safe) return safe;
    }
    return null;
  } catch (_) {
    return null;
  }
};

/**
 * Builds the placeholder for an image Blob/File, or resolves null.
 *
 * Never throws, and gives up after PLACEHOLDER_TIMEOUT_MS so it can never hold
 * an upload back: a browser without createImageBitmap,
 * a GIF, an undecodable file, or a result over the size cap all give null, and
 * the post simply has no blur-up (it renders as it always has).
 *
 * Pass the already-made thumbnail where there is one: it decodes much faster
 * than the full original.
 */
export const generateImagePlaceholder = async (source) => {
  if (!source || typeof createImageBitmap !== 'function') return null;
  // An animated GIF's first frame is rarely representative, and GIFs get no
  // thumbnail, so this would decode the whole original.
  if (source.type === 'image/gif') return null;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), PLACEHOLDER_TIMEOUT_MS);
  });
  try {
    return await Promise.race([build(source), timeout]);
  } finally {
    clearTimeout(timer);
  }
};
