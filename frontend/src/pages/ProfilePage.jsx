import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useSimulatedFetch } from '../hooks/useSimulatedFetch';
import Post from '../components/feed/Post';
import UserListModal from '../components/common/UserListModal';
import Skeleton from '../components/common/Skeleton';
import PostSkeleton from '../components/feed/PostSkeleton';
import { ErrorState } from '../components/common/StateViews';
import Avatar from '../components/common/Avatar';
import s from './ProfilePage.module.css';
import defaultCover from '../assets/images/default_cover.png';
import FollowButton from '../components/common/FollowButton';
import ProfileRightSidebar from '../components/profile/ProfileRightSidebar';

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
  const { username } = useAuth();
  const { getUserByUsername, currentUser, getUserPosts, startConversation } = useData();

  const targetUsername = profileUsername || username;
  const profileUser = getUserByUsername(targetUsername) || currentUser;

  const { isLoading, data: user, error, retry } = useSimulatedFetch(profileUser, 800, [profileUsername]);

  const [modalType, setModalType] = useState(null);

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
            <div
              className={s.coverPhoto}
              style={{ backgroundImage: `url(${profileUser.cover || defaultCover})` }}
            />
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
                  <button className={s.primaryBtn} onClick={() => {}}>
                    Edit Profile
                  </button>
                  <button className={s.secondaryBtn} onClick={() => {}}>
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
    </>
  );
}
