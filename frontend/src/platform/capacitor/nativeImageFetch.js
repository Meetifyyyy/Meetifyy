import { CapacitorHttp } from '@capacitor/core';

/**
 * Downloads an image through the native HTTP stack and returns it as a Blob.
 *
 * WHY NOT `fetch`
 * The story renderer needs an image's BYTES to draw it without tainting its
 * canvas, and a WebView `fetch` of a cross-origin image only succeeds when
 * the host sends CORS headers. The public media bucket does not, so from the
 * app's `https://localhost` origin every post photo failed and cards were
 * drawn without them. A request made by the native layer is not subject to
 * CORS at all. Used only by the installed app's story renderer.
 */
const TIMEOUT_MS = 6_000;

export async function fetchImageNatively(url) {
  try {
    const response = await CapacitorHttp.get({
      url,
      responseType: 'blob',
      connectTimeout: TIMEOUT_MS,
      readTimeout: TIMEOUT_MS,
    });
    if (response.status < 200 || response.status >= 300 || typeof response.data !== 'string') return null;
    const type =
      Object.entries(response.headers || {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1] || '';
    // The browser's own base64 decoder, at native speed, instead of a
    // character-by-character loop in JS over what can be several megabytes.
    const mime = String(type).split(';')[0] || 'application/octet-stream';
    return await (await fetch(`data:${mime};base64,${response.data}`)).blob();
  } catch {
    return null;
  }
}
