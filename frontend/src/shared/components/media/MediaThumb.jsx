import { useState, useEffect, useRef } from 'react';
import { ImageOff, Play } from '@shared/components/icons';
import { useSignedMediaSrc } from '@shared/hooks/useSignedMediaSrc';
import styles from './MediaThumb.module.css';

/**
 * One square media tile — the shape used by chat galleries and any other
 * grid of previously-shared media.
 *
 * It exists because those grids were rendering `<img src={item.url}>` and
 * `<video src={item.url}>` with the raw value off the message payload. That
 * value is usually a relative `/api/media/<key>` path, which resolves against
 * the page origin rather than the API's, so the browser drew its own
 * broken-image glyph for every picture and an empty black rectangle for every
 * video. MessageBubble had always resolved the same values properly, which is
 * why the identical media rendered fine inside the conversation.
 *
 * What this guarantees:
 *
 *  - The URL goes through `useSignedMediaSrc`, the same pipeline the viewer and
 *    the message bubbles use. Conversation media is therefore NEVER painted from
 *    its unsigned `/api/media/` URL: that request is a 404 in the installed app,
 *    and on the web it is a stable URL the service worker could retain. The tile
 *    shows its skeleton until the signed URL exists.
 *  - A video with no poster resolves its own source the same way, instead of
 *    pointing a <video> at the raw endpoint.
 *  - A video shows its poster frame, not a black box. Chat uploads store a
 *    separate `thumbnailUrl`; without one we ask the browser for metadata only
 *    and seek a fraction of a second in, which is enough to render a frame.
 *  - A failure is a designed state — a muted tile with an icon — never the
 *    browser's broken-image chrome. One delayed retry runs first (it drops the
 *    cached resolution and re-signs, and remounts the element so an unchanged
 *    URL is requested again), since a freshly uploaded object can 404 briefly.
 *  - Resolution is viewport-driven. A tile asks for its URL only when it is near
 *    the screen, so a long gallery does not sign hundreds of keys on mount.
 *    `lazy={false}` opts a handful of always-visible tiles out of that.
 */
const RETRY_DELAY_MS = 700;
const NEAR_VIEWPORT_MARGIN = '400px';


export default function MediaThumb(props) {
  // Keyed by what it shows, so a different source starts from a clean slate —
  // no retry count, ready flag or pending timer carried over from the last one.
  return <MediaThumbTile key={`${props.type || 'image'}|${props.src || ''}|${props.poster || ''}`} {...props} />;
}

function MediaThumbTile({
  src,
  poster,
  type = 'image',
  alt = '',
  onClick,
  className = '',
  rounded = true,
  lazy = true,
  ariaLabel,
}) {
  const isVideo = type === 'video';
  // A video's tile is its poster. Without one, the video itself is loaded far
  // enough to paint a frame.
  const useVideoElement = isVideo && !poster;
  const source = useVideoElement ? src : (isVideo ? poster : src);

  const tileRef = useRef(null);
  const retriesRef = useRef(0);
  const retryTimerRef = useRef(null);

  const [near, setNear] = useState(() => !lazy || typeof IntersectionObserver === 'undefined');
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [mountKey, setMountKey] = useState(0);

  useEffect(() => {
    if (near) return undefined;
    const el = tileRef.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: NEAR_VIEWPORT_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => () => clearTimeout(retryTimerRef.current), []);

  const { src: resolved, failed: signFailed, refresh } = useSignedMediaSrc(near ? source : null);

  const handleError = () => {
    if (retriesRef.current >= 1) {
      setLoadFailed(true);
      return;
    }
    // A just-uploaded object can 404 for a moment, and a signature can lapse:
    // after a short wait, drop the cached resolution and sign again. The element
    // is remounted as well, because an unchanged URL would otherwise never be
    // requested a second time.
    retriesRef.current += 1;
    clearTimeout(retryTimerRef.current);
    retryTimerRef.current = setTimeout(() => {
      refresh();
      setMountKey((n) => n + 1);
    }, RETRY_DELAY_MS);
  };

  const status = (!source || signFailed || loadFailed)
    ? 'error'
    : (ready && resolved ? 'ready' : 'loading');

  // A consumer class owns the sizing and radius when there is one; otherwise the
  // tile falls back to a square that fills its container.
  const classes = [
    styles.tile,
    className || styles.autoSize,
    className ? '' : (rounded ? styles.rounded : ''),
    onClick ? styles.clickable : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={tileRef}
      className={classes}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? ariaLabel : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } } : undefined}
    >
      {status === 'error' ? (
        <div className={styles.unavailable} title="This media is no longer available">
          <ImageOff size={18} aria-hidden="true" />
        </div>
      ) : (
        <>
          {status === 'loading' && <div className={styles.skeleton} aria-hidden="true" />}

          {resolved ? (
            useVideoElement ? (
              <video
                key={mountKey}
                // `#t=0.1` asks the browser to seek a tenth of a second in, so it
                // paints a real frame instead of an empty black element.
                src={`${resolved}#t=0.1`}
                className={styles.media}
                data-visible={status === 'ready' ? 'true' : 'false'}
                preload="metadata"
                muted
                playsInline
                onLoadedData={() => setReady(true)}
                onError={handleError}
              />
            ) : (
              <img
                key={mountKey}
                src={resolved}
                alt={alt}
                loading="lazy"
                decoding="async"
                className={styles.media}
                data-visible={status === 'ready' ? 'true' : 'false'}
                onLoad={() => setReady(true)}
                onError={handleError}
              />
            )
          ) : null}
        </>
      )}

      {isVideo && status !== 'error' && (
        <span className={styles.playBadge} aria-hidden="true">
          <Play size={12} fill="currentColor" />
        </span>
      )}
    </div>
  );
}
