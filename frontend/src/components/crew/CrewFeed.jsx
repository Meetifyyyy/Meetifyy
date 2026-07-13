import CrewCard from './CrewCard';
import EmptyState from './EmptyState';
import styles from './CrewFeed.module.css';

export default function CrewFeed({ activities, onInvite, onViewProfile, loading, resultCount }) {
  if (loading) {
    return (
      <div className={styles.feed}>
        {[1, 2, 3].map(i => (
          <div key={i} className={styles.skeleton}>
            <div className={styles.skeletonBlock} style={{ width: '75%', height: '20px' }} />
            <div className={styles.skeletonBlock} style={{ width: '45%', height: '14px' }} />
            <div className={styles.skeletonBlock} style={{ width: '55%', height: '14px' }} />
            <div className={styles.skeletonBlock} style={{ width: '60%', height: '14px' }} />
            <div className={styles.skeletonActions}>
              <div className={styles.skeletonBtn} />
              <div className={styles.skeletonBtn} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!activities || activities.length === 0) {
    return (
      <div className={styles.feed}>
        <EmptyState />
      </div>
    );
  }

  return (
    <div className={styles.feed}>
      {resultCount !== undefined && (
        <p className={styles.resultCount}>{resultCount} crew{resultCount !== 1 ? 's' : ''} found</p>
      )}
      {activities.map(activity => (
        <CrewCard
          key={activity.id}
          activity={activity}
          onInvite={onInvite}
          onViewProfile={onViewProfile}
        />
      ))}
    </div>
  );
}
