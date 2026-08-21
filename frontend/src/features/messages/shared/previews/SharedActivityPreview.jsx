import React from 'react';
import { useNavigate } from 'react-router-dom';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import styles from './SharedActivityPreview.module.css';
import { useCachedActivity } from '@shared/hooks/useCrew';
import { getMediaUrl } from '@shared/api/apiClient';

export function SharedActivityPreview({ activity: passedActivity }) {
  const navigate = useNavigate();
  // Enrichment from whatever the client already holds for this activity — no
  // request, and no subscription to the global data hook. This card renders once
  // per shared-activity message, so it previously pulled conversations, users,
  // campus users and communities into every chat bubble, then scanned the public
  // feed list to find one row.
  const cachedActivity = useCachedActivity(passedActivity?.id);
  const activity = { ...(cachedActivity || {}), ...passedActivity };

  if (!activity || (!activity.id && !activity.title)) return null;

  const activityDate = new Date(activity.startDate || activity.date || Date.now());

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (activity?.id) {
      navigate(`/crew/${activity.id}`, { state: { activity, from: 'chat' } });
    }
  };

  const rawCover = activity.image || activity.coverImage;
  const coverSrc = rawCover ? getMediaUrl(rawCover) : '/default_activity.webp';

  return (
    <div className={styles.activityShareCardNew} onClick={handleClick}>
      <div className={styles.activityShareCoverWrapper}>
        <img 
          src={coverSrc} 
          loading="lazy" 
          className={styles.activityShareCover} 
          alt="Activity cover" 
          onError={(e) => { e.target.onerror = null; e.target.src = '/default_activity.webp'; }}
        />
      </div>
      <div className={styles.activityShareContentNew}>
        <CalendarIcon date={activity.startDate || activity.date} dateLabel={activity.dateLabel} />
        <div className={styles.activityShareInfoNew}>
          <div className={styles.activityShareTitleNew}>
            <span>{activity.title || 'Activity'}</span>
          </div>
          <div className={styles.activityShareMetaRowNew}>
            {activity.dateLabel || (isNaN(activityDate.getTime()) ? '' : activityDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))} • {activity.time || 'TBD'}
          </div>
          {activity.location && (
            <div className={styles.activityShareLocationNew}>
              {activity.location}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
