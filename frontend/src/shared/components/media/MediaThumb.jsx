import { useState, useEffect, useRef } from 'react';
import { ImageOff, Play } from 'lucide-react';
import { getMediaUrl } from '@shared/api/apiClient';
import { mediaCache } from '@shared/utils/MediaCacheManager';
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
 *  - The URL goes through `mediaCache` (which knows about signed and public
 *    URLs) with `getMediaUrl` as the synchronous fallback, so the first paint
 *    already targets the right origin.
 *  - A video shows its poster frame, not a black box. Chat uploads store a
 *    separate `thumbnailUrl`; without one we ask the browser for metadata only
 *    and seek a fraction of a second in, which is enough to render a frame.
 *  - A failure is a designed state — a muted tile with an icon — never the
 *    browser's broken-image chrome. One retry runs first, since a freshly
 *    uploaded object can 404 briefly.
 */
export default function MediaThumb({
  src,
  poster,
  type = 'image',
  alt = '',
  onClick,
  className = '',
  rounded = true,
}) {
  const isVideo = type === 'video';
  // A video's tile is its poster; the video itself is only loaded far enough to
  // produce one frame.
  const previewSrc = isVideo ? (poster || null) : src;

  const [resolved, setResolved] = useState(() => (previewSrc ? getMediaUrl(previewSrc) : null));
  const [status, setStatus] = useState(previewSrc ? 'loading' : (isVideo ? 'loading' : 'error'));
  const retriedRef = useRef(false);

  useEffect(() => {
    retriedRef.current = false;
    if (!previewSrc) {
      // A video with no poster falls back to a metadata-only <video> below.
      setResolved(null);
      setStatus(isVideo ? 'loading' : 'error');
      return;
    }

    let alive = true;
    setStatus('loading');
    setResolved(getMediaUrl(previewSrc));

    mediaCache.getUrl(previewSrc)
      .then((url) => { if (alive && url) setResolved(url); })
      .catch(() => { /* the synchronous fallback above still stands */ });

    return () => { alive = false; };
  }, [previewSrc, isVideo]);

  const handleError = () => {
    // A just-uploaded object can 404 for a moment; drop the cached resolution
    // and try once more before giving up.
    if (!retriedRef.current && previewSrc) {
      retriedRef.current = true;
      mediaCache.invalidate(previewSrc);
      mediaCache.getUrl(previewSrc)
        .then((url) => setResolved(url || getMediaUrl(previewSrc)))
        .catch(() => setStatus('error'));
      return;
    }
    setStatus('error');
  };

  const videoFallbackSrc = isVideo && !poster && src
    // `#t=0.1` asks the browser to seek a tenth of a second in, so it paints a
    // real frame instead of an empty black element.
    ? `${getMediaUrl(src)}#t=0.1`
    : null;

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
      className={classes}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
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
            <img
              src={resolved}
              alt={alt}
              loading="lazy"
              decoding="async"
              className={styles.media}
              data-visible={status === 'ready' ? 'true' : 'false'}
              onLoad={() => setStatus('ready')}
              onError={handleError}
            />
          ) : videoFallbackSrc ? (
            <video
              src={videoFallbackSrc}
              className={styles.media}
              data-visible={status === 'ready' ? 'true' : 'false'}
              preload="metadata"
              muted
              playsInline
              onLoadedData={() => setStatus('ready')}
              onError={handleError}
            />
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
