import Skeleton from '@shared/components/skeletons/Skeleton';
import styles from './CommunityList.module.css';

/** Placeholder rows sized like CommunityRow, so the list does not jump. */
export default function CommunityRowSkeleton({ count = 4 }) {
  return (
    <div className={styles.list} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.skeletonRow}>
          <div className={styles.skeletonHead}>
            <span className={styles.skeletonAvatar}>
              <Skeleton type="rect" width="100%" height="100%" style={{ borderRadius: 'var(--community-avatar-radius)', margin: 0 }} />
            </span>
            <div className={styles.skeletonBody}>
              <Skeleton type="text" width="45%" height="0.95rem" style={{ margin: 0 }} />
              <Skeleton type="text" width="25%" height="0.75rem" style={{ margin: 0 }} />
            </div>
          </div>
          <Skeleton type="text" width="85%" height="0.8rem" style={{ margin: 0 }} />
        </div>
      ))}
    </div>
  );
}
