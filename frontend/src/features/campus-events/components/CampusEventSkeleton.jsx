import Skeleton from '@shared/components/skeletons/Skeleton';
import styles from './CampusEvents.module.css';

/** Shimmer placeholder matching the new Event Card layout used while events load. */
export default function CampusEventSkeleton() {
  return (
    <article className={styles.card} aria-hidden="true" style={{ cursor: 'default' }}>
      <div className={styles.posterContainer}>
        <div className={styles.posterWrap}>
          <Skeleton type="rect" width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0, borderRadius: 0 }} />
        </div>
      </div>
      <div className={styles.cardBody}>
        <Skeleton type="text" width="75%" height="22px" style={{ borderRadius: 6, margin: '2px 0 4px' }} />
        <div className={styles.hostRow}>
          <Skeleton type="text" width="40%" height="12px" style={{ borderRadius: 4 }} />
        </div>
      </div>
    </article>
  );
}
