import Skeleton from '@shared/components/skeletons/Skeleton';
import styles from './CommunityList.module.css';

/** Placeholder rows sized like CommunityRow, so the list does not jump. */
export default function CommunityRowSkeleton({ count = 4 }) {
  return (
    <div className={styles.list} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.skeletonRow}>
          <Skeleton type="rect" width="52px" height="52px" style={{ borderRadius: '28%', flexShrink: 0, margin: 0 }} />
          <div className={styles.skeletonBody}>
            <Skeleton type="text" width="40%" height="0.95rem" style={{ margin: 0 }} />
            <Skeleton type="text" width="85%" height="0.8rem" style={{ margin: 0 }} />
            <Skeleton type="text" width="30%" height="0.75rem" style={{ margin: 0 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
