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
const TIMEOUT_MS = 10_000;

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
    const binary = atob(response.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: String(type).split(';')[0] });
  } catch {
    return null;
  }
}
