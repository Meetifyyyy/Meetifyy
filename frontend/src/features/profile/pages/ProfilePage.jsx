import { useParams, useNavigate } from 'react-router-dom';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { messagesApi, usersApi, postsApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useR2Upload } from '@shared/hooks/useR2Upload';
import { showToast } from '@shared/utils/toast';
import Post from '@features/feed/components/post/Post';
import UserListModal from '@shared/components/modals/UserListModal';
import { ErrorState } from '@shared/components/ui/StateViews';
import Avatar from '@shared/components/avatar/Avatar';
import s from './ProfilePage.module.css';
import defaultCover from '@assets/images/default_cover.png';
import FollowButton from '@shared/components/ui/FollowButton';
import ProfileRightSidebar from '../components/ProfileRightSidebar';
import ShareProfileModal from '../components/ShareProfileModal';
import ProfilePageSkeleton from '../components/skeletons/ProfilePageSkeleton';
import { createPortal } from 'react-dom';
import ReportModal from '@shared/components/modals/ReportModal/ReportModal';

import { INTERESTS_BY_CATEGORY } from '@features/onboarding/constants/interestsData';

// Build emoji lookup map
const emojiMap = {};
INTERESTS_BY_CATEGORY.forEach(category => {
  category.tags.forEach(tag => {
    emojiMap[tag.label] = tag.emoji;
  });
});


function getSafeCoverUrl(url, fallback) {
  if (!url || typeof url !== 'string') return fallback;
  if (url.startsWith('data:image/')) return url;
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return url;
    }
  } catch {}
  return fallback;
}

export default function ProfilePage() {
  const { profileUsername } = useParams();
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const queryClient = useQueryClient();
  const { username: currentUserUsername, logout, currentUser: authUser, updateProfile } = useAuth();
  const targetUsername = profileUsername || currentUserUsername;

  const [modalType, setModalType] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [showCoverEditor, setShowCoverEditor] = useState(false);
  const [savingCover, setSavingCover] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [hasReported, setHasReported] = useState(false);
  const coverFileRef = useRef(null);
  const menuRef = useRef(null);

  const { upload: uploadCover, uploading: coverUploading } = useR2Upload('covers');

  // Gradient presets for the cover editor
  const GRADIENT_PRESETS = [
    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
    'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  ];

  const handleCoverGradient = useCallback(async (gradient) => {
    setSavingCover(true);
    try {
      await usersApi.updateProfile({ cover: gradient });
      await updateProfile({ cover: gradient });
      queryClient.invalidateQueries(['profile', targetUsername]);
      showToast('Cover updated!');
      setShowCoverEditor(false);
    } catch {
      showToast('Could not update cover.');
    } finally {
      setSavingCover(false);
    }
  }, [queryClient, targetUsername, updateProfile]);

  const handleCoverImageUpload = useCallback(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast('Image too large — max 10 MB.');
      e.target.value = '';
      return;
    }
    setSavingCover(true);
    try {
      const publicUrl = await uploadCover(file);
      await usersApi.updateProfile({ cover: publicUrl });
      await updateProfile({ cover: publicUrl });
      queryClient.invalidateQueries(['profile', targetUsername]);
      showToast('Cover updated!');
      setShowCoverEditor(false);
    } catch {
      showToast('Upload failed.');
    } finally {
      setSavingCover(false);
      e.target.value = '';
    }
  }, [uploadCover, queryClient, targetUsername, updateProfile]);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // Query Profile Data
  const { 
    data: profileUser, 
    isLoading: isLoadingProfile, 
    error: profileError, 
    refetch: refetchProfile 
  } = useQuery({
    queryKey: ['profile', targetUsername],
    queryFn: () => usersApi.getByUsername(targetUsername),
    enabled: !!targetUsername,
  });

  // Query User Posts
  const {
    data: postsData,
    isLoading: isLoadingPosts,
  } = useQuery({
    queryKey: ['user-posts', targetUsername],
    queryFn: () => postsApi.getUserPosts(targetUsername, 20),
    enabled: !!targetUsername,
  });

  if (isLoadingProfile) {
    return <ProfilePageSkeleton />;
  }

  if (profileError || !profileUser) {
    return (
      <main className={`centre centre-wide animate-in ${s.profileMain}`} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <ErrorState onRetry={refetchProfile} />
      </main>
    );
  }

  // Build dynamic user tags list
  const userTags = [];
  const universityName = profileUser.college?.name || profileUser.college || 'University';
  const gradYear = profileUser.graduationYear || '';
  if (universityName || gradYear) {
    userTags.push({ icon: '🎓', label: `${universityName}${gradYear ? ` - ${gradYear}` : ''}` });
  }

  if (profileUser.major) {
    userTags.push({ icon: '🤖', label: profileUser.major });
  }

  if (profileUser.interests && Array.isArray(profileUser.interests)) {
    profileUser.interests.forEach(interest => {
      const emoji = emojiMap[interest] || '✨';
      userTags.push({ icon: emoji, label: interest });
    });
  }

  const posts = postsData?.posts || [];
  const isOwnProfile = profileUser.id === authUser?.id || profileUser.username === currentUserUsername;

  const handleMessageClick = async () => {
    if (isOwnProfile) return;
    try {
      const res = await messagesApi.startConversation([profileUser.id, authUser.id]);
      if (res?.id) {
        navigate(`/messages/${res.id}`);
      } else {
        alert('Failed to start conversation. Please try again.');
      }
    } catch (e) {
      alert('Failed to start conversation: ' + e.message);
    }
  };

  const handlePostClick = (post) => {
    navigate(`/post/${post.id}`, { state: { post, sourceContext: 'profile' } });
  };

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
                style={{ backgroundImage: `url("${encodeURI(getSafeCoverUrl(profileUser.cover, defaultCover))}")` }}
              />
              {/* Own profile — edit cover button */}
              {isOwnProfile && (
                <button
                  className={s.editCoverBtn}
                  onClick={() => setShowCoverEditor(true)}
                  title="Edit cover"
                  aria-label="Edit cover"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                  Edit cover
                </button>
              )}
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
                    <button
                      className={s.dropdownItem}
                      onClick={() => {
                        setMenuOpen(false);
                        if (!hasReported) setShowReportModal(true);
                      }}
                      disabled={hasReported}
                      style={{ color: hasReported ? 'var(--color-text-muted)' : 'var(--color-text-main)' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      {hasReported ? 'Already Reported' : 'Report'}
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
              <div className={s.tagsScrollWrapper}>
                <div className={s.tagsRow}>
                  {userTags.filter((_, idx) => idx % 2 === 0).map((tag, idx) => (
                    <div key={`tag-row1-${idx}`} className={s.tag}>
                      <span>{tag.icon}</span>
                      <span>{tag.label}</span>
                    </div>
                  ))}
                </div>
                <div className={s.tagsRow}>
                  {userTags.filter((_, idx) => idx % 2 !== 0).map((tag, idx) => (
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
                  <span className={s.statNumber}>{profileUser.stats?.posts ?? posts.length}</span>
                  <span className={s.statLabel}>Posts</span>
                </div>
                <div className={s.statItem} onClick={() => setModalType('followers')}>
                  <span className={s.statNumber}>{profileUser.stats?.followers?.toLocaleString?.() ?? profileUser.followersList?.length ?? 0}</span>
                  <span className={s.statLabel}>Followers</span>
                </div>
                <div className={s.statItem} onClick={() => setModalType('following')}>
                  <span className={s.statNumber}>{profileUser.stats?.following?.toLocaleString?.() ?? profileUser.followingList?.length ?? 0}</span>
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
            {!isOwnProfile && !profileUser.isFollowing && (profileUser.settings?.privateProfile || profileUser.isPrivate) ? (
              <div className={s.emptyState} style={{ padding: '3.5rem 1rem' }}>
                <svg className={s.emptyStateIcon} width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <h3 className={s.emptyStateTitle}>This Account is Private</h3>
                <p className={s.emptyStateDesc}>Follow this account to see their posts and updates.</p>
              </div>
            ) : posts.length === 0 ? (
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
          profileUser={profileUser}
          onClose={() => setModalType(null)}
        />
      )}

      <ShareProfileModal
        isOpen={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        profileUser={profileUser}
      />

      {/* Cover editor bottom sheet */}
      {showCoverEditor && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}
          onClick={() => !savingCover && setShowCoverEditor(false)}
        >
          <div
            style={{ background: 'var(--color-bg-white)', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: '520px', padding: '1.5rem 1.5rem 2.5rem', boxShadow: '0 -8px 40px rgba(0,0,0,0.2)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-text-main)' }}>Edit Cover</h3>
              <button onClick={() => setShowCoverEditor(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Gradients</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem', marginBottom: '1.25rem' }}>
              {GRADIENT_PRESETS.map((g, i) => (
                <button
                  key={i}
                  onClick={() => handleCoverGradient(g)}
                  disabled={savingCover}
                  style={{ height: '56px', borderRadius: '10px', background: g, border: '2px solid transparent', cursor: 'pointer', transition: 'transform 0.15s, border-color 0.15s', opacity: savingCover ? 0.5 : 1 }}
                  onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.04)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                />
              ))}
            </div>

            <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Photo</p>
            <input
              ref={coverFileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleCoverImageUpload}
            />
            <button
              onClick={() => coverFileRef.current?.click()}
              disabled={savingCover || coverUploading}
              style={{ width: '100%', padding: '0.85rem', borderRadius: '10px', border: '1.5px dashed var(--color-border)', background: 'var(--color-bg-soft)', cursor: 'pointer', color: 'var(--color-text-muted)', fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
              {(savingCover || coverUploading) ? 'Uploading…' : 'Upload photo'}
            </button>
          </div>
        </div>,
        document.body
      )}

      {profileUser && (
        <ReportModal
          isOpen={showReportModal}
          onClose={() => setShowReportModal(false)}
          targetType="USER"
          targetId={profileUser.id}
          targetName={profileUser.displayName || profileUser.username}
          targetAvatar={profileUser.avatar}
          targetPreview={profileUser.bio}
          reportedFrom="profile"
          onSubmitted={() => setHasReported(true)}
        />
      )}
    </>
  );
}
