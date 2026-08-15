import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { messagesApi, usersApi, postsApi, getMediaUrl } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useProfile, PROFILE_KEYS } from '@shared/hooks/useProfile';

import { showToast } from '@shared/utils/toast';
import Post from '@features/feed/components/post/Post';
import UserListModal from '@shared/components/modals/UserListModal';
import { ErrorState } from '@shared/components/ui/StateViews';
import Avatar from '@shared/components/avatar/Avatar';
import NotFoundState from '@shared/components/ui/NotFoundState';
import s from './ProfilePage.module.css';
import defaultCover from '@assets/images/default_cover.webp';
import MediaCropper from '@shared/components/media/MediaCropper';
import { processAndUploadImage } from '@shared/utils/mediaPipeline';
import FollowButton from '@shared/components/ui/FollowButton';
import ProfileRightSidebar from '../components/ProfileRightSidebar';
import ShareProfileModal from '../components/ShareProfileModal';
import ProfilePageSkeleton from '../components/skeletons/ProfilePageSkeleton';
import { createPortal } from 'react-dom';
import ReportModal from '@shared/components/modals/ReportModal/ReportModal';
import { getCollegeName } from '@shared/utils/user';

import RightPanel from '@layout/RightPanel';
import { INTERESTS_BY_CATEGORY } from '@features/onboarding/constants/interestsData';

function formatMajor(majorStr) {
  if (!majorStr || typeof majorStr !== 'string') return '';
  const parts = majorStr.split(/\s*-\s*/);
  const uniqueParts = Array.from(new Set(parts.map(p => p.trim()).filter(Boolean)));
  return uniqueParts.join(' - ');
}

function balanceTagsIntoTwoRows(tags) {
  if (!tags || tags.length === 0) return [[], []];
  if (tags.length === 1) return [tags, []];

  const row1 = [];
  const row2 = [];
  let len1 = 0;
  let len2 = 0;

  tags.forEach(tag => {
    const tagLen = (tag.label || '').length + 6;
    if (len1 <= len2) {
      row1.push(tag);
      len1 += tagLen;
    } else {
      row2.push(tag);
      len2 += tagLen;
    }
  });

  return [row1, row2];
}

// Build emoji lookup map
const emojiMap = {};
INTERESTS_BY_CATEGORY.forEach(category => {
  category.tags.forEach(tag => {
    emojiMap[tag.label] = tag.emoji;
  });
});


import CoverImage from '@shared/components/ui/CoverImage';

export function getCoverStyle(cover, fallback) {
  if (!cover || typeof cover !== 'string' || !cover.trim()) {
    return { backgroundImage: `url("${fallback}")` };
  }
  const clean = cover.trim();
  if (clean.startsWith('linear-gradient') || clean.startsWith('radial-gradient') || clean.startsWith('conic-gradient')) {
    return { background: clean };
  }
  if (clean.startsWith('data:image/') || clean.startsWith('blob:')) {
    return { backgroundImage: `url("${clean}")` };
  }
  const fullUrl = getMediaUrl(clean);
  return { backgroundImage: `url("${encodeURI(fullUrl)}")` };
}

export default function ProfilePage() {
  const { profileUsername } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const queryClient = useQueryClient();
  const { username: currentUserUsername, logout, currentUser: authUser, updateProfile } = useAuth();
  const targetUsername = profileUsername || currentUserUsername;

  const [modalType, setModalType] = useState(null);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'followers' || tab === 'following') {
      setModalType(tab);
    }
  }, [searchParams]);

  const handleCloseUserListModal = useCallback(() => {
    setModalType(null);
    if (searchParams.get('tab')) {
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('tab');
      setSearchParams(newParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [showCoverEditor, setShowCoverEditor] = useState(false);
  const [savingCover, setSavingCover] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [hasReported, setHasReported] = useState(false);
  const [cropFile, setCropFile] = useState(null);
  const [cropType, setCropType] = useState(null); // 'avatar' or 'cover'
  const coverFileRef = useRef(null);
  const avatarFileRef = useRef(null);
  const menuRef = useRef(null);

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
      queryClient.invalidateQueries(PROFILE_KEYS.byUsername(targetUsername));
      showToast('Cover updated!');
      setShowCoverEditor(false);
    } catch {
      showToast('Could not update cover.');
    } finally {
      setSavingCover(false);
    }
  }, [queryClient, targetUsername, updateProfile]);

  const handleCoverImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast('Image too large — max 10 MB.');
      e.target.value = '';
      return;
    }
    setCropFile(file);
    setCropType('cover');
    e.target.value = '';
  };

  const handleAvatarUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast('Image too large — max 10 MB.');
      e.target.value = '';
      return;
    }
    setCropFile(file);
    setCropType('avatar');
    e.target.value = '';
  };

  const handleCropComplete = async (croppedFile) => {
    setCropFile(null);
    setSavingCover(true); // Reusing for both to show loading state
    try {
      const folder = cropType === 'avatar' ? 'avatars' : 'profile-covers';
      const { publicUrl } = await processAndUploadImage(croppedFile, folder, {
        maxWidthOrHeight: cropType === 'avatar' ? 512 : 1920
      });
      
      const updateData = cropType === 'avatar' ? { avatar: publicUrl } : { cover: publicUrl };
      await usersApi.updateProfile(updateData);
      await updateProfile(updateData);
      queryClient.invalidateQueries(PROFILE_KEYS.byUsername(targetUsername));
      showToast(`${cropType === 'avatar' ? 'Avatar' : 'Cover'} updated!`);
      if (cropType === 'cover') setShowCoverEditor(false);
    } catch (e) {
      console.error(e);
      showToast('Upload failed.');
    } finally {
      setSavingCover(false);
      setCropType(null);
    }
  };

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
    profile: profileUser, 
    isLoading: isLoadingProfile,
    isError: profileError, 
    refetch: refetchProfile 
  } = useProfile(targetUsername);

  // Query User Posts
  const {
    data: postsData,
    isLoading: isLoadingPosts,
  } = useQuery({
    queryKey: ['user-posts', targetUsername],
    queryFn: () => postsApi.getUserPosts(targetUsername, 20),
    enabled: !!targetUsername && targetUsername !== 'unknown',
    staleTime: 30000,
  });

  // Show skeleton on first load OR while fetching incomplete/different user data
  const isDataIncomplete = profileUser && !profileUser.stats;
  const isDifferentUser = profileUser && targetUsername && profileUser.username?.toLowerCase() !== targetUsername.toLowerCase();
  const showingSkeleton = isLoadingProfile || isDataIncomplete || isDifferentUser;
  if (showingSkeleton) {
    return <ProfilePageSkeleton />;
  }

  if (profileError || !profileUser) {
    return (
      <main className="centre centre-wide">
        <NotFoundState
          type="user"
          onAction={() => goBack('/home')}
          coverPage={true}
        />
      </main>
    );
  }

  const isOwnProfile = !profileUsername || profileUsername === currentUserUsername || profileUser?.id === authUser?.id || profileUser?.username === currentUserUsername;
  const effectiveUser = isOwnProfile ? { ...profileUser, ...authUser } : profileUser;

  // Build dynamic user tags list
  const userTags = [];
  const universityName = getCollegeName(effectiveUser);
  const gradYear = effectiveUser.graduationYear || '';
  if (universityName || gradYear) {
    userTags.push({ icon: '🎓', label: `${universityName}${gradYear ? ` - ${gradYear}` : ''}` });
  }

  if (effectiveUser.major) {
    const cleanMajor = formatMajor(effectiveUser.major);
    if (cleanMajor) {
      userTags.push({ icon: '🤖', label: cleanMajor });
    }
  }

  if (effectiveUser.interests && Array.isArray(effectiveUser.interests)) {
    effectiveUser.interests.forEach(interest => {
      const emoji = emojiMap[interest] || '✨';
      userTags.push({ icon: emoji, label: interest });
    });
  }

  const posts = postsData?.posts || [];

  const handleMessageClick = async () => {
    if (isOwnProfile || !profileUser?.id) return;

    // 1. Instant local cache lookup
    const cachedConvs = queryClient.getQueryData(['conversations']);
    if (Array.isArray(cachedConvs)) {
      const existing = cachedConvs.find(c => {
        if (c.type !== 'DM' && c.type !== 'dm') return false;
        const targetId = c.targetUser?.id || c.otherUser?.id || c.userId;
        if (targetId && String(targetId) === String(profileUser.id)) return true;
        if (Array.isArray(c.participants) && c.participants.some(p => String(p.userId || p.id) === String(profileUser.id))) return true;
        return false;
      });

      if (existing?.publicId || existing?.id) {
        navigate(`/messages/${existing.publicId || existing.id}`, { state: { from: location.pathname } });
        return;
      }
    }

    // 2. Fast backend lookup for existing conversation
    try {
      const lookup = await dmApi.lookupDM(profileUser.id);
      if (lookup?.id || lookup?.publicId) {
        navigate(`/messages/${lookup.publicId || lookup.id}`, { state: { from: location.pathname } });
        return;
      }
    } catch {
      // ignore lookup error
    }

    // 3. Instant lazy draft navigation (0ms DB insertion)
    navigate(`/messages/new?user=${profileUser.id}`, {
      state: { from: location.pathname, targetUser: profileUser }
    });
  };

  const handlePostClick = (post) => {
    navigate(`/post/${post.id}`, { state: { post, sourceContext: 'profile', from: location.pathname } });
  };

  return (
    <>
      <main className={`centre animate-in ${s.profileMain}`}>
        {/* ── Center column ── */}
        <div className={s.centerColumn}>

          {/* Profile card */}
          <div className={s.profileCard}>
            <div className={s.coverWrap}>
              <CoverImage
                cover={effectiveUser.cover}
                fallback={defaultCover}
                className={s.coverPhoto}
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
              <button className={s.mobileBackBtn} onClick={() => navigate(location.state?.from ?? '/home', { replace: true })} aria-label="Go back">
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
                  src={effectiveUser.avatar}
                  name={effectiveUser.displayName || effectiveUser.name || effectiveUser.username}
                  size="96px"
                />
                {isOwnProfile && (
                  <>
                    <button
                      className={s.editAvatarBtn}
                      onClick={() => avatarFileRef.current?.click()}
                      title="Edit avatar"
                      aria-label="Edit avatar"
                      disabled={savingCover}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                      </svg>
                    </button>
                    <input
                      ref={avatarFileRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={handleAvatarUpload}
                    />
                  </>
                )}
              </div>

              <h1 className={s.name}>
                {effectiveUser.displayName || effectiveUser.name || effectiveUser.username}
              </h1>
              <p className={s.username}>@{effectiveUser.username}</p>
              {effectiveUser.bio && <p className={s.bio}>{effectiveUser.bio}</p>}

              {/* Interest tags */}
              {(() => {
                const [row1Tags, row2Tags] = balanceTagsIntoTwoRows(userTags);
                if (userTags.length === 0) return null;

                return (
                  <div className={s.tagsScrollWrapper}>
                    <div className={s.tagsRow}>
                      {row1Tags.map((tag, idx) => (
                        <div key={`tag-row1-${idx}`} className={s.tag}>
                          <span>{tag.icon}</span>
                          <span>{tag.label}</span>
                        </div>
                      ))}
                    </div>
                    {row2Tags.length > 0 && (
                      <div className={s.tagsRow}>
                        {row2Tags.map((tag, idx) => (
                          <div key={`tag-row2-${idx}`} className={s.tag}>
                            <span>{tag.icon}</span>
                            <span>{tag.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Stats */}
              <div className={s.statsContainer}>
                <div className={s.statItem} onClick={() => {}}>
                  <span className={s.statNumber}>{profileUser.stats?.posts ?? posts.length}</span>
                  <span className={s.statLabel}>Posts</span>
                </div>
                <div className={s.statItem} onClick={(e) => { e.stopPropagation(); setModalType('followers'); }}>
                  <span className={s.statNumber}>{profileUser.stats?.followers?.toLocaleString?.() ?? profileUser.followersList?.length ?? 0}</span>
                  <span className={s.statLabel}>Followers</span>
                </div>
                <div className={s.statItem} onClick={(e) => { e.stopPropagation(); setModalType('following'); }}>
                  <span className={s.statNumber}>{profileUser.stats?.following?.toLocaleString?.() ?? profileUser.followingList?.length ?? 0}</span>
                  <span className={s.statLabel}>Following</span>
                </div>
              </div>

              {/* Action buttons */}
              {!isOwnProfile ? (
                <div className={s.actionButtons}>
                  <FollowButton targetUsername={profileUser.username} style={{ height: '42px', width: '100%', flex: '1 1 0%' }} />
                  <button className={s.secondaryBtn} onClick={handleMessageClick}>
                    Message
                  </button>
                </div>
              ) : (
                <div className={s.actionButtons}>
                  <button className={s.primaryBtn} onClick={() => navigate('/settings', { state: { panel: 'profile' } })}>
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
                <Post key={p.id} postData={p} onClick={handlePostClick} />
              ))
            )}
          </div>
        </div>
      </main>

      {/* ── Right sidebar ── */}
      <RightPanel className="animate-in">
        <ProfileRightSidebar embedded={false} />
      </RightPanel>

      {modalType && (
        <UserListModal
          type={modalType}
          profileUsername={targetUsername}
          profileUser={profileUser}
          onClose={handleCloseUserListModal}
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
                  style={{
                    height: '56px',
                    borderRadius: '12px',
                    background: g,
                    border: 'none',
                    outline: 'none',
                    padding: 0,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                    opacity: savingCover ? 0.5 : 1,
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
                  }}
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
              disabled={savingCover}
              style={{ width: '100%', padding: '0.85rem', borderRadius: '10px', border: '1.5px dashed var(--color-border)', background: 'var(--color-bg-soft)', cursor: 'pointer', color: 'var(--color-text-muted)', fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
              {savingCover ? 'Uploading…' : 'Upload photo'}
            </button>
          </div>
        </div>,
        document.body
      )}
      
      {cropFile && (
        <MediaCropper
          imageFile={cropFile}
          aspect={cropType === 'avatar' ? 1 : 3}
          cropShape={cropType === 'avatar' ? 'round' : 'rect'}
          onCropComplete={handleCropComplete}
          onCancel={() => {
            setCropFile(null);
            setCropType(null);
          }}
        />
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
