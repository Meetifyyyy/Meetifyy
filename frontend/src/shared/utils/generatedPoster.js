import { useEffect, useRef, useState } from 'react';
import { deriveThumbnailKey } from '@shared/api/apiClient';
import { generateVideoPosterFromUrl, uploadFileDirect } from './mediaPipeline';
import { unmarkThumbnailMissing } from './missingThumbnails';

/**
 * A poster drawn on this device for a stored video that has none.
 *
 * Older uploads can have no `_thumb.webp`, or a black one. Their fallback was a
 * `<video preload="metadata" src="…#t=0.1">`, relying on the browser to paint
 * that frame. Desktop Chrome does; the Android WebView paints nothing, so in
 * the installed app those videos were empty tiles while the website looked
 * fine. Here the frame is drawn from the clip itself (the same capture as a new
 * upload, mediaPipeline's generateVideoPosterFromUrl) and used as the poster.
 *
 * When the viewer owns the video (`repairKey` is its storage key), the frame is
 * also stored as the real `<key>_thumb.webp`, through the same upload a new
 * video's poster takes. The server accepts a variant only from the original's
 * owner, so this repairs the video for every other viewer as well. Anyone
 * else's copy lives only in memory for this session.
 *
 * Drawing a frame downloads the start of the clip and decodes it, so results
 * are kept per video (address without its query: a signed URL changes, the
 * object does not), and at most two are drawn at a time.
 */
const MAX_ENTRIES = 80;
const CONCURRENCY = 2;
const results = new Map(); // key -> Promise<string | null>
const repaired = new Set();
const queue = [];
let running = 0;

const cacheKey = (url) => String(url).split('#')[0].split('?')[0];

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const job = queue.shift();
    running += 1;
    job().finally(() => {
      running -= 1;
      pump();
    });
  }
}

function enqueue(task) {
  return new Promise((resolve) => {
    queue.push(() => task().then(resolve, () => resolve(null)));
    pump();
  });
}

/** Stores the frame as the original's `_thumb.webp`. Best effort, once per key. */
async function repairStoredPoster(originalKey, result) {
  const variantKey = deriveThumbnailKey(originalKey);
  if (!variantKey || repaired.has(variantKey) || !result?.posterBlob) return;
  repaired.add(variantKey);
  const folder = variantKey.split('/')[0];
  try {
    const file = new File([result.posterBlob], 'poster.webp', { type: 'image/webp' });
    await uploadFileDirect(file, folder, null, null, variantKey, { width: result.width, height: result.height });
    unmarkThumbnailMissing(variantKey);
  } catch (_) {
    // Not ours after all, offline, or refused: the local frame still shows.
  }
}

/**
 * A blob: URL of a frame from the video at `videoUrl`, or null when none could
 * be drawn (CORS, an undecodable clip, a genuinely black video).
 */
export function getGeneratedPoster(videoUrl, { repairKey = null } = {}) {
  if (!videoUrl || typeof videoUrl !== 'string' || videoUrl.startsWith('blob:') || videoUrl.startsWith('data:')) {
    return Promise.resolve(null);
  }
  const key = cacheKey(videoUrl);
  const known = results.get(key);
  if (known) return known;
  const job = enqueue(() => generateVideoPosterFromUrl(videoUrl)).then((result) => {
    if (!result?.posterBlob) return null;
    if (repairKey) void repairStoredPoster(repairKey, result); // Fire and forget: display does not wait on it.
    return URL.createObjectURL(result.posterBlob);
  });
  results.set(key, job);
  // Evicted entries are not revoked: an element may still be showing them.
  while (results.size > MAX_ENTRIES) results.delete(results.keys().next().value);
  return job;
}

/**
 * `getGeneratedPoster` as a hook. Does nothing until `enabled` (the caller
 * knows its stored poster is missing or blank).
 */
export function useGeneratedPoster(videoUrl, { enabled = true, repairKey = null } = {}) {
  const [poster, setPoster] = useState(null);
  // Keyed on the object, not the signature: a re-signed URL keeps its frame.
  const key = videoUrl ? cacheKey(videoUrl) : '';
  const urlRef = useRef(videoUrl);
  urlRef.current = videoUrl;
  useEffect(() => {
    setPoster(null);
    const url = urlRef.current;
    if (!enabled || !url) return undefined;
    let live = true;
    void getGeneratedPoster(url, { repairKey }).then((made) => { if (live) setPoster(made); });
    return () => { live = false; };
  }, [key, enabled, repairKey]);
  return poster;
}

/** Sign-out: frames of the last account's (possibly private) videos go. */
export function forgetGeneratedPosters() {
  for (const p of results.values()) {
    void p.then((url) => { if (url) URL.revokeObjectURL(url); });
  }
  results.clear();
  repaired.clear();
  queue.length = 0;
}
