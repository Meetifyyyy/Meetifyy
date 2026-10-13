import Skeleton from '@shared/components/skeletons/Skeleton';
import Avatar from '@shared/components/avatar/Avatar';
import CoverImage from '@shared/components/ui/CoverImage';
import panelStyles from '@layout/RightPanel.module.css';
import s from '../../pages/ProfilePage.module.css';
import k from './ProfilePageSkeleton.module.css';

/**
 * ProfilePage while it loads: the outline of the page, not a copy of it.
 *
 * Phones get the card edge to edge (the page's own mobile rules) and post
 * outlines that run full width; wide screens get the card in the centre column
 * and the right panel as two plain blocks. The cover and avatar use the page's
 * own classes so the real page lands on the same boxes.
 *
 * `user` is the signed-in user when the page is their own profile. Their
 * cover, avatar, name and handle are already known, so those render for real.
 */
function PostOutline() {
  return (
    <div className={k.post}>
      <div className={k.postHead}>
        <Skeleton type="circle" width="36px" height="36px" />
        <Skeleton type="text" width="40%" height="0.85rem" />
      </div>
      <Skeleton type="rect" height="140px" style={{ borderRadius: 'var(--radius-md, 12px)' }} />
    </div>
  );
}

export default function ProfilePageSkeleton({ user = null }) {
  const name = user ? (user.displayName || user.name || user.username) : null;

  return (
    <>
      <main className={`centre ${s.profileMain}`} aria-busy="true" aria-label="Loading profile">
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
                </>
              ) : (
                <div className={k.identity}>
                  <Skeleton type="text" width="160px" height="1.4rem" />
                  <Skeleton type="text" width="96px" height="0.9rem" />
                </div>
              )}

              <div className={k.stats}>
                <Skeleton type="text" width="56px" height="2.2rem" />
                <Skeleton type="text" width="56px" height="2.2rem" />
                <Skeleton type="text" width="56px" height="2.2rem" />
              </div>

              <div className={k.actions}>
                <Skeleton type="rect" height="40px" style={{ borderRadius: '999px' }} />
                <Skeleton type="rect" height="40px" style={{ borderRadius: '999px' }} />
              </div>
            </div>
          </div>
          <div className={s.postsContainer}>
            <PostOutline />
            <PostOutline />
          </div>
        </div>
      </main>

      {/* Right panel (hidden below 1100px by its own CSS). */}
      <aside className={panelStyles.rightPanel} aria-hidden="true">
        <Skeleton type="rect" height="200px" style={{ display: 'block', borderRadius: 'var(--radius-lg)' }} />
        <Skeleton type="rect" height="140px" style={{ display: 'block', borderRadius: 'var(--radius-lg)' }} />
      </aside>
    </>
  );
}
