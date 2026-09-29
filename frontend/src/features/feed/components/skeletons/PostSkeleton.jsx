import styles from '../post/Post.module.css';
import Skeleton from '@shared/components/skeletons/Skeleton';

const line = { marginBottom: 0 };

/**
 * A post while it loads: author (avatar + name block), a few lines of text and,
 * optionally, a media block. The action buttons are static chrome, so they are
 * not drawn — their row is reserved as empty space so the card is as tall as
 * the post that replaces it.
 */
export default function PostSkeleton({ media = false }) {
  return (
    <div className={styles.post} aria-hidden="true">
      <div className={styles.postHeader}>
        <Skeleton type="circle" width="40px" height="40px" />
        <div className={styles.postUser} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <Skeleton type="text" width="120px" height="13px" style={line} />
          <Skeleton type="text" width="80px" height="10px" style={line} />
        </div>
      </div>
      <div className={styles.postBody} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <Skeleton type="text" width="100%" height="12px" style={line} />
        <Skeleton type="text" width="85%" height="12px" style={line} />
        <Skeleton type="text" width="40%" height="12px" style={line} />
      </div>
      {media && (
        <Skeleton
          type="rect"
          style={{ display: 'block', aspectRatio: '4 / 3', height: 'auto', borderRadius: 'var(--radius-md)' }}
        />
      )}
      <div style={{ height: '30px', marginTop: '0.5rem' }} />
    </div>
  );
}
