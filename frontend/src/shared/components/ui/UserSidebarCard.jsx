import { useNavigate, useLocation } from 'react-router-dom';
import { useProfile } from '@shared/hooks/useProfile';
import { useAuth } from '@shared/context/AuthContext';
import Avatar from '@shared/components/avatar/Avatar';
import { CollegeRepresentativeBadge } from '@shared/components/badges/CollegeRepresentativeBadge';
import FollowButton from '@shared/components/ui/FollowButton';
import Skeleton from '@shared/components/skeletons/Skeleton';
import { getCollegeName } from '@shared/utils/user';
import { INTERESTS_BY_CATEGORY } from '@features/onboarding/constants/interestsData';
import { toggleRegistry } from '@shared/utils/mutationRegistry';
import { getMediaUrl } from '@shared/api/apiClient';
import { useOpenDirectMessage } from '@shared/hooks/useOpenDirectMessage';
import CoverImage from './CoverImage';
import defaultCover from '@assets/images/default_profile_cover.webp';
import s from './UserSidebarCard.module.css';
import { useAcademicSummary } from '@shared/academics/useAcademicSummary';

// Build emoji lookup map
const emojiMap = {};
INTERESTS_BY_CATEGORY.forEach(category => {
  category?.tags?.forEach(tag => {
    emojiMap[tag.label] = tag.emoji;
  });
});

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


export function UserSidebarCardSkeleton() {
  return (
    <div className={s.card}>
      {/* Cover Skeleton */}
      <Skeleton type="rect" width="100%" height="110px" style={{ margin: 0 }} />

      <div className={s.content}>
        {/* Overlapping Avatar Skeleton */}
        <div className={s.headerRow}>
          <Skeleton type="circle" width="76px" height="76px" style={{ border: '4px solid var(--color-bg-white)', margin: 0 }} />
        </div>

        {/* Identity Skeleton */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <Skeleton type="text" width="130px" height="18px" style={{ margin: 0 }} />
          <Skeleton type="text" width="85px" height="12px" style={{ margin: 0 }} />
        </div>

        {/* Bio Skeleton */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <Skeleton type="text" width="95%" height="12px" style={{ margin: 0 }} />
          <Skeleton type="text" width="75%" height="12px" style={{ margin: 0 }} />
        </div>

        {/* Tags Skeleton */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <Skeleton type="rect" width="110px" height="24px" style={{ borderRadius: 'var(--radius-full)' }} />
            <Skeleton type="rect" width="80px" height="24px" style={{ borderRadius: 'var(--radius-full)' }} />
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <Skeleton type="rect" width="150px" height="24px" style={{ borderRadius: 'var(--radius-full)' }} />
          </div>
        </div>

        {/* Stats Skeleton */}
        <div style={{ display: 'flex', gap: '2.5rem', paddingLeft: '0.65rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <Skeleton type="text" width="28px" height="18px" style={{ margin: 0 }} />
            <Skeleton type="text" width="55px" height="12px" style={{ margin: 0 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <Skeleton type="text" width="28px" height="18px" style={{ margin: 0 }} />
            <Skeleton type="text" width="55px" height="12px" style={{ margin: 0 }} />
          </div>
        </div>

        {/* Action Row Skeleton */}
        <div style={{ display: 'flex', gap: '0.65rem', width: '100%', alignItems: 'center' }}>
          <Skeleton type="rect" width="100%" height="42px" style={{ borderRadius: 'var(--radius-full)', flex: 1 }} />
          <Skeleton type="circle" width="42px" height="42px" style={{ flexShrink: 0 }} />
        </div>
      </div>
    </div>
  );
}

export default function UserSidebarCard({ username: propUsername, initialUser = null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useAuth();
  const openDirectMessage = useOpenDirectMessage();

  const targetUsername = propUsername || initialUser?.username || '';
  const { profile, isLoading } = useProfile(targetUsername);

  // Blend initialUser fallback with profile data from useProfile canonical store
  const effectiveUser = profile || initialUser || {};
  const isSelf = Boolean(currentUser && (
    (effectiveUser.id && String(effectiveUser.id) === String(currentUser.id)) ||
    (effectiveUser.authorId && String(effectiveUser.authorId) === String(currentUser.id)) ||
    (targetUsername && targetUsername.toLowerCase() === currentUser.username?.toLowerCase()) ||
    (effectiveUser.username && effectiveUser.username.toLowerCase() === currentUser.username?.toLowerCase())
  ));

  const cleanTargetUsername = targetUsername.toLowerCase();
  const entityKey = `follow:${cleanTargetUsername}`;

  const rawIsFollowing = effectiveUser.isFollowing ?? (currentUser?.followingList?.some(u => u?.toLowerCase() === cleanTargetUsername) || false);
  const isFollowing = cleanTargetUsername ? toggleRegistry.getLatestIntent(entityKey, rawIsFollowing) : rawIsFollowing;

  // Derive counts from canonical profile stats
  const followersCount = effectiveUser.stats?.followers
    ?? effectiveUser.followersCount
    ?? effectiveUser.followersList?.length
    ?? 0;

  const followingCount = effectiveUser.stats?.following
    ?? effectiveUser.followingCount
    ?? effectiveUser.followingList?.length
    ?? 0;

  const academicSummary = useAcademicSummary(effectiveUser);

  // Build tags cleanly without orphan hyphens
  const userTags = [];
  const universityName = getCollegeName(effectiveUser, '');
  if (universityName) {
    userTags.push({ icon: '🎓', label: universityName });
  }

  if (academicSummary) {
    userTags.push({ icon: '🎓', label: academicSummary });
  }

  if (effectiveUser.interests && Array.isArray(effectiveUser.interests)) {
    effectiveUser.interests.forEach(interest => {
      const emoji = emojiMap[interest] || '✨';
      userTags.push({ icon: emoji, label: interest });
    });
  }

  const handleProfileClick = () => {
    if (effectiveUser.username) {
      navigate(`/profile/${effectiveUser.username}`, { state: { from: location.pathname } });
    }
  };

  const handleMessageClick = () => {
    if (isSelf) return;
    openDirectMessage(effectiveUser);
  };

  if (isLoading && !profile && !initialUser) {
    return <UserSidebarCardSkeleton />;
  }

  const isVerified = Boolean(effectiveUser.verified);
  const isMutual = Boolean(effectiveUser.isMutual);

  return (
    <div className={s.card}>
      {/* Cover image */}
      <div className={s.coverWrap}>
        <CoverImage
          cover={effectiveUser.cover}
          fallback={defaultCover}
          className={s.coverPhoto}
        />
      </div>

      <div className={s.content}>
        {/* Header with overlapping avatar */}
        <div className={s.headerRow}>
          <div className={s.avatarWrapper} onClick={handleProfileClick}>
            <Avatar 
              src={effectiveUser.avatar} 
              name={effectiveUser.displayName || effectiveUser.username} 
              size="76px" 
            />
          </div>
        </div>

        {/* Name and Username */}
        <div className={s.identity} onClick={handleProfileClick}>
          <div className={s.nameRow}>
            <h2 className={s.displayName}>{effectiveUser.displayName || effectiveUser.username || 'User'}</h2>
            <CollegeRepresentativeBadge isCampusRep={Boolean(effectiveUser.isCampusRep ?? initialUser?.isCampusRep ?? profile?.isCampusRep)} collegeName={universityName} size="md" />
            {isVerified && (
              <span className={s.verifiedBadge} title="Verified user">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                </svg>
              </span>
            )}
          </div>
          <div className={s.usernameRow}>
            <span className={s.username}>@{effectiveUser.username}</span>
            {isMutual && <span className={s.mutualBadge}>Follows you</span>}
          </div>
        </div>

        {/* Bio */}
        {effectiveUser.bio ? (
          <p className={s.bio}>{effectiveUser.bio}</p>
        ) : null}

        {/* Interest & Major tags balanced into 2 rows */}
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
        <div className={s.statsRow}>
          <div className={s.statItem}>
            <span className={s.statNumber}>{followersCount.toLocaleString()}</span>
            <span className={s.statLabel}>Followers</span>
          </div>
          <div className={s.statItem}>
            <span className={s.statNumber}>{followingCount.toLocaleString()}</span>
            <span className={s.statLabel}>Following</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className={s.actionRow}>
          {!isSelf ? (
            <>
              <FollowButton 
                targetUsername={effectiveUser.username} 
                initialFollowing={isFollowing} 
                style={{ flex: 1, height: '44px' }} 
              />
              <button 
                className={s.iconBtn} 
                onClick={handleMessageClick}
                title="Send Message"
                aria-label="Send Message"
              >
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
              </button>
            </>
          ) : (
            <>
              <button 
                className={s.primaryBtn} 
                onClick={() => navigate('/settings/profile')}
                style={{ height: '44px' }}
              >
                Edit Profile
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
