import styles from './CommunityCard.module.css';
import Skeleton from '@shared/components/Skeleton';

export default function CommunityCardSkeleton() {
  return (
    <div className={styles.card} style={{ pointerEvents: 'none' }}>
      <div className={styles.cardHeader}>
        <div className={styles.cardAvatar} style={{ border: 'none', background: 'transparent', display: 'block' }}>
          <Skeleton type="circle" width="40px" height="40px" />
        </div>
        <Skeleton type="text" width="40%" height="1.1rem" style={{ margin: 0 }} />
        <Skeleton type="rect" width="60px" height="28px" style={{ borderRadius: '100px', flexShrink: 0, marginLeft: 'auto' }} />
      </div>
      <div style={{ marginTop: '2px' }}>
        <Skeleton type="text" width="95%" height="0.8rem" style={{ margin: '4px 0 0 0' }} />
        <Skeleton type="text" width="75%" height="0.8rem" style={{ margin: '4px 0 0 0' }} />
      </div>
    </div>
  );
}
