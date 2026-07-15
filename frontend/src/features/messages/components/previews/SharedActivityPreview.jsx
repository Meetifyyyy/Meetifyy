import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '@shared/context/DataContext';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import styles from './SharedActivityPreview.module.css';

export function SharedActivityPreview({ activity: passedActivity }) {
  const navigate = useNavigate();
  const { crewActivities } = useData();

  const dbActivity = (crewActivities || []).find(act => act.id === passedActivity?.id) || {};
  const activity = { ...dbActivity, ...passedActivity };
  
  if (!activity || (!activity.id && !activity.title)) return null;

  const activityDate = new Date(activity.date || Date.now());

  return (
    <div className={styles.activityShareCardNew} onClick={() => navigate('/crew/' + activity.id)}>
      {(activity.image || activity.coverImage) && (
        <img src={activity.image || activity.coverImage} loading="lazy" className={styles.activityShareCover} alt="Cover" />
      )}
      <div className={styles.activityShareContentNew}>
        <CalendarIcon date={activity.date} dateLabel={activity.dateLabel} />
        <div className={styles.activityShareInfoNew}>
          <div className={styles.activityShareTitleNew}>
            <span>{activity.title}</span>
          </div>
          <div className={styles.activityShareMetaRowNew}>
            {activity.dateLabel || activityDate.toLocaleDateString()} • {activity.time}
          </div>
          {activity.location && (
            <div className={styles.activityShareMetaRowNew}>
              {activity.location}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
