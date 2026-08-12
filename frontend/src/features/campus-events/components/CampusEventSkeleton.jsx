import Skeleton from '@shared/components/skeletons/Skeleton';
import styles from './CampusEvents.module.css';

/** Poster-shaped shimmer placeholder used while an event section loads. */
export default function CampusEventSkeleton() {
  return (
    <article className={styles.card} aria-hidden="true" style={{ cursor: 'default' }}>
      <div className={styles.posterWrap}>
        <Skeleton type="rect" width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0, borderRadius: 0 }} />
        <div className={styles.posterOverlay}>
          <Skeleton type="text" width="80%" height="18px" style={{ borderRadius: 6 }} />
          <Skeleton type="text" width="55%" height="14px" style={{ borderRadius: 6, marginTop: 4 }} />
        </div>
      </div>
    </article>
  );
}
