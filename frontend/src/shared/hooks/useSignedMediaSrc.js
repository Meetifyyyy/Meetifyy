import { useCallback, useEffect, useRef, useState } from 'react';
import { mediaCache } from '@shared/utils/MediaCacheManager';

/**
 * Resolves a media value to a URL a plain <img> or <video> tag can actually
 * fetch.
 *
 * WHY A TAG CANNOT JUST USE THE STORED VALUE
 * Conversation attachments (`chat/`, `messages/`, `voice/`) are authorized per
 * viewer. The `/api/media/<key>` route does that from the session, which works
 * on the website because the browser attaches the session cookie to the image
 * request by itself. The installed app has no such cookie — the API and the
 * WebView are different sites, so the SameSite=Strict session cookie is never
 * stored, and the app holds a bearer token instead. A media tag has nowhere to
 * put a bearer token, so in the app that URL is always a 404 and every chat
 * image and video failed to load.
 *
 * `mediaCache.getUrl` asks the API to sign the key, over an ordinary
 * authenticated request that CAN carry the token, and gives back a short-lived
 * URL that needs no credential. That is the only form that works in both
 * clients, which is why the viewer resolves through here rather than rendering
 * whatever it was handed.
 *
 * It accepts a bare storage key or an already-resolved `/api/media/<key>` URL —
 * the cache extracts the key either way — so callers that already resolved are
 * safe to pass straight through.
 *
 * THREE STATES, NOT TWO
 * `pending` exists because "not signed yet" and "cannot be signed" look
 * identical from `src` alone — both are an empty string — and a consumer that
 * cannot tell them apart shows its error state for the one or two frames the
 * signing request takes, then takes it back. That flash is the whole reason
 * this returns a flag rather than letting callers test `!src`.
 *
 * @param {string} value storage key, /api/media/ URL, absolute URL, blob: or data:
 * @returns {{ src: string, failed: boolean, pending: boolean, refresh: () => void, attempt: number }}
 *   `failed` is true only once the server has actually declined to sign, which
 *   for a conversation key means the viewer is not a participant or the object
 *   is gone. `refresh` drops the cached URL and signs again — what a retry
 *   button wants, since the usual reason a media URL stops working is that the
 *   signature expired, and re-requesting the same dead URL cannot fix that.
 *
 *   `attempt` counts retries. It exists because a retry does not always change
 *   `src`: a public, blob or already-absolute URL needs no signing, so the same
 *   string comes back and nothing downstream would notice. A consumer that owns
 *   a media element keys it by `attempt`, which is what actually restarts the
 *   element's load pipeline.
 */
export function useSignedMediaSrc(value) {
  // Seeded synchronously so an already-usable value (blob:, data:, a public
  // URL, or one already in the cache) paints on the first frame with no flash.
  const [src, setSrc] = useState(() => initialFor(value));
  // Which value the server declined to sign, not just "something failed": a
  // new value must never inherit the previous one's failure for a render.
  const [failedFor, setFailedFor] = useState(null);
  const [pending, setPending] = useState(() => needsSigning(value));
  const [attempt, setAttempt] = useState(0);

  const valueRef = useRef(value);
  valueRef.current = value;

  const refresh = useCallback(() => {
    const current = valueRef.current;
    if (current) mediaCache.invalidate(current);
    if (needsSigning(current)) {
      /*
       * Drop the stale URL in the same render as the new attempt. Left alone it
       * stays on screen for the one render before the effect below blanks it,
       * and a media element keyed by `attempt` would spend that render fetching
       * the signature that is known to be dead.
       */
      setSrc('');
      setPending(true);
    }
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let alive = true;
    setFailedFor(null);

    // Nothing to resolve: either empty, or already a URL that needs no signing.
    if (!needsSigning(value)) {
      setSrc(initialFor(value));
      setPending(false);
      return undefined;
    }

    // A retry must not reuse what was cached before it; only the first attempt
    // may paint a cached signature straight away.
    const immediate = attempt === 0 ? initialFor(value) : '';
    setSrc(immediate);
    setPending(true);

    mediaCache
      .getUrl(value)
      .then((url) => {
        if (!alive) return;
        if (url) setSrc(url);
        else if (!immediate) setFailedFor(value);
      })
      .catch(() => {
        // Only a failure if there was nothing usable to fall back to.
        if (alive && !immediate) setFailedFor(value);
      })
      .finally(() => {
        if (alive) setPending(false);
      });

    return () => {
      alive = false;
    };
  }, [value, attempt]);

  const failed = failedFor !== null && failedFor === value;
  return { src, failed, pending, refresh, attempt };
}

/** True when the value still has to be exchanged for a fetchable URL. */
function needsSigning(value) {
  if (!value || typeof value !== 'string') return false;
  if (value.startsWith('blob:') || value.startsWith('data:')) return false;
  // Already-signed or public absolute URLs are usable as they are.
  return value !== initialFor(value);
}

/**
 * What can be shown before the network answers.
 *
 * Returns the value itself when it is already fetchable, a cached signed URL
 * when one is in hand, and an empty string when the only honest answer is
 * "wait" — notably for conversation media, where the cache deliberately has no
 * synchronous fallback because the unsigned URL would 404.
 */
function initialFor(value) {
  if (!value || typeof value !== 'string') return '';
  if (value.startsWith('blob:') || value.startsWith('data:')) return value;
  return mediaCache.getSyncUrl(value) || '';
}

export default useSignedMediaSrc;
