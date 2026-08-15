import { useNavigate } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { getMediaUrl, deriveThumbnailKey } from '@shared/api/apiClient';
import { mediaCache } from '@shared/utils/MediaCacheManager';
import styles from './CampusEvents.module.css';

const STATUS_LABELS = {
  ongoing: { label: 'Live now', cls: styles.statusLive },
  upcoming: { label: 'Upcoming', cls: styles.statusUpcoming },
  past: { label: 'Ended', cls: styles.statusPast },
  draft: { label: 'Draft', cls: styles.statusDraft },
};

/**
 * Poster-forward event card. Kept primarily visual: the poster is the focus,
 * with just title + date. Clicking opens the full Event Details page. The poster
 * is never cropped (object-fit: contain on a neutral frame) and renders the
 * lightweight derived thumbnail, falling back to the original.
 */
export default function CampusEventCard({ event, scope, canManage = false, onEdit, onDelete }) {
  const navigate = useNavigate();
  if (!event) return null;

  const isDraft = event.status === 'DRAFT';
  const badgeKey = isDraft ? 'draft' : scope;
  const badge = (badgeKey !== 'upcoming' && STATUS_LABELS[badgeKey]) || null;

  const thumbKey = event.posterUrl ? deriveThumbnailKey(event.posterUrl) : null;
  const fullSrc = event.posterUrl ? getMediaUrl(event.posterUrl) : '';
  const posterSrc = (thumbKey && mediaCache.getSyncUrl(thumbKey)) || fullSrc;

  const openDetail = () => navigate(`/campus/events/${event.id}`);

  return (
    <article className={styles.card} onClick={openDetail}>
      <div className={styles.posterWrap}>
        {posterSrc ? (
          <img
            className={styles.poster}
            src={posterSrc}
            alt={event.title}
            loading="lazy"
            decoding="async"
            onError={(e) => {
              if (thumbKey) mediaCache.invalidate(thumbKey);
              if (fullSrc && e.currentTarget.src !== fullSrc) {
                e.currentTarget.src = fullSrc;
              } else {
                e.currentTarget.style.display = 'none';
              }
            }}
          />
        ) : (
          <div className={styles.posterFallback}>
            <img src="/icons/tear-off_calendar_color.svg" width={48} height={48} alt="Event" className={styles.fallbackIcon} />
          </div>
        )}

        {badge && <span className={`${styles.statusBadge} ${badge.cls}`}>{badge.label}</span>}

        {canManage && (
          <div className={styles.posterControls}>
            <button
              className={styles.posterIconBtn}
              title="Edit event"
              onClick={(e) => { e.stopPropagation(); onEdit?.(event); }}
            >
              <Pencil size={15} />
            </button>
            <button
              className={`${styles.posterIconBtn} ${styles.danger}`}
              title="Delete event"
              onClick={(e) => { e.stopPropagation(); onDelete?.(event); }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        )}

        <div className={styles.posterOverlay}>
          <h3 className={styles.cardTitle}>{event.title}</h3>
        </div>
      </div>
    </article>
  );
}
