import { useParams, useNavigate } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useAuth } from '@shared/context/AuthContext';
import { useData } from '@shared/context/DataContext';
import { useSimulatedFetch } from '@shared/hooks/useSimulatedFetch';
import Post from '@features/feed/components/Post';
import UserListModal from '@shared/components/UserListModal';
import Skeleton from '@shared/components/Skeleton';
import PostSkeleton from '@features/feed/components/PostSkeleton';
import { ErrorState } from '@shared/components/StateViews';
import Avatar from '@shared/components/Avatar';
import s from './ProfilePage.module.css';
import defaultCover from '@assets/images/default_cover.png';
import FollowButton from '@shared/components/FollowButton';
import ProfileRightSidebar from '../components/ProfileRightSidebar';
import ShareProfileModal from '../components/ShareProfileModal';

const tags = [
  { icon: '🎓', label: 'Gla University - Mathura 2029' },
  { icon: '🤖', label: 'Computer Science' },
  { icon: '💖', label: 'Taylor Swift' },
  { icon: '🎤', label: 'Kendrick Lamar' },
  { icon: '🍔', label: 'Free food' },
  { icon: '🏋️', label: 'Fitness' },
  { icon: '🎮', label: 'Gaming' },
  { icon: '🍳', label: 'Cooking' },
  { icon: '👗', label: 'Fashion' },
  { icon: '📚', label: 'Library hangouts' },
  { icon: '🎉', label: 'Campus events' },
  { icon: '🎉', label: 'Sports' },
];

function ProfileSkeleton() {
  return (
    <div className={s.centerColumn}>
      <div className={s.profileCard}>
        <Skeleton type="rect" width="100%" height="180px" style={{ borderRadius: 0 }} />
        <div style={{ padding: '0 1.5rem 1.5rem' }}>
          <Skeleton type="circle" width="96px" height="96px" style={{ marginTop: '-48px', marginBottom: '0.75rem', border: '3px solid var(--color-bg-white)' }} />
          <Skeleton type="text" width="180px" height="1.5rem" style={{ marginBottom: '0.3rem' }} />
          <Skeleton type="text" width="110px" height="1rem" style={{ marginBottom: '1.1rem' }} />
          <div style={{ display: 'flex', gap: '2rem', marginBottom: '1.1rem' }}>
            {[1,2,3].map(i => <Skeleton key={i} type="rect" width="52px" height="36px" style={{ borderRadius: '8px' }} />)}
          </div>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <Skeleton type="rect" width="110px" height="34px" style={{ borderRadius: '100px' }} />
            <Skeleton type="rect" width="90px" height="34px" style={{ borderRadius: '100px' }} />
          </div>
        </div>
      </div>
      <PostSkeleton />
      <PostSkeleton />
    </div>
  );
}

export default function ProfilePage() {
  const { profileUsername } = useParams();
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const { username, logout } = useAuth();
  const { getUserByUsername, currentUser, getUserPosts, startConversation } = useData();

  const targetUsername = profileUsername || username;
  const profileUser = getUserByUsername(targetUsername) || currentUser;

  const { isLoading, data: user, error, retry } = useSimulatedFetch(profileUser, 350, [profileUsername]);

  const [modalType, setModalType] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);



  if (isLoading) {
    return (
      <main className={`centre centre-wide animate-in ${s.profileMain}`}>
        <ProfileSkeleton />
        <ProfileRightSidebar />
      </main>
    );
  }

  if (error) {
    return (
      <main className={`centre centre-wide animate-in ${s.profileMain}`} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <ErrorState onRetry={retry} />
      </main>
    );
  }

  const posts = getUserPosts(profileUser.id);
  const isOwnProfile = profileUser.id === currentUser.id;

  const handleMessageClick = async () => {
    if (isOwnProfile) return;
    const convId = await startConversation(profileUser);
    navigate(`/messages/${convId}`);
  };

  const handlePostClick = (post) => {
    navigate(`/post/${post.id}`, { state: { post, sourceContext: 'profile' } });
  };

  const halfIdx = Math.ceil(tags.length / 2);

  return (
    <>
      <main className={`centre centre-wide animate-in ${s.profileMain}`}>
        {/* ── Center column ── */}
        <div className={s.centerColumn}>

          {/* Profile card */}
          <div className={s.profileCard}>
            <div className={s.coverWrap}>
              <div
                className={s.coverPhoto}
                style={{ backgroundImage: `url(${profileUser.cover || defaultCover})` }}
              />
              <button className={s.mobileBackBtn} onClick={() => goBack('/home')} aria-label="Go back">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
              </button>
              <div className={s.menuWrap} ref={menuRef}>
                <button className={s.mobileMenuBtn} aria-label="More options" onClick={() => setMenuOpen(v => !v)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="1"></circle>
                    <circle cx="12" cy="5" r="1"></circle>
                    <circle cx="12" cy="19" r="1"></circle>
                  </svg>
                </button>
                {menuOpen && (
                  <div className={s.dropdownMenu}>
                    <button className={s.dropdownItem} onClick={() => { setMenuOpen(false); navigate('/settings'); }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                      Settings
                    </button>
                    <button className={s.dropdownItem} onClick={() => { setMenuOpen(false); setShareModalOpen(true); }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                      Share Profile
                    </button>
                    <button className={s.dropdownItem} onClick={() => { setMenuOpen(false); navigate('/saved'); }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                      Saved
                    </button>
                    <button className={s.dropdownItem} onClick={() => setMenuOpen(false)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      Report
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className={s.profileInfo}>
              <div className={s.avatarWrapper}>
                <Avatar
                  src={profileUser.avatar}
                  name={profileUser.displayName || profileUser.name || profileUser.username}
                  size="96px"
                />
              </div>

              <h1 className={s.name}>
                {profileUser.displayName || profileUser.name || profileUser.username}
              </h1>
              <p className={s.username}>@{profileUser.username}</p>
              {profileUser.bio && <p className={s.bio}>{profileUser.bio}</p>}

              {/* Interest tags */}
              {/* Interest tags */}
              <div className={s.tagsScrollWrapper}>
                <div className={s.tagsRow}>
                  {tags.filter((_, idx) => idx % 2 === 0).map((tag, idx) => (
                    <div key={`tag-row1-${idx}`} className={s.tag}>
                      <span>{tag.icon}</span>
                      <span>{tag.label}</span>
                    </div>
                  ))}
                </div>
                <div className={s.tagsRow}>
                  {tags.filter((_, idx) => idx % 2 !== 0).map((tag, idx) => (
                    <div key={`tag-row2-${idx}`} className={s.tag}>
                      <span>{tag.icon}</span>
                      <span>{tag.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stats */}
              <div className={s.statsContainer}>
                <div className={s.statItem} onClick={() => {}}>
                  <span className={s.statNumber}>{posts.length}</span>
                  <span className={s.statLabel}>Posts</span>
                </div>
                <div className={s.statItem} onClick={() => setModalType('followers')}>
                  <span className={s.statNumber}>{profileUser.followers?.toLocaleString?.() ?? profileUser.followersList?.length ?? 0}</span>
                  <span className={s.statLabel}>Followers</span>
                </div>
                <div className={s.statItem} onClick={() => setModalType('following')}>
                  <span className={s.statNumber}>{profileUser.following?.toLocaleString?.() ?? profileUser.followingList?.length ?? 0}</span>
                  <span className={s.statLabel}>Following</span>
                </div>
              </div>

              {/* Action buttons */}
              {!isOwnProfile ? (
                <div className={s.actionButtons}>
                  <FollowButton targetUsername={profileUser.username} />
                  <button className={s.secondaryBtn} onClick={handleMessageClick}>
                    Message
                  </button>
                </div>
              ) : (
                <div className={s.actionButtons}>
                  <button className={s.primaryBtn} onClick={() => navigate('/settings', { state: { panel: 'account' } })}>
                    Edit Profile
                  </button>
                  <button className={s.secondaryBtn} onClick={() => setShareModalOpen(true)}>
                    Share Profile
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Posts */}
          <div className={s.postsContainer}>
            {posts.length === 0 ? (
              <div className={s.emptyState}>
                <svg className={s.emptyStateIcon} width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                <h3 className={s.emptyStateTitle}>No posts yet</h3>
                <p className={s.emptyStateDesc}>
                  {isOwnProfile
                    ? "You haven't posted anything yet."
                    : "This user hasn't shared anything yet."}
                </p>
              </div>
            ) : (
              posts.map((p) => (
                <Post key={p.id} postData={p} onClick={() => handlePostClick(p)} />
              ))
            )}
          </div>
        </div>

        {/* ── Right sidebar ── */}
        <aside className={s.rightSidebar}>
          <ProfileRightSidebar embedded />
        </aside>
      </main>

      {modalType && (
        <UserListModal
          type={modalType}
          profileUsername={targetUsername}
          onClose={() => setModalType(null)}
        />
      )}

      <ShareProfileModal
        isOpen={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        profileUser={profileUser}
      />
    </>
  );
}
