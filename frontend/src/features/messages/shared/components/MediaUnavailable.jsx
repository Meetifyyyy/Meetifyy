import { useEffect } from 'react';
import { AlertCircle, ImageIcon, Video } from '@shared/components/icons';
import { subscribeOnline } from '@shared/lib/networkStatus';
import styles from './ChatMessageList.module.css';

/**
 * What a chat photo or video shows when it cannot be shown.
 *
 * It takes the media's own box (same wrapper, same aspect ratio), so the
 * thread does not move when a tile fails or recovers. It used to be a fixed
 * card of its own size, and it said "Unavailable" whatever had happened, with
 * no way back: a photo that failed on a dropped connection stayed failed until
 * the chat was reopened.
 *
 * Two kinds of failure, told apart because only one is worth retrying:
 * - `offline` / `load`: the network, or a load that failed after a fresh
 *   signature. Offers Retry, and retries by itself, once, each time the
 *   connection comes back.
 * - `unavailable`: the server would not sign it (deleted, unsent, or no longer
 *   this person's to see). Permanent: no retry, and nothing about the media.
 */
const COPY = {
  image: {
    offline: "Photo couldn't load",
    load: "Photo couldn't load",
    unavailable: 'Photo unavailable',
  },
  video: {
    offline: "Video couldn't load",
    load: "Video couldn't load",
    unavailable: 'Video unavailable',
  },
};

export function isRetryableMediaFailure(failure) {
  return failure === 'offline' || failure === 'load';
}

export default function MediaUnavailable({ kind = 'image', failure = 'unavailable', aspect = 1, isStandalone = false, onRetry }) {
  const retryable = Boolean(onRetry) && isRetryableMediaFailure(failure);
  const label = (COPY[kind] || COPY.image)[failure] || COPY.image.unavailable;

  // Back online: try again by itself. One attempt per reconnection; a failure
  // after it waits for the next one (or a tap), so nothing loops.
  useEffect(() => {
    if (!retryable) return undefined;
    return subscribeOnline((online) => {
      if (online) onRetry();
    });
  }, [retryable, onRetry]);

  const Icon = failure === 'unavailable' ? (kind === 'video' ? Video : ImageIcon) : AlertCircle;

  return (
    <div
      className={`${styles.msgMediaWrapper} ${isStandalone ? styles.msgMediaWrapperStandalone : styles.msgMediaWrapperInline} ${styles.msgMediaUnavailable}`}
      style={{ '--aspect': aspect }}
      role="img"
      aria-label={label}
      data-media-failure={failure}
    >
      <Icon size={22} aria-hidden="true" className={styles.msgMediaUnavailableIcon} />
      <span className={styles.msgMediaUnavailableText}>{label}</span>
      {retryable && (
        <button
          type="button"
          className={styles.msgMediaRetry}
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
