import Skeleton from '@shared/components/skeletons/Skeleton';
import PostSkeleton from '@features/feed/components/skeletons/PostSkeleton';
import s from '../../pages/ProfilePage.module.css';

/**
 * Mirrors ProfilePage's loading state:
 * - cover photo + avatar + name + bio + stats + action buttons
 * - 2 post skeletons below
 * Uses the same CSS classes as the real page so layout is pixel-perfect.
 */
export default function ProfilePageSkeleton() {
  return (
    <>
      <main className={`centre centre-wide animate-in ${s.profileMain}`}>
        {/* Centre column */}
        <div className={s.centerColumn}>
          <div className={s.profileCard}>
            {/* Cover photo using coverPhoto class for perfect ratio matching */}
            <div className={s.coverWrap}>
              <Skeleton type="rect" className={s.coverPhoto} style={{ borderRadius: 0 }} />
            </div>
            <div className={s.profileInfo}>
              {/* Responsive avatar wrapper */}
              <div className={s.avatarWrapper}>
                <Skeleton
                  type="circle"
                  width="100%"
                  height="100%"
                  style={{ border: '3px solid var(--color-bg-white)' }}
                />
              </div>

              {/* Name */}
              <Skeleton type="text" width="180px" height="1.6rem" style={{ marginBottom: '0.3rem' }} />
              {/* Username */}
              <Skeleton type="text" width="110px" height="1rem" style={{ marginBottom: '0.8rem' }} />

              {/* Bio line */}
              <Skeleton type="text" width="240px" height="0.9rem" style={{ marginBottom: '1.25rem' }} />

              {/* Interest tags skeleton */}
              <div className={s.tagsScrollWrapper}>
                <div className={s.tagsRow}>
                  <Skeleton type="rect" width="120px" height="28px" style={{ borderRadius: '100px' }} />
                  <Skeleton type="rect" width="150px" height="28px" style={{ borderRadius: '100px' }} />
                  <Skeleton type="rect" width="90px" height="28px" style={{ borderRadius: '100px' }} />
                  <Skeleton type="rect" width="130px" height="28px" style={{ borderRadius: '100px' }} />
                </div>
                <div className={s.tagsRow}>
                  <Skeleton type="rect" width="100px" height="28px" style={{ borderRadius: '100px' }} />
                  <Skeleton type="rect" width="140px" height="28px" style={{ borderRadius: '100px' }} />
                  <Skeleton type="rect" width="110px" height="28px" style={{ borderRadius: '100px' }} />
                </div>
              </div>

              {/* Stats container */}
              <div className={s.statsContainer}>
                <div className={s.statItem}>
                  <Skeleton type="text" width="30px" height="1.6rem" style={{ marginBottom: '0.2rem' }} />
                  <Skeleton type="text" width="45px" height="0.8rem" style={{ margin: 0 }} />
                </div>
                <div className={s.statItem}>
                  <Skeleton type="text" width="30px" height="1.6rem" style={{ marginBottom: '0.2rem' }} />
                  <Skeleton type="text" width="60px" height="0.8rem" style={{ margin: 0 }} />
                </div>
                <div className={s.statItem}>
                  <Skeleton type="text" width="30px" height="1.6rem" style={{ marginBottom: '0.2rem' }} />
                  <Skeleton type="text" width="60px" height="0.8rem" style={{ margin: 0 }} />
                </div>
              </div>

              {/* Action buttons */}
              <div className={s.actionButtons}>
                <Skeleton type="rect" height="36px" style={{ borderRadius: '100px' }} />
                <Skeleton type="rect" height="36px" style={{ borderRadius: '100px' }} />
              </div>
            </div>
          </div>
          <div className={s.postsContainer}>
            <PostSkeleton />
            <PostSkeleton />
          </div>
        </div>

        {/* Right sidebar placeholder — keeps layout stable */}
        <aside className={s.rightSidebar}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <Skeleton type="rect" width="100%" height="220px" style={{ borderRadius: 'var(--radius-lg)' }} />
            <Skeleton type="rect" width="100%" height="160px" style={{ borderRadius: 'var(--radius-lg)' }} />
          </div>
        </aside>
      </main>
    </>
  );
}
