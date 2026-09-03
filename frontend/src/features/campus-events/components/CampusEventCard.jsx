import { memo, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Trash2 } from '@shared/components/icons';
import { getMediaUrl, deriveThumbnailKey } from '@shared/api/apiClient';
import { mediaCache } from '@shared/utils/MediaCacheManager';
import { formatCardDateBadge } from '../utils/formatEvent';
import styles from './CampusEvents.module.css';

const STATUS_LABELS = {
  draft: { label: 'Draft', cls: styles.statusDraft },
};

/**
 * Poster source for a card, cheapest acceptable variant first.
 *
 * The card paints the poster at ~215-245 CSS px; the stored original is a
 * full-resolution portrait upload. `/api/media/<key>_thumb.webp` answers with
 * the smaller variant when the upload produced one and redirects to the
 * original when it did not, so asking for the thumbnail is never worse than
 * asking for the original — which is what this used to do on every card, since
 * `mediaCache.getSyncUrl` only ever has a URL for media some other screen has
 * already resolved.
 */
function posterSources(posterUrl) {
  if (!posterUrl) return { primary: '', full: '', thumbKey: null };
  const thumbKey = deriveThumbnailKey(posterUrl);
  const full = getMediaUrl(posterUrl);
  if (!thumbKey) return { primary: full, full, thumbKey: null };
  return {
    primary: mediaCache.getSyncUrl(thumbKey) || getMediaUrl(thumbKey),
    full,
    thumbKey,
  };
}

/**
 * Modern High-Contrast Campus Event Card.
 * Redesigned to reflect the bold, modern card visual hierarchy of the reference:
 * inset rounded poster with bottom date pill, bold title typography,
 * and host/organizer row with avatar/initial.
 */
function CampusEventCard({ event, canManage = false, onEdit, onDelete, priority = false }) {
  const navigate = useNavigate();
  // Keyed by the poster it gave up on, so editing an event's picture gets a
  // fresh attempt instead of inheriting the previous one's failure.
  const [failedPoster, setFailedPoster] = useState(null);

  const posterUrl = event?.posterUrl;
  const { primary, full, thumbKey } = useMemo(() => posterSources(posterUrl), [posterUrl]);
  const formattedDate = useMemo(() => formatCardDateBadge(event?.startTime), [event?.startTime]);

  const eventId = event?.id;
  const openDetail = useCallback(() => {
    if (eventId) navigate(`/campus/events/${eventId}`);
  }, [navigate, eventId]);

  const handlePosterError = useCallback((e) => {
    // The thumbnail is the optimistic guess; the original is the answer we can
    // rely on. Falling back once, then giving up, keeps a genuinely missing
    // poster from looping requests.
    if (thumbKey) mediaCache.invalidate(thumbKey);
    if (full && e.currentTarget.src !== full) {
      e.currentTarget.src = full;
    } else {
      setFailedPoster(posterUrl);
    }
  }, [thumbKey, full, posterUrl]);

  const handleEdit = useCallback((e) => { e.stopPropagation(); onEdit?.(event); }, [onEdit, event]);
  const handleDelete = useCallback((e) => { e.stopPropagation(); onDelete?.(event); }, [onDelete, event]);

  if (!event) return null;

  const isDraft = event.status === 'DRAFT';
  const badge = isDraft ? STATUS_LABELS.draft : null;

  return (
    <article className={styles.card} onClick={openDetail}>
      <div className={styles.posterContainer}>
        <div className={styles.posterWrap}>
          {primary ? (
            <img
              className={styles.poster}
              src={primary}
              alt={event.title}
              loading={priority ? 'eager' : 'lazy'}
              fetchpriority={priority ? 'high' : undefined}
              decoding="async"
              style={failedPoster === posterUrl ? { display: 'none' } : undefined}
              onError={handlePosterError}
            />
          ) : (
            <div className={styles.posterFallback}>
              <img src="/icons/tear-off_calendar_color.svg" width={48} height={48} alt="Event" className={styles.fallbackIcon} />
            </div>
          )}

          {badge && (
            <span className={`${styles.statusBadge} ${badge.cls} ${canManage ? styles.statusBadgeWithControls : ''}`}>
              {badge.label}
            </span>
          )}

          {canManage && (
            <div className={styles.posterControls}>
              <button
                className={styles.posterIconBtn}
                title="Edit event"
                onClick={handleEdit}
              >
                <Pencil size={15} />
              </button>
              <button
                className={`${styles.posterIconBtn} ${styles.danger}`}
                title="Delete event"
                onClick={handleDelete}
              >
                <Trash2 size={15} />
              </button>
            </div>
          )}
        </div>

        {formattedDate && (
          <div className={styles.datePill}>
            <svg className={styles.datePillBg} viewBox="0 0 160 36" preserveAspectRatio="none" aria-hidden="true">
              <path d="M 22,0 L 138,0 Q 147,0 152,9 L 156.5,15 Q 160,18 156.5,21 L 152,27 Q 147,36 138,36 L 22,36 Q 13,36 8,27 L 3.5,21 Q 0,18 3.5,15 L 8,9 Q 13,0 22,0 Z" />
            </svg>
            <span className={styles.datePillText}>{formattedDate}</span>
          </div>
        )}
      </div>

      <div className={styles.cardBody}>
        <h3 className={styles.cardTitle} title={event.title}>{event.title}</h3>

        {event.hostedBy && (
          <div className={styles.hostRow}>
            <span className={styles.hostName} title={event.hostedBy}>{event.hostedBy}</span>
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * Memoized: the Campus page re-renders on every menu toggle, modal open and
 * background refetch, and each of those re-rendered every card in the grid.
 * Callers must pass stable `onEdit` / `onDelete`.
 */
export default memo(CampusEventCard);
