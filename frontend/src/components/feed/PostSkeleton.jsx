import styles from './Post.module.css';
import Skeleton from '../common/Skeleton';

export default function PostSkeleton() {
  return (
    <div className={styles.post}>
      <div className={styles.postHeader}>
        <Skeleton type="circle" width="42px" height="42px" />
        <div className={styles.postUser} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <Skeleton type="text" width="120px" height="14px" style={{ marginBottom: 0 }} />
          <Skeleton type="text" width="80px" height="10px" style={{ marginBottom: 0 }} />
        </div>
      </div>
      <div className={styles.postBody} style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '1rem' }}>
        <Skeleton type="text" width="100%" height="12px" style={{ marginBottom: 0 }} />
        <Skeleton type="text" width="85%" height="12px" style={{ marginBottom: 0 }} />
        <Skeleton type="text" width="40%" height="12px" style={{ marginBottom: 0 }} />
      </div>
      <div className={styles.postActions} style={{ marginTop: '1rem', gap: '1rem' }}>
        <Skeleton type="rect" width="70px" height="32px" style={{ borderRadius: '16px' }} />
        <Skeleton type="rect" width="90px" height="32px" style={{ borderRadius: '16px' }} />
      </div>
    </div>
  );
}
