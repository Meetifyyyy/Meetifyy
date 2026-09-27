import CalendarIcon from '@shared/components/ui/CalendarIcon';
import { MapPin } from '@shared/components/icons';
import styles from './SharedActivityPreview.module.css';

/** Shared presentation for a chat attachment and the public product preview.
 * Session/cache/media resolution belongs to the caller, not this view. */
export default function ActivityPreviewCard({ activity, coverSrc, fallbackCover, isMe = false, onClick, className = '' }) {
  const activityDate = new Date(activity.startDate || activity.date || Date.now());
  return (
    <div className={`${styles.activityShareCardNew} ${isMe ? styles.activityShareCardMe : styles.activityShareCardThem} ${className}`} onClick={onClick}>
      <div className={styles.activityShareCoverWrapper}>
        <img src={coverSrc} loading="lazy" className={styles.activityShareCover} alt={`${activity.title || 'Activity'} cover`}
          onError={fallbackCover ? (e) => { e.target.onerror = null; e.target.src = fallbackCover; } : undefined} />
      </div>
      <div className={styles.activityShareContentNew}>
        <CalendarIcon date={activity.startDate || activity.date} dateLabel={activity.dateLabel} style={{ border: 'none' }} />
        <div className={styles.activityShareInfoNew}>
          <div className={styles.activityShareTitleNew}><span>{activity.title || 'Activity'}</span></div>
          <div className={styles.activityShareMetaRowNew}>
            {activity.dateLabel || (isNaN(activityDate.getTime()) ? '' : activityDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))} • {activity.time || 'TBD'}
          </div>
          {activity.location && <div className={styles.activityShareLocationNew}><MapPin size={13} className={styles.locIcon} /><span className={styles.locText}>{activity.location}</span></div>}
        </div>
      </div>
    </div>
  );
}
