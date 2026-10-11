import styles from '../post/Post.module.css';
import Skeleton from '@shared/components/skeletons/Skeleton';

const line = { marginBottom: 0 };

/**
 * A post on the Home feed while it loads. Deliberately plain: who posted it, a
 * couple of lines and, on some, a picture. The like/comment/share row is static
 * chrome, so it is not drawn - its space is reserved so the card is as tall as
 * the post that replaces it.
 *
 * Home only. The page it belongs to shows this in two places (the route's
 * Suspense fallback and the feed's own first load) and both use this one, so
 * the skeleton does not change shape between them. Other screens keep
 * `PostSkeleton`.
 */
export default function HomePostSkeleton({ media = false }) {
  return (
    <div className={styles.post} aria-hidden="true">
      <div className={styles.postHeader}>
        <Skeleton type="circle" width="40px" height="40px" />
        <div className={styles.postUser} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <Skeleton type="text" width="110px" height="12px" style={line} />
          <Skeleton type="text" width="70px" height="10px" style={line} />
        </div>
      </div>
      <div className={styles.postBody} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <Skeleton type="text" width="100%" height="12px" style={line} />
        <Skeleton type="text" width="62%" height="12px" style={line} />
      </div>
      {media && (
        <Skeleton
          type="rect"
          style={{ display: 'block', aspectRatio: '16 / 10', height: 'auto', borderRadius: 'var(--radius-md)', marginTop: '0.25rem' }}
        />
      )}
      <div style={{ height: '30px', marginTop: '0.5rem' }} />
    </div>
  );
}
