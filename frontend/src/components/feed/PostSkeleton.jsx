import styles from './Post.module.css';

export default function PostSkeleton() {
  return (
    <div className={styles.post}>
      <div className={styles.postHeader}>
        <div className={styles.postAvatar} style={{ animation: 'skeletonPulse 1.5s infinite', backgroundColor: 'rgba(24, 24, 27, 0.08)', background: 'none' }}></div>
        <div className={styles.postUser}>
          <div style={{ height: '14px', width: '120px', backgroundColor: 'rgba(24, 24, 27, 0.08)', borderRadius: '4px', marginBottom: '6px', animation: 'skeletonPulse 1.5s infinite' }}></div>
          <div style={{ height: '10px', width: '80px', backgroundColor: 'rgba(24, 24, 27, 0.08)', borderRadius: '4px', animation: 'skeletonPulse 1.5s infinite' }}></div>
        </div>
      </div>
      <div className={styles.postBody}>
        <div style={{ height: '12px', width: '100%', backgroundColor: 'rgba(24, 24, 27, 0.08)', borderRadius: '4px', marginBottom: '8px', animation: 'skeletonPulse 1.5s infinite' }}></div>
        <div style={{ height: '12px', width: '85%', backgroundColor: 'rgba(24, 24, 27, 0.08)', borderRadius: '4px', marginBottom: '8px', animation: 'skeletonPulse 1.5s infinite' }}></div>
        <div style={{ height: '12px', width: '40%', backgroundColor: 'rgba(24, 24, 27, 0.08)', borderRadius: '4px', animation: 'skeletonPulse 1.5s infinite' }}></div>
      </div>
      <div className={styles.postActions}>
        <div style={{ height: '32px', width: '70px', backgroundColor: 'rgba(24, 24, 27, 0.08)', borderRadius: '16px', animation: 'skeletonPulse 1.5s infinite' }}></div>
        <div style={{ height: '32px', width: '90px', backgroundColor: 'rgba(24, 24, 27, 0.08)', borderRadius: '16px', animation: 'skeletonPulse 1.5s infinite' }}></div>
      </div>
    </div>
  );
}
