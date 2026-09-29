import Skeleton from '@shared/components/skeletons/Skeleton';
import Avatar from '@shared/components/avatar/Avatar';
import CoverImage from '@shared/components/ui/CoverImage';
import PostSkeleton from '@features/feed/components/skeletons/PostSkeleton';
import panelStyles from '@layout/RightPanel.module.css';
import s from '../../pages/ProfilePage.module.css';

/**
 * ProfilePage while it loads, built from the page's own classes so the real
 * page lands on the same boxes: cover, avatar, name + handle, one bio line,
 * one block for the stats row, then two posts.
 *
 * `user` is the signed-in user when the page is their own profile. Their
 * cover, avatar, name, handle and bio are already known, so those render for
 * real and only the parts that come from the profile request (stats, posts)
 * are placeholders.
 */
export default function ProfilePageSkeleton({ user = null }) {
  const name = user ? (user.displayName || user.name || user.username) : null;

  return (
    <>
      <main className={`centre ${s.profileMain}`} aria-busy="true">
        <div className={s.centerColumn}>
          <div className={s.profileCard}>
            <div className={s.coverWrap}>
              {user ? (
                <CoverImage cover={user.cover} className={s.coverPhoto} />
              ) : (
                <Skeleton type="rect" className={s.coverPhoto} style={{ display: 'block', height: 'auto', borderRadius: 0 }} />
              )}
            </div>
            <div className={s.profileInfo}>
              <div className={s.avatarWrapper}>
                {user ? (
                  <Avatar src={user.avatar} name={name} size="96px" />
                ) : (
                  <Skeleton type="circle" width="100%" height="100%" />
                )}
              </div>

              {user ? (
                <>
                  <h1 className={s.name}>{name}</h1>
                  {user.username && <p className={s.username}>@{user.username}</p>}
                  {user.bio && <p className={s.bio}>{user.bio}</p>}
                </>
              ) : (
                <>
                  {/* Name + handle, then one bio line. */}
                  <Skeleton type="text" width="180px" height="1.6rem" style={{ marginBottom: '0.35rem' }} />
                  <Skeleton type="text" width="110px" height="1rem" style={{ marginBottom: '0.8rem' }} />
                  <Skeleton type="text" width="240px" height="0.9rem" style={{ maxWidth: '100%', marginBottom: '1.25rem' }} />
                </>
              )}

              {/* The stats row: one block, the row's height. */}
              <div className={s.statsContainer}>
                <Skeleton type="rect" width="240px" height="3rem" style={{ maxWidth: '100%' }} />
              </div>

              {/* The action buttons arrive with the profile (they depend on
                  whether you follow this person); hold their row open. */}
              <div className={s.actionButtons} style={{ height: '42px' }} />
            </div>
          </div>
          <div className={s.postsContainer}>
            <PostSkeleton />
            <PostSkeleton />
          </div>
        </div>
      </main>

      {/* Right panel (hidden below 1100px by its own CSS). */}
      <aside className={panelStyles.rightPanel} aria-hidden="true">
        <Skeleton type="rect" height="220px" style={{ display: 'block', borderRadius: 'var(--radius-lg)' }} />
        <Skeleton type="rect" height="160px" style={{ display: 'block', borderRadius: 'var(--radius-lg)' }} />
      </aside>
    </>
  );
}
