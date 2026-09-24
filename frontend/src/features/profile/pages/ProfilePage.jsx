import { useParams, useNavigate } from 'react-router-dom';
import { useUrlState } from '@shared/hooks/useUrlState';
import { useState, useRef, useCallback } from 'react';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { postsApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { CollegeRepresentativeBadge } from '@shared/components/badges/CollegeRepresentativeBadge';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useProfile, PROFILE_KEYS } from '@shared/hooks/useProfile';
import PullToRefresh from '@shared/components/PullToRefresh';

import { showToast } from '@shared/utils/toast';
import { useOpenDirectMessage } from '@shared/hooks/useOpenDirectMessage';
import MessagingRestrictedModal from '@shared/components/modals/MessagingRestrictedModal';
import { isMessagingRestricted } from '@shared/lib/studentYearPolicy';
import Post from '@features/feed/components/post/Post';
import UserListModal from '@shared/components/modals/UserListModal';
import Avatar from '@shared/components/avatar/Avatar';
import NotFoundState from '@shared/components/ui/NotFoundState';
import s from './ProfilePage.module.css';
import MediaCropper from '@shared/components/media/MediaCropper';
import { processAndUploadImage } from '@shared/utils/mediaPipeline';
import {
  MAX_COVERED_IMAGE_SIZE_BYTES,
  COVERED_IMAGE_SIZE_ERROR_MESSAGE,
  ALLOWED_IMAGE_ACCEPT,
} from '@shared/constants/mediaLimits';
import FollowButton from '@shared/components/ui/FollowButton';
import ProfileRightSidebar from '../components/ProfileRightSidebar';
import ShareProfileModal from '../components/ShareProfileModal';
import AvatarPickerModal from '@features/auth/signup/components/AvatarPickerModal';
import ProfilePageSkeleton from '../components/skeletons/ProfilePageSkeleton';
import { createPortal } from 'react-dom';
import ReportModal from '@shared/components/modals/ReportModal/ReportModal';
import { getCollegeName } from '@shared/utils/user';

import RightPanel from '@layout/RightPanel';
import { INTERESTS_BY_CATEGORY } from '@shared/constants/interestsData';
import { useAcademicSummary } from '@shared/academics/useAcademicSummary';

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
import { Bookmark, Lock, MoreVertical, Settings, Share2, Flag } from '@shared/components/icons';
import Menu, { MenuItem, useMenu } from '@shared/components/ui/Menu';


export default function ProfilePage() {
  const { profileUsername } = useParams();
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const queryClient = useQueryClient();
  // handleMessageClick called openDirectMessage without ever obtaining it, so
  // the profile's Message button threw ReferenceError instead of opening a DM.
  const openDirectMessage = useOpenDirectMessage();
  const { username: currentUserUsername, currentUser: authUser, updateProfile } = useAuth();
  const targetUsername = profileUsername || currentUserUsername;

  // The followers/following list is a sub-view of the profile, so the URL owns
  // it: /profile/:username?tab=followers is linkable and survives a reload, and
  // because opening it pushes an entry, Back closes the list rather than
  // leaving the profile. Previously the param was read once and then stripped,
  // which left the open list invisible to reload, deep links and Back alike.
  const [modalType, setModalType] = useUrlState('tab', '', {
    allowed: ['followers', 'following'],
    push: true,
  });
  // Switching between the Followers and Following tabs inside the open list
  // replaces the entry rather than pushing, so Back still closes the list in
  // one step instead of walking back through every tab the viewer tried.
  const [, switchModalType] = useUrlState('tab', '', {
    allowed: ['followers', 'following'],
  });

  const handleCloseUserListModal = useCallback(() => {
    goBack(`/profile/${targetUsername}`);
  }, [goBack, targetUsername]);

  const profileMenu = useMenu();
  const [shareModalOpen, setShareModalOpen] = useState(false);
  // First-year isolation: the "Messaging Restricted" dialog raised by the
  // locked Message button. Kept isolated from every other profile action so
  // the feature can be removed by deleting this line and its two uses.
  const [restrictedModalOpen, setRestrictedModalOpen] = useState(false);
  const [showCoverEditor, setShowCoverEditor] = useState(false);
  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false);
  const [savingCover, setSavingCover] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [hasReported, setHasReported] = useState(false);
  const [cropFile, setCropFile] = useState(null);
  const [cropType, setCropType] = useState(null); // 'avatar' or 'cover'
  const coverFileRef = useRef(null);
  const avatarFileRef = useRef(null);

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
      // updateProfile() already PATCHes via usersApi; calling both sent the same
      // request twice.
      // updateProfile() propagates the new image into every cached payload.
      await updateProfile({ cover: gradient });
      queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.byUsername(targetUsername) });
      showToast('Cover updated', 'success');
      setShowCoverEditor(false);
    } catch {
      showToast("Couldn't update cover", 'error');
    } finally {
      setSavingCover(false);
    }
  }, [queryClient, targetUsername, updateProfile]);

  const handleCoverImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > MAX_COVERED_IMAGE_SIZE_BYTES) {
      showToast(COVERED_IMAGE_SIZE_ERROR_MESSAGE, 'error');
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
    if (file.size > MAX_COVERED_IMAGE_SIZE_BYTES) {
      showToast(COVERED_IMAGE_SIZE_ERROR_MESSAGE, 'error');
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
      // updateProfile() performs the PATCH itself and updates the auth user, so
      // the previous extra usersApi.updateProfile() call was a duplicate request.
      // updateProfile() pushes the new image into every cached payload that
      // embeds this user — feed posts, comments, chat rosters, search hits,
      // directory cards — so it appears immediately rather than when each of
      // those queries next refetches.
      await updateProfile(updateData);

      queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.byUsername(targetUsername) });
      showToast(`${cropType === 'avatar' ? 'Avatar' : 'Cover'} updated`, 'success');
      if (cropType === 'cover') setShowCoverEditor(false);
    } catch (e) {
      console.error(e);
      showToast('Upload failed', 'error');
    } finally {
      setSavingCover(false);
      setCropType(null);
    }
  };

  const handleSelectDicebearAvatar = async (url) => {
    try {
      setSavingCover(true);
      await updateProfile({ avatar: url });
      queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.byUsername(targetUsername) });
      showToast('Avatar updated', 'success');
    } catch (e) {
      console.error(e);
      showToast('Failed to update avatar', 'error');
    } finally {
      setSavingCover(false);
    }
  };

  // Outside-click listener removed — `Menu` owns its own dismissal.

  // Query Profile Data
  const { 
    profile: profileUser, 
    isLoading: isLoadingProfile,
    isError: profileError, 
  } = useProfile(targetUsername);

  // Query User Posts
  const {
    data: postsData,
  } = useQuery({
    queryKey: ['user-posts', targetUsername],
    queryFn: () => postsApi.getUserPosts(targetUsername, 20),
    enabled: !!targetUsername && targetUsername !== 'unknown',
    staleTime: 30000,
  });

  // Derived above the early returns below, because useAcademicSummary must run on
  // EVERY render. Placing it after `return <ProfilePageSkeleton />` meant the hook
  // was skipped while loading and called once loaded, so React saw a different
  // hook count between renders and threw "rendered more hooks than during the
  // previous render" (#310). Spreading a null profileUser is a no-op, so this is
  // safe to compute before the data has arrived.
  const isOwnProfile = !profileUsername || profileUsername === currentUserUsername || profileUser?.id === authUser?.id || profileUser?.username === currentUserUsername;
  const effectiveUser = isOwnProfile
    ? {
        ...authUser,
        ...profileUser,
        isCampusRep: Boolean(profileUser?.isCampusRep ?? authUser?.isCampusRep),
        // On your OWN profile the signed-in user record is the fresher source for
        // these two fields: AuthContext updates it the moment an upload succeeds,
        // whereas the profile query can still be serving a body seeded from
        // IndexedDB or an in-flight refetch. Because `...profileUser` spreads
        // last, that stale value used to win and the page kept showing the old
        // image while the navbar (which reads the auth user) showed the new one.
        ...(authUser?.avatar != null ? { avatar: authUser.avatar } : {}),
        ...(authUser?.cover != null ? { cover: authUser.cover } : {}),
      }
    : profileUser;

  // The tag sits in a row of one-word interest chips, so it carries the course
  // name alone rather than the full course • branch • year line.
  const academicSummary = useAcademicSummary(effectiveUser, { branch: false, year: false });

  /*
   * Declared above the skeleton early-return below, so it runs on every
   * render — React Hooks must be called in the same order each time.
   *
   * The profile document and its posts. Both are server-backed and both go
   * stale for the same reasons — a new post, a changed follower count — so a
   * pull refreshes the pair rather than whichever one happens to be visible.
   *
   * `invalidateQueries`, NOT `resetQueries`.
   *
   * Reset DISCARDS the cached data, which makes the screen fall back to its
   * loading state. On this screen that meant the skeleton early-return fired,
   * which unmounted the <PullToRefresh> wrapper itself — so the content the
   * user had just pulled down was destroyed mid-gesture and replaced by a
   * skeleton sitting at offset zero. That is the snap: not the spinner moving,
   * but the page underneath it being thrown away and rebuilt.
   *
   * Invalidate keeps the current data on screen and refetches behind it, which
   * is what a pull-to-refresh is supposed to look like anyway — the list stays
   * put and updates in place.
   */
  const handleRefresh = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.byUsername(targetUsername) }),
        queryClient.invalidateQueries({ queryKey: ['user-posts', targetUsername] }),
      ]),
    [queryClient, targetUsername],
  );

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

  // Build dynamic user tags list
  const userTags = [];
  const universityName = getCollegeName(effectiveUser);
  if (universityName) {
    userTags.push({ icon: '🎓', label: universityName });
  }

  // Just the course, e.g. "B.Tech". Null for accounts with no academic data yet
  // (including legacy users cleared by the migration), in which case no tag is
  // rendered at all.
  if (academicSummary) {
    userTags.push({ icon: '🎓', label: academicSummary });
  }

  if (effectiveUser.interests && Array.isArray(effectiveUser.interests)) {
    effectiveUser.interests.forEach(interest => {
      const emoji = emojiMap[interest] || '✨';
      userTags.push({ icon: emoji, label: interest });
    });
  }

  const posts = postsData?.posts || [];

  /**
   * First-year isolation: the Message button is never hidden or disabled.
   *
   * When the server says this pair may not message, the button stays in place
   * with a lock and opens an explanatory dialog instead. Nothing is created
   * and no request is sent -- the locked branch returns before
   * `openDirectMessage`, so there is no conversation to leave behind.
   *
   * The flag is the server's answer for this exact viewer/target pair, not
   * something the client derives. It is UX only; `startDM`, every send path
   * and every recipient selector refuse the same pair independently.
   */
  const messagingRestricted = !isOwnProfile && isMessagingRestricted(profileUser);

  const handleMessageClick = () => {
    if (isOwnProfile) return;
    if (messagingRestricted) {
      setRestrictedModalOpen(true);
      return;
    }
    openDirectMessage(profileUser);
  };

  const handlePostClick = (post, options) => {
    navigate(`/post/${post.id}`, {
      state: {
        post,
        sourceContext: 'profile',
        from: location.pathname,
        focusComment: options?.focusComment || false,
      }
    });
  };

  const handleCommentClick = (post) => {
    handlePostClick(post, { focusComment: true });
  };

  return (
    <>
      {/*
        Wraps the <main> only — NOT the fragment around it.

        The modals and the avatar picker are siblings of this element, and a
        pull translates whatever is inside it. Wrapping the fragment would have
        dragged an open modal down the screen with the gesture.
      */}
      <PullToRefresh onRefresh={handleRefresh}>
      <main className={`centre animate-in ${s.profileMain}`}>
        {/* ── Center column ── */}
        <div className={s.centerColumn}>

          {/* Profile card */}
          <div className={s.profileCard}>
            <div className={s.coverWrap}>
              <CoverImage
                cover={effectiveUser.cover}
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
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </button>
              )}
              <button className={s.mobileBackBtn} onClick={() => goBack('/home')} aria-label="Go back">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
              </button>
              <div className={s.menuWrap}>
                <button {...profileMenu.triggerProps} className={s.mobileMenuBtn} aria-label="More options">
                  <MoreVertical size={20} />
                </button>
                <Menu {...profileMenu.menuProps} size="md" ariaLabel="Profile options">
                  <MenuItem icon={Settings} onSelect={() => navigate('/settings')} onClose={profileMenu.close}>
                    Settings
                  </MenuItem>
                  <MenuItem icon={Share2} onSelect={() => setShareModalOpen(true)} onClose={profileMenu.close}>
                    Share profile
                  </MenuItem>
                  <MenuItem icon={Bookmark} onSelect={() => navigate('/saved')} onClose={profileMenu.close}>
                    Saved
                  </MenuItem>
                  <MenuItem
                    icon={Flag}
                    disabled={hasReported}
                    onSelect={() => setShowReportModal(true)}
                    onClose={profileMenu.close}
                  >
                    {hasReported ? 'Already reported' : 'Report'}
                  </MenuItem>
                </Menu>
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
                      onClick={() => setIsAvatarPickerOpen(true)}
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
                      accept={ALLOWED_IMAGE_ACCEPT}
                      style={{ display: 'none' }}
                      onChange={handleAvatarUpload}
                    />
                  </>
                )}
              </div>

              <h1 className={s.name}>
                {effectiveUser.displayName || effectiveUser.name || effectiveUser.username}
                <CollegeRepresentativeBadge isCampusRep={effectiveUser.isCampusRep} collegeName={universityName} user={effectiveUser} size="lg" />
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
                  <button
                    className={`${s.secondaryBtn} ${messagingRestricted ? s.secondaryBtnLocked : ''}`}
                    onClick={handleMessageClick}
                    // Not `disabled`: the button must stay reachable by
                    // keyboard and click so the explanation is one activation
                    // away. `aria-describedby` is not used because the reason
                    // lives in the dialog this opens, which is announced then.
                    aria-label={messagingRestricted ? 'Message (restricted)' : undefined}
                    aria-haspopup={messagingRestricted ? 'dialog' : undefined}
                  >
                    {messagingRestricted && (
                      // Decorative: `aria-label` above already carries the
                      // state, so announcing the glyph would repeat it.
                      <Lock size={15} strokeWidth={2.25} aria-hidden="true" />
                    )}
                    Message
                  </button>
                </div>
              ) : (
                <div className={s.actionButtons}>
                  <button className={s.primaryBtn} onClick={() => navigate('/settings/profile')}>
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
                <Post key={p.id} postData={p} onClick={handlePostClick} onCommentClick={handleCommentClick} />
              ))
            )}
          </div>
        </div>
      </main>
      </PullToRefresh>

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
          onTypeChange={switchModalType}
        />
      )}

      <ShareProfileModal
        isOpen={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        profileUser={profileUser}
      />

      {/* First-year isolation. Rendered only while open, and touching nothing
          else on this page -- deleting these three lines and the two above
          removes the whole client half of the feature from the profile. */}
      {restrictedModalOpen && (
        <MessagingRestrictedModal onClose={() => setRestrictedModalOpen(false)} />
      )}

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
              accept={ALLOWED_IMAGE_ACCEPT}
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

      {isOwnProfile && (
        <AvatarPickerModal
          isOpen={isAvatarPickerOpen}
          onClose={() => setIsAvatarPickerOpen(false)}
          selectedUrl={effectiveUser.avatar}
          onSelect={handleSelectDicebearAvatar}
          onUpload={() => avatarFileRef.current?.click()}
        />
      )}
    </>
  );
}
