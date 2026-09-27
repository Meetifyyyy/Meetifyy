import { Pencil, Trash2 } from '@shared/components/icons';
import styles from './CampusEvents.module.css';

/** The product's event card view, shared with public example data. */
export default function CampusEventCardView({ event, posterSrc, formattedDate, canManage = false, priority = false, posterHidden = false, onOpen, onPosterError, onEdit, onDelete, className = '' }) {
  const badge = event.status === 'DRAFT' ? { label: 'Draft', cls: styles.statusDraft } : null;
  return (
    <article className={`${styles.card} ${className}`} onClick={onOpen}>
      <div className={styles.posterContainer}>
        <div className={styles.posterWrap}>
          {posterSrc ? (
            <img
              className={styles.poster}
              src={posterSrc}
              alt={event.title}
              loading={priority ? 'eager' : 'lazy'}
              fetchpriority={priority ? 'high' : undefined}
              decoding="async"
              style={posterHidden ? { display: 'none' } : undefined}
              onError={onPosterError}
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
                onClick={onEdit}
              >
                <Pencil size={15} />
              </button>
              <button
                className={`${styles.posterIconBtn} ${styles.danger}`}
                title="Delete event"
                onClick={onDelete}
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
