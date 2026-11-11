import { useState } from 'react';
import { Image as ImageIcon } from '@shared/components/icons';
import { useOnlineStatus } from '@shared/lib/networkStatus';
import { offlineMediaUrl } from '@shared/lib/offlineFeed';

/**
 * A picture in a shared card (post, event, activity). If it cannot load
 * (offline and not kept, a removed file), the box stays exactly where it was,
 * the same size and shape, with a photo icon in its centre, instead of the
 * card collapsing or showing a broken image.
 *
 * It tries again by itself when the network comes back.
 *
 * `fallbackSrc`, when given, is tried once before giving up (an activity's
 * default cover).
 */
export default function PreviewImage({ src, fallbackSrc, className, style, onError, ...rest }) {
  const [current, setCurrent] = useState(src);
  const [failed, setFailed] = useState(!src);
  const [seen, setSeen] = useState(src);
  if (seen !== src) {
    setSeen(src);
    setCurrent(src);
    setFailed(!src);
  }
  // Back online: a picture that failed (most likely for want of a network)
  // tries again by itself, so the card fills in without a reload.
  const online = useOnlineStatus();
  const [seenOnline, setSeenOnline] = useState(online);
  if (seenOnline !== online) {
    setSeenOnline(online);
    if (online && failed && src) {
      setCurrent(src);
      setFailed(false);
    }
  }

  if (failed) {
    return (
      <div
        className={className}
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-bg-soft, rgba(127, 127, 127, 0.12))',
          color: 'var(--color-text-muted)',
        }}
        role="img"
        aria-label="Photo unavailable"
      >
        <ImageIcon size={26} aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      {...rest}
      // Offline, the stored copy when there is one; looked up on every draw.
      src={offlineMediaUrl(current)}
      className={className}
      style={style}
      onError={(e) => {
        if (fallbackSrc && current !== fallbackSrc) {
          setCurrent(fallbackSrc);
          return;
        }
        setFailed(true);
        onError?.(e);
      }}
    />
  );
}
