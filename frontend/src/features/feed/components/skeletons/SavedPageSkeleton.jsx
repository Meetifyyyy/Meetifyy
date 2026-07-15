import Skeleton from '@shared/components/skeletons/Skeleton';
import PostSkeleton from '@features/feed/components/skeletons/PostSkeleton';
import styles from '../../pages/SavedPage.module.css';

/**
 * Mirrors SavedPage layout:
 * - Header with back button + title + view mode toggle
 * - Post skeletons below
 */
export default function SavedPageSkeleton() {
  return (
    <main className="centre animate-in">
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Skeleton type="rect" width="36px" height="36px" style={{ borderRadius: '10px' }} />
          <Skeleton type="text" width="80px" height="18px" style={{ marginBottom: 0 }} />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Skeleton type="rect" width="36px" height="36px" style={{ borderRadius: '10px' }} />
          <Skeleton type="rect" width="36px" height="36px" style={{ borderRadius: '10px' }} />
        </div>
      </header>

      <PostSkeleton />
      <PostSkeleton />
      <PostSkeleton />
    </main>
  );
}
