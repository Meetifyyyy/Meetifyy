import { useParams, useNavigate } from 'react-router-dom';
import { useUrlState } from '@shared/hooks/useUrlState';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { postsApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { CollegeRepresentativeBadge } from '@shared/components/badges/CollegeRepresentativeBadge';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useProfile, PROFILE_KEYS } from '@shared/hooks/useProfile';
import PullToRefresh from '@shared/components/PullToRefresh';

import { showToast } from '@shared/utils/toast';
import { useOpenDirectMessage } from '@shared/hooks/useOpenDirectMessage';
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
  ALLOWED_IMAGE_TYPES as COVER_PHOTO_TYPES,
} from '@shared/constants/mediaLimits';
import FollowButton from '@shared/components/ui/FollowButton';
import ProfileRightSidebar from '../components/ProfileRightSidebar';
import ShareProfileModal from '../components/ShareProfileModal';
import AvatarPickerModal from '@features/auth/signup/components/AvatarPickerModal';
import ProfilePageSkeleton from '../components/skeletons/ProfilePageSkeleton';
import PostSkeleton from '@features/feed/components/skeletons/PostSkeleton';
import ReportModal from '@shared/components/modals/ReportModal/LazyReportModal';
import { getCollegeName } from '@shared/utils/user';

import RightPanel from '@layout/RightPanel';
import { INTERESTS_BY_CATEGORY } from '@shared/constants/interestsData';
import { useAcademicSummary } from '@shared/academics/useAcademicSummary';
import { useAcademicCatalog } from '@shared/academics/useAcademicCatalog';
import { IS_MOBILE_BUILD } from '@config';
import { useSystemBars } from '@shared/hooks/useSystemBars';

// Rough width budget, in characters, for one centred row on a phone. Below it
// the tags sit side by side; above it they are balanced over two rows that
// scroll sideways together.
const ONE_ROW_CHAR_BUDGET = 40;

function tagWidth(tag) {
  return (tag.label || '').length + 6;
}

function balanceTagsIntoTwoRows(tags) {
  if (!tags || tags.length === 0) return [[], []];
  const total = tags.reduce((sum, tag) => sum + tagWidth(tag), 0);
  if (tags.length === 1 || total <= ONE_ROW_CHAR_BUDGET) return [tags, []];

  const row1 = [];
  const row2 = [];
  let len1 = 0;
  let len2 = 0;

  tags.forEach(tag => {
    const tagLen = tagWidth(tag);
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

function renderProfileTag(tag, key) {
  return (
    <div key={key} className={s.tag}>
      <span>{tag.icon}</span>
      <span>{tag.label}</span>
    </div>
  );
}

// Build emoji lookup map
const emojiMap = {};
INTERESTS_BY_CATEGORY.forEach(category => {
  category.tags.forEach(tag => {
    emojiMap[tag.label] = tag.emoji;
  });
});


import CoverImage, { warmCover } from '@shared/components/ui/CoverImage';
import CoverEditorSheet from '../components/CoverEditorSheet';
import BlurredCover from '@shared/components/ui/BlurredCover';
import CollapsingHeader from '@shared/components/CollapsingHeader/CollapsingHeader';
import { Bookmark, MoreVertical, Settings, Share2, Flag } from '@shared/components/icons';
import Menu, { MenuItem, useMenu } from '@shared/components/ui/Menu';
import ActionDot from '@shared/components/ActionDot';
import { useProfileActionNeeded } from '@shared/hooks/useProfileActionNeeded';


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

  // In the app, the page runs under the device's navigation bar while the app's
  // bottom navigation is slid away, and the bar's own colour comes and goes
  // with the app's navigation in the same frame - as on Home. (No-op on the
  // website.) Called before the loading return below, so it holds for the
  // skeleton too.
  useSystemBars({ scrollThrough: true });

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
  const profileAction = useProfileActionNeeded();
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [showCoverEditor, setShowCoverEditor] = useState(false);
  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [hasReported, setHasReported] = useState(false);
  const [cropFile, setCropFile] = useState(null);
  const [cropType, setCropType] = useState(null); // 'avatar' or 'cover'
  const coverRef = useRef(null);
  const collapsingHeaderRef = useRef(null);
  const avatarFileRef = useRef(null);

  /*
   * Cover changes are optimistic. `pendingCover` is what the profile shows
   * while one is on its way: a chosen design, or the local preview of a photo
   * being uploaded, with its progress. The sheet closes at once and the page
   * stays usable; a failure puts the previous cover back.
   */
  const [pendingCover, setPendingCover] = useState(null); // { value, progress: number|null }
  const coverUploadRef = useRef(null); // AbortController of the upload in flight
  useEffect(() => () => coverUploadRef.current?.abort(), []);

  const saveCover = useCallback(async (value) => {
    // A newer choice supersedes a photo still uploading.
    coverUploadRef.current?.abort();
    setShowCoverEditor(false);
    setPendingCover({ value, progress: null });
    try {
      // updateProfile() PATCHes and propagates the cover into every cached payload.
      await updateProfile({ cover: value });
      queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.byUsername(targetUsername) });
    } catch {
      showToast("Couldn't update cover", 'error');
    } finally {
      setPendingCover((cur) => (cur?.value === value ? null : cur));
    }
  }, [queryClient, targetUsername, updateProfile]);

  /**
   * A cropped cover photo: shown at once from the local file, uploaded in the
   * background with progress, then swapped for the stored image once that has
   * decoded, so it never blinks. Cropping already bounded it to 1920px WebP, and
   * the pipeline compresses it once more; nothing full-resolution is uploaded.
   */
  const uploadCover = useCallback(async (file) => {
    coverUploadRef.current?.abort();
    const controller = new AbortController();
    coverUploadRef.current = controller;
    setShowCoverEditor(false);
    const preview = file.previewUrl || URL.createObjectURL(file);
    setPendingCover({ value: preview, progress: 0 });
    try {
      const { publicUrl } = await processAndUploadImage(
        file,
        'profile-covers',
        { maxWidthOrHeight: 1920 },
        (percent) => setPendingCover((cur) => (cur?.value === preview ? { ...cur, progress: percent } : cur)),
        controller.signal,
      );
      if (controller.signal.aborted) return;
      await updateProfile({ cover: publicUrl });
      // Fetched and decoded before the preview is dropped.
      await warmCover(publicUrl).catch(() => {});
      queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.byUsername(targetUsername) });
    } catch (e) {
      if (e?.name !== 'AbortError' && !controller.signal.aborted) {
        showToast("Couldn't upload the cover. Check your connection and try again.", 'error');
      }
    } finally {
      if (coverUploadRef.current === controller) coverUploadRef.current = null;
      setPendingCover((cur) => (cur?.value === preview ? null : cur));
      URL.revokeObjectURL(preview);
    }
  }, [queryClient, targetUsername, updateProfile]);

  const handleCoverPhoto = useCallback((file) => {
    // Some Android pickers report no type at all; the extension decides then.
    const typeOk = file.type
      ? COVER_PHOTO_TYPES.includes(file.type)
      : /\.(jpe?g|png|webp|gif)$/i.test(file.name || '');
    if (!typeOk) {
      showToast('Choose a JPG, PNG, WebP or GIF image', 'error');
      return;
    }
    if (file.size > MAX_COVERED_IMAGE_SIZE_BYTES) {
      showToast(COVERED_IMAGE_SIZE_ERROR_MESSAGE, 'error');
      return;
    }
    // The sheet stays open under the cropper: cancelling a crop goes back to
    // it, and confirming closes both (uploadCover).
    setCropFile(file);
    setCropType('cover');
  }, []);

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
    if (cropType === 'cover') {
      setCropType(null);
      uploadCover(croppedFile);
      return;
    }
    setSavingAvatar(true);
    try {
      const { publicUrl } = await processAndUploadImage(croppedFile, 'avatars', {
        maxWidthOrHeight: 512
      });

      const updateData = { avatar: publicUrl };
      // updateProfile() performs the PATCH itself and updates the auth user, so
      // the previous extra usersApi.updateProfile() call was a duplicate request.
      // updateProfile() pushes the new image into every cached payload that
      // embeds this user — feed posts, comments, chat rosters, search hits,
      // directory cards — so it appears immediately rather than when each of
      // those queries next refetches.
      await updateProfile(updateData);

      queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.byUsername(targetUsername) });
      showToast('Avatar updated', 'success');
    } catch (e) {
      console.error(e);
      showToast('Upload failed', 'error');
    } finally {
      setSavingAvatar(false);
      setCropType(null);
    }
  };

  const handleSelectDicebearAvatar = async (url) => {
    try {
      setSavingAvatar(true);
      await updateProfile({ avatar: url });
      queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.byUsername(targetUsername) });
      showToast('Avatar updated', 'success');
    } catch (e) {
      console.error(e);
      showToast('Failed to update avatar', 'error');
    } finally {
      setSavingAvatar(false);
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
  const postsEnabled = !!targetUsername && targetUsername !== 'unknown';
  const {
    data: postsData,
    isPending: isPostsPending,
  } = useQuery({
    queryKey: ['user-posts', targetUsername],
    queryFn: () => postsApi.getUserPosts(targetUsername, 20),
    enabled: postsEnabled,
    staleTime: 30000,
  });
  // No posts have arrived yet. Without this the page fell straight through to
  // "No posts yet" while the request was still in flight. (A disabled query
  // also reports pending, hence the `postsEnabled` guard.)
  const postsLoading = postsEnabled && isPostsPending;

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
  // The course tag needs the catalogue. Hold the skeleton until it is there, so
  // the tag rows are laid out once instead of re-balancing when it arrives.
  const { loading: catalogLoading } = useAcademicCatalog();

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
  const showingSkeleton = isLoadingProfile || isDataIncomplete || isDifferentUser
    || (catalogLoading && Boolean(effectiveUser?.course));
  if (showingSkeleton) {
    // On your own profile the header is already known from the signed-in
    // user, so it renders for real and only stats and posts wait.
    // Decided from the URL alone: while loading, `profileUser` can still be
    // the previously viewed profile, which must not make someone else's page
    // open with your own header.
    const isOwnUrl = !profileUsername
      || profileUsername.toLowerCase() === currentUserUsername?.toLowerCase();
    const seedUser = isOwnUrl && authUser?.username ? authUser : null;
    return <ProfilePageSkeleton user={seedUser} />;
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
    userTags.push({ icon: '🏫', label: universityName });
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

  const handleMessageClick = () => {
    if (isOwnProfile) return;
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

  const shownCover = pendingCover?.value ?? effectiveUser.cover;
  const coverProgress = pendingCover?.progress;

  const profileCover = (
    <CoverImage cover={shownCover} className={s.coverPhoto}>
      {/* A thin bar along the bottom while a cover photo uploads. */}
      {coverProgress != null && (
        <div
          className={s.coverProgress}
          role="progressbar"
          aria-label="Uploading cover"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={coverProgress}
        >
          <span style={{ transform: `scaleX(${Math.max(0.04, coverProgress / 100)})` }} />
        </div>
      )}
      {isOwnProfile && (
        <button
          className={s.editCoverBtn}
          data-exit-track="edit-cover"
          data-exit-inert
          onClick={() => setShowCoverEditor(true)}
          title="Edit cover"
          aria-label="Edit cover"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </button>
      )}
    </CoverImage>
  );

  return (
    <>
      {/*
        Wraps the <main> only — NOT the fragment around it.

        The modals and the avatar picker are siblings of this element, and a
        pull translates whatever is inside it. Wrapping the fragment would have
        dragged an open modal down the screen with the gesture.
      */}
      <CollapsingHeader
        coverRef={coverRef}
        title={effectiveUser.displayName || effectiveUser.name || effectiveUser.username}
        subtitle={effectiveUser.username ? `@${effectiveUser.username}` : null}
        onBack={() => goBack('/home')}
        backVariant="profile"
        coverBackground
        collapseRangeMultiplier={1.45}
        headerRef={collapsingHeaderRef}
        rightAction={IS_MOBILE_BUILD ? (
          <div className={s.menuWrap}>
            <button {...profileMenu.triggerProps} className={s.mobileMenuBtn} aria-label="More options">
              <MoreVertical size={20} />
            </button>
            <Menu {...profileMenu.menuProps} size="md" ariaLabel="Profile options">
              <MenuItem icon={Settings} onSelect={() => navigate('/settings')} onClose={profileMenu.close}>
                Settings
                {profileAction.any && <ActionDot />}
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
        ) : null}
      />
      <PullToRefresh onRefresh={handleRefresh} surface="sheet" pullTargetRef={collapsingHeaderRef}>
      <main className={`centre animate-in ${s.profileMain}`}>
        {/* ── Center column ── */}
        <div className={s.centerColumn}>

          {/* Profile card */}
      <div className={s.profileCard}>
            <div className={s.coverWrap} ref={coverRef}>
              {profileCover}
              {IS_MOBILE_BUILD && (
                /* The same cover, blurred: faded in by scrolling and by a pull. */
                <>
                  <div className={`${s.coverPullBlur} ${s.coverScrollBlur}`} data-cover-blur aria-hidden="true">
                    <BlurredCover cover={shownCover} />
                  </div>
                  <div className={s.coverPullBlur} aria-hidden="true">
                    <BlurredCover cover={shownCover} />
                  </div>
                </>
              )}
              <button className={s.mobileBackBtn} onClick={() => goBack('/home')} aria-label="Go back">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
              </button>
              {!IS_MOBILE_BUILD && (
                <div className={s.menuWrap}>
                  <button {...profileMenu.triggerProps} className={s.mobileMenuBtn} aria-label="More options">
                    <MoreVertical size={20} />
                  </button>
                  <Menu {...profileMenu.menuProps} size="md" ariaLabel="Profile options">
                    <MenuItem icon={Settings} onSelect={() => navigate('/settings')} onClose={profileMenu.close}>
                      Settings
                      {profileAction.any && <ActionDot />}
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
              )}
            </div>
            <div className={s.profileInfo}>
            <div className={s.avatarWrapper} data-exit-track="avatar" data-exit-sticky data-exit-after="110" data-exit-inert>
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
                      disabled={savingAvatar}
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

              <h1 className={s.name} data-exit-track="name" data-exit-lead="70">
                {effectiveUser.displayName || effectiveUser.name || effectiveUser.username}
                <CollegeRepresentativeBadge isCampusRep={effectiveUser.isCampusRep} collegeName={universityName} user={effectiveUser} size="lg" />
              </h1>
              <p className={s.username} data-exit-track="username">@{effectiveUser.username}</p>
              {effectiveUser.bio && <p className={s.bio}>{effectiveUser.bio}</p>}

              {/* Interest tags */}
              {(() => {
                const [row1Tags, row2Tags] = balanceTagsIntoTwoRows(userTags);
                if (userTags.length === 0) return null;

                return (
                  <div className={s.tagsScrollWrapper}>
                    <div className={s.tagsRow}>
                      {row1Tags.map((tag, idx) => renderProfileTag(tag, `tag-row1-${idx}`))}
                    </div>
                    {row2Tags.length > 0 && (
                      <div className={s.tagsRow}>
                        {row2Tags.map((tag, idx) => renderProfileTag(tag, `tag-row2-${idx}`))}
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
            ) : postsLoading ? (
              <>
                <PostSkeleton />
                <PostSkeleton />
              </>
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

      {showCoverEditor && (
        <CoverEditorSheet
          isOpen
          onClose={() => setShowCoverEditor(false)}
          cover={shownCover}
          avatar={effectiveUser.avatar}
          name={effectiveUser.displayName || effectiveUser.username}
          upload={coverProgress ?? null}
          onSave={saveCover}
          onPhoto={handleCoverPhoto}
        />
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
          onError={() => {
            setCropFile(null);
            setCropType(null);
            showToast("Couldn't open that image. Try another JPG, PNG or WebP.", 'error');
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
