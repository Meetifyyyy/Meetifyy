import Skeleton from '@shared/components/skeletons/Skeleton';
import styles from './CommunityList.module.css';

/** Placeholder rows sized like CommunityRow, so the list does not jump. */
export default function CommunityRowSkeleton({ count = 4 }) {
  return (
    <div className={styles.list} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.skeletonRow}>
          <Skeleton type="rect" width="100%" height="100%" style={{ margin: 0, borderRadius: 'inherit' }} />
        </div>
      ))}
    </div>
  );
}
