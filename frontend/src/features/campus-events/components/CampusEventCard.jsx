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
 * Modern High-Contrast Campus Event Card.
 * Redesigned to reflect the bold, modern card visual hierarchy of the reference:
 * inset rounded poster with bottom date pill, bold title typography,
 * and host/organizer row with avatar/initial.
 */
export default function CampusEventCard({ event, canManage = false, onEdit, onDelete }) {
  const navigate = useNavigate();
  if (!event) return null;

  const isDraft = event.status === 'DRAFT';
  const badge = isDraft ? STATUS_LABELS.draft : null;

  const thumbKey = event.posterUrl ? deriveThumbnailKey(event.posterUrl) : null;
  const fullSrc = event.posterUrl ? getMediaUrl(event.posterUrl) : '';
  const posterSrc = (thumbKey && mediaCache.getSyncUrl(thumbKey)) || fullSrc;

  const formattedDate = formatCardDateBadge(event.startTime);

  const openDetail = () => navigate(`/campus/events/${event.id}`);

  return (
    <article className={styles.card} onClick={openDetail}>
      <div className={styles.posterContainer}>
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
