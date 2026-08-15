import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useData } from '@shared/hooks/useData';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { communitiesApi, postsApi, getMediaUrl } from '@shared/api/apiClient';
import { showToast } from '@shared/utils/toast';
import { isImageUrl } from '@shared/utils/avatar';
import { processAndUploadImage } from '@shared/utils/mediaPipeline';
import MediaCropper from '@shared/components/media/MediaCropper';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import Skeleton from '@shared/components/skeletons/Skeleton';
import { ErrorState } from '@shared/components/ui/StateViews';
import NotFoundState from '@shared/components/ui/NotFoundState';
import Post from '@features/feed/components/post/Post';
import PostComposer from '@features/feed/components/composer/PostComposer';
import PostSkeleton from '@features/feed/components/skeletons/PostSkeleton';
import CommunityMembersModal from '../modals/CommunityMembersModal';
import CommunityAdminModal from '../modals/CommunityAdminModal';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import styles from './CommunityView.module.css';
import { useMediaViewer } from '@shared/context/MediaViewerContext';
import { useJoinCommunity } from '../../hooks/useJoinCommunity';
import { useCommunityById } from '@shared/hooks/useCommunities';
import { toggleRegistry } from '@shared/utils/mutationRegistry';
import ShareCommunityModal from '../modals/ShareCommunityModal';
import defaultCommunityCover from '@assets/images/default_community_cover.webp';
import { useGlobalSocketStore } from '@shared/stores/useGlobalSocketStore';
import ReportModal from '@shared/components/modals/ReportModal/ReportModal';

function getActivityPhrase(comm) {
  if (comm.trending) return 'Growing Fast';
  if ((comm.discussionsToday || 0) >= 30) return 'Active Today';
  if ((comm.newMembersThisWeek || 0) >= 200) return 'Building Momentum';
  if (comm.members < 500) return 'Just Getting Started';
  if (comm.members < 2000) return 'Early Members Welcome';
  return 'Recently Active';
}

function formatCount(n) {
  if (n === undefined || n === null) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

function HeroSection({ comm, joined, joining, onToggleJoin, onCreatePost, userCommunities, onViewMembers, isAdmin, onOpenAdmin, onUpdateCommunity, isMuted, onMuteClick, onTitleClick, onShare }) {
  const navigate = useNavigate();
  const { currentUser, users } = useData();
  const { openViewer } = useMediaViewer();
  const coverInputRef = useRef(null);
  const avatarInputRef = useRef(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [imgError, setImgError] = useState(false);
  const dropdownRef = useRef(null);
  
  const [cropFile, setCropFile] = useState(null);
  const [cropType, setCropType] = useState(null); // 'avatar' or 'coverImage'
  const [isUploading, setIsUploading] = useState(false);

  const [coverLoading, setCoverLoading] = useState(true);
  const [coverError, setCoverError] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(isImageUrl(comm.avatar));

  useEffect(() => {
    setCoverLoading(true);
    setCoverError(false);
  }, [comm.coverImage]);

  useEffect(() => {
    setImgError(false);
    setAvatarLoading(isImageUrl(comm.avatar));
  }, [comm.avatar]);

  useEffect(() => {
    if (!showDropdown) return;
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown]);

  const handleImageUpload = (e, field) => {
    const file = e.target.files[0];
    if (!file) return;
    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      showToast('File too large. Maximum size is 50 MB.');
      e.target.value = '';
      return;
    }
    setCropFile(file);
    setCropType(field);
    e.target.value = '';
  };

  const handleCropComplete = async (croppedFile) => {
    setCropFile(null);
    setIsUploading(true);
    try {
      const folder = cropType === 'avatar' ? 'community-icons' : 'community-covers';
      const { publicUrl } = await processAndUploadImage(croppedFile, folder, {
        maxWidthOrHeight: cropType === 'avatar' ? 512 : 1920
      });
      const fieldKey = cropType === 'avatar' ? 'avatarKey' : 'coverKey';
      await onUpdateCommunity(comm.id, { [fieldKey]: publicUrl });
    } catch {
      showToast('Upload failed. Try again.');
    } finally {
      setIsUploading(false);
      setCropType(null);
    }
  };

  const coverSrc = (!coverError && comm.coverImage) ? comm.coverImage : defaultCommunityCover;

  return (
    <div className={styles.heroSection}>
      <div className={styles.heroCover}>
        {(coverLoading || isUploading) && (
          <div className={styles.coverSkeleton} />
        )}
        <img
          src={coverSrc}
          alt=""
          className={`${styles.heroCoverImg} ${coverLoading ? styles.imgHidden : styles.imgVisible}`}
          onLoad={() => setCoverLoading(false)}
          onError={() => {
            setCoverError(true);
            setCoverLoading(false);
          }}
          draggable={false}
          style={{ cursor: 'default', userSelect: 'none', pointerEvents: 'none' }}
        />
        <div className={styles.heroCoverOverlay} />
        {isAdmin && (
          <>
            <input 
              type="file" 
              accept="image/*" 
              ref={coverInputRef} 
              style={{ display: 'none' }} 
              onChange={e => handleImageUpload(e, 'coverImage')} 
            />
            <button className={styles.editCoverBtn} onClick={() => coverInputRef.current?.click()} title="Change Cover Image" aria-label="Change Cover Image">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
              </svg>
            </button>
          </>
        )}
      </div>
      <div className={styles.heroContent}>
        {/* DESKTOP LAYOUT */}
        <div className={styles.desktopHeroLayout}>
          <div className={styles.heroTopRow}>
            <div className={styles.avatarWrapper}>
              <div 
                className={`${styles.heroAvatar} ${isAdmin ? styles.heroAvatarEditable : ''}`} 
                style={{ background: (!isImageUrl(comm.avatar) || imgError) ? (comm.color || 'var(--color-primary)') : 'var(--color-bg-white)' }}
                onClick={isAdmin ? () => avatarInputRef.current?.click() : undefined}
              >
                {avatarLoading && isImageUrl(comm.avatar) && !imgError && (
                  <div className={styles.avatarSkeleton} />
                )}
                {isImageUrl(comm.avatar) && !imgError ? (
                  <img 
                    src={comm.avatar} 
                    alt={comm.name} 
                    className={`${styles.heroAvatarImg} ${avatarLoading ? styles.imgHidden : styles.imgVisible}`} 
                    onLoad={() => setAvatarLoading(false)}
                    onError={() => {
                      setImgError(true);
                      setAvatarLoading(false);
                    }} 
                  />
                ) : (
                  <span className={styles.heroLetter}>
                    {comm.avatar || (comm.name ? comm.name.charAt(0).toUpperCase() : '')}
                  </span>
                )}
                {isAdmin && (
                  <>
                    <input 
                      type="file" 
                      accept="image/*" 
                      ref={avatarInputRef} 
                      style={{ display: 'none' }} 
                      onChange={e => handleImageUpload(e, 'avatar')} 
                    />
                    <div className={styles.avatarEditOverlay} title="Change Avatar">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                        <circle cx="12" cy="13" r="3" />
                      </svg>
                    </div>
                  </>
                )}
              </div>
            </div>
            
            <div className={styles.heroMeta}>
              <div className={styles.heroNameRow}>
                <h2 className={styles.heroName}>{comm.name}</h2>
                {comm.trending && (
                  <span className={styles.trendingBadge}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                      <polyline points="17 6 23 6 23 12" />
                    </svg>
                    Trending
                  </span>
                )}
              </div>
            </div>
            <div className={styles.heroActions}>
              {joined && (
                <button
                  type="button"
                  className={styles.notificationBtn}
                  onClick={onMuteClick}
                  title={isMuted ? "Unmute community" : "Mute community"}
                >
                  {isMuted ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.268 21a2 2 0 0 0 3.464 0" />
                      <path d="M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742" />
                      <path d="m2 2 20 20" />
                      <path d="M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 8A6 6 0 0 0 6 8v7a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2z" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                  )}
                </button>
              )}
              <button
                className={`${styles.heroJoinBtn}${joined ? ` ${styles.joined}` : ''}`}
                onClick={onToggleJoin}
                disabled={joining || comm.isEligibleToJoin === false || comm.hasPendingRequest}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: 'center', opacity: (comm.isEligibleToJoin === false || comm.hasPendingRequest) ? 0.8 : 1 }}
              >
                {joining ? (
                  <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px', borderColor: joined ? 'currentColor' : 'white', borderTopColor: 'transparent' }} />
                ) : null}
                {joined ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Joined
                  </>
                ) : comm.isEligibleToJoin === false ? (
                  'Ineligible'
                ) : comm.hasPendingRequest ? (
                  'Requested'
                ) : (comm.isPrivate || comm.privacy === 'private') ? (
                  'Request to Join'
                ) : (
                  'Join Community'
                )}
              </button>

              <div className={styles.dropdownContainer} ref={dropdownRef}>
                <button 
                  type="button"
                  className={styles.threeDotBtn}
                  onClick={() => setShowDropdown(prev => !prev)}
                  title="More Options"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="1.5"></circle>
                    <circle cx="12" cy="5" r="1.5"></circle>
                    <circle cx="12" cy="19" r="1.5"></circle>
                  </svg>
                </button>
                {showDropdown && (
                  <div className={styles.dropdownMenu}>
                    <button 
                      type="button"
                      onClick={() => {
                        onShare();
                        setShowDropdown(false);
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '0.5rem' }}>
                        <circle cx="18" cy="5" r="3" />
                        <circle cx="6" cy="12" r="3" />
                        <circle cx="18" cy="19" r="3" />
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                      </svg>
                      Share
                    </button>
                    <button 
                      type="button"
                      onClick={() => {
                        onViewMembers();
                        setShowDropdown(false);
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '0.5rem' }}>
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                      Members
                    </button>
                    {isAdmin && (
                      <button 
                        type="button"
                        onClick={() => {
                          onOpenAdmin();
                          setShowDropdown(false);
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '0.5rem' }}>
                          <circle cx="12" cy="12" r="3" />
                          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                        Settings
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className={styles.heroBottomRow}>
            {(() => {
              let memberList = Array.isArray(comm.members) && comm.members.length > 0
                ? comm.members.map(m => m.user ? { id: m.user.id, name: m.user.displayName || m.user.username, username: m.user.username, avatar: m.user.avatar } : m)
                : (Array.isArray(comm.memberList) ? comm.memberList : []);

              if (memberList.length === 0 && comm.ownerId) {
                const ownerUser = comm.owner || (currentUser?.id === comm.ownerId ? currentUser : (users && users[comm.ownerId]));
                memberList = [{
                  id: comm.ownerId,
                  name: ownerUser?.displayName || ownerUser?.username || 'Owner',
                  username: ownerUser?.username || '',
                  avatar: ownerUser?.avatar || ''
                }];
              }

              const totalMembers = Math.max(
                typeof comm.memberCount === 'number' ? comm.memberCount : 0,
                memberList.length,
                1
              );

              return (
                <div 
                  className={styles.memberStackClickable} 
                  onClick={() => {
                    if (onViewMembers) onViewMembers();
                  }} 
                  style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}
                  title="View members"
                >
                  <div className={styles.memberStack}>
                    {memberList.slice(0, 4).map((m, i) => (
                      <div
                        key={i}
                        className={styles.memberAvatar}
                        style={{ zIndex: 4 - i, background: 'var(--color-bg-alt)', padding: 0, overflow: 'hidden' }}
                      >
                        {isImageUrl(m.avatar) ? (
                          <img
                            src={getMediaUrl(m.avatar)}
                            alt={m.name || ''}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', borderRadius: '50%' }}
                            onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.webp'; }} />
                        ) : (
                          <DefaultAvatar style={{ width: '100%', height: '100%', borderRadius: '50%', fontSize: '0.65rem' }} />
                        )}
                      </div>
                    ))}
                    {totalMembers > 4 && (
                      <div className={styles.memberOverflow}>
                        +{formatCount(totalMembers - 4)}
                      </div>
                    )}
                  </div>
                  <div className={styles.heroCounts}>
                    <span className={styles.heroCount}>
                      <strong>{formatCount(totalMembers)}</strong> members
                    </span>
                    <span className={styles.heroCount}>
                      <span className={styles.onlineDot} />
                      <strong>{formatCount(comm.online || 0)}</strong> active now
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* MOBILE LAYOUT */}
        <div className={styles.mobileHeroLayout}>
          <div className={styles.mobileHeroTopRow}>
            <div 
              className={styles.mobileAvatar}
              style={{ background: (!isImageUrl(comm.avatar) || imgError) ? (comm.color || 'var(--color-primary)') : 'var(--color-bg-white)' }}
            >
              {avatarLoading && isImageUrl(comm.avatar) && !imgError && (
                <div className={styles.avatarSkeleton} />
              )}
              {isImageUrl(comm.avatar) && !imgError ? (
                <img 
                  src={comm.avatar} 
                  alt={comm.name} 
                  className={`${styles.heroAvatarImg} ${avatarLoading ? styles.imgHidden : styles.imgVisible}`} 
                  onLoad={() => setAvatarLoading(false)}
                  onError={() => {
                    setImgError(true);
                    setAvatarLoading(false);
                  }} 
                />
              ) : (
                <span className={styles.heroLetter}>
                  {comm.avatar || (comm.name ? comm.name.charAt(0).toUpperCase() : '')}
                </span>
              )}
            </div>
            
            <div className={styles.mobileHeroMetaInfo}>
              <div className={styles.mobileHeroTitleRow} onClick={onTitleClick}>
                <h2 className={styles.mobileHeroTitle}>{comm.name}</h2>
                <div className={styles.mobileTitleArrow}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </div>
              </div>
              <div className={styles.mobileHeroSubtext}>
                {(() => {
                  const totalMembers = typeof comm.memberCount === 'number'
                    ? comm.memberCount
                    : (typeof comm.members === 'number'
                      ? comm.members
                      : (Array.isArray(comm.members) ? comm.members.length : (comm.memberList?.length || 0)));
                  return `${formatCount(totalMembers)} members \u00a0 ${formatCount(comm.online || 0)} active`;
                })()}
              </div>
            </div>
          </div>

          <div className={styles.mobileHeroDescWrapper}>
            <p className={styles.mobileHeroDescLine}>
              {comm.description || comm.desc}
            </p>
          </div>

          <div className={styles.mobileHeroButtonsRow}>
            {joined && (
              <button
                type="button"
                className={styles.mobileNotificationBtn}
                onClick={onMuteClick}
              >
                {isMuted ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.268 21a2 2 0 0 0 3.464 0" />
                    <path d="M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742" />
                    <path d="m2 2 20 20" />
                    <path d="M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8v7a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2z" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                )}
              </button>
            )}
            <button
              className={`${styles.mobileJoinBtn}${joined ? ` ${styles.joined}` : ''}`}
              onClick={onToggleJoin}
              disabled={joining}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}
            >
              {joining ? (
                <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px', borderColor: joined ? 'currentColor' : 'white', borderTopColor: 'transparent' }} />
              ) : null}
              {joined ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Joined
                </>
              ) : (
                'Join'
              )}
            </button>
          </div>
        </div>
      </div>

      {cropFile && (
        <MediaCropper
          imageFile={cropFile}
          aspect={cropType === 'avatar' ? 1 : 5}
          cropShape={cropType === 'avatar' ? 'round' : 'rect'}
          onCropComplete={handleCropComplete}
          onCancel={() => {
            setCropFile(null);
            setCropType(null);
          }}
        />
      )}
    </div>
  );
}

function AboutCard({ comm }) {
  // Handle local storage migration of goals -> rules
  const displayRules = comm.rules || comm.goals;

  const dateObj = comm.createdAt ? new Date(comm.createdAt) : new Date(1729000000000); // Fallback to Oct 2024
  const formattedDate = dateObj.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long'
  });

  return (
    <div className={styles.aboutCard}>
      <div>
        <h4 className={styles.sectionLabel}>About</h4>
        <p className={styles.aboutDesc}>{comm.description || comm.desc}</p>
        <div className={styles.createdDateRow}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={styles.createdDateIcon}>
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span>Created {formattedDate}</span>
        </div>
        <div className={styles.createdDateRow}>
          {comm.privacy === 'private' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={styles.createdDateIcon}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={styles.createdDateIcon}>
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          )}
          <span>{comm.privacy === 'private' ? 'Private' : 'Public'}</span>
        </div>
      </div>

      {comm.interests && comm.interests.length > 0 && (
        <div className={styles.interestsSection}>
          <h4 className={styles.sectionLabel}>Interests</h4>
          <div className={styles.interestsTags}>
            {comm.interests.map((interest, i) => (
              <span key={i} className={styles.interestTag}>{interest}</span>
            ))}
          </div>
        </div>
      )}

      {displayRules && displayRules.length > 0 && (
        <div className={styles.rulesSection}>
          <h4 className={styles.sectionLabel}>Community Rules</h4>
          <ul className={styles.rulesList}>
            {displayRules.map((rule, i) => (
              <li key={i} className={styles.ruleItem}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {rule}
              </li>
            ))}
          </ul>
        </div>
      )}


    </div>
  );
}

function GuidelinesCard() {
  return (
    <div className={styles.guidelinesCard}>
      <h4 className={styles.sectionLabel}>Guidelines</h4>
      <div className={styles.guidelinesList}>
        <div className={styles.guidelineItem}>
          <div className={`${styles.guidelineIconWrap} ${styles.guidelineGreen}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
            </svg>
          </div>
          <span className={styles.guidelineText}>Be respectful to everyone</span>
        </div>
        
        <div className={styles.guidelineItem}>
          <div className={`${styles.guidelineIconWrap} ${styles.guidelineBlue}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <span className={styles.guidelineText}>Keep conversations relevant</span>
        </div>

        <div className={styles.guidelineItem}>
          <div className={`${styles.guidelineIconWrap} ${styles.guidelineOrange}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <span className={styles.guidelineText}>No spam or excessive promotion</span>
        </div>

        <div className={styles.guidelineItem}>
          <div className={`${styles.guidelineIconWrap} ${styles.guidelinePurple}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <span className={styles.guidelineText}>Respect everyone's privacy</span>
        </div>
      </div>
    </div>
  );
}


function useSimulatedFetch(data, delay = 0, deps = []) {
  const [isLoading, setIsLoading] = useState(!data);

  useEffect(() => {
    if (data) {
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }
  }, [data, ...deps]);

  return { isLoading: isLoading && !data, data, error: null, retry: () => {} };
}

export default function CommunityView({ communityId, onBack, onPostClick }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { posts, communities: allCommunities, users, currentUser, requestToJoinGroup, addPost, updateCommunity } = useData();
  const { mutate: toggleJoin, isLoading: isJoining } = useJoinCommunity();
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showMobileDetails, setShowMobileDetails] = useState(() => {
    const saved = localStorage.getItem('meetify_show_community_details');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showMuteModal, setShowMuteModal] = useState(false);
  const [showMobileAbout, setShowMobileAbout] = useState(false);
  const [isMobileAboutClosing, setIsMobileAboutClosing] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [hasReported, setHasReported] = useState(false);

  const handleCloseMobileAbout = () => {
    setIsMobileAboutClosing(true);
  };

  const handleMobileAboutAnimationEnd = () => {
    if (isMobileAboutClosing) {
      setShowMobileAbout(false);
      setIsMobileAboutClosing(false);
    }
  };

  useEffect(() => {
    if (showMobileAbout && !isMobileAboutClosing) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [showMobileAbout, isMobileAboutClosing]);

  const { socket, isConnected } = useGlobalSocketStore();
  useEffect(() => {
    if (!socket || !isConnected || !communityId) return;
    socket.emit('community:join_room', { communityId });
    return () => {
      socket.emit('community:leave_room', { communityId });
    };
  }, [socket, isConnected, communityId]);

  const [isMuted, setIsMuted] = useState(() => {
    try {
      const muted = JSON.parse(localStorage.getItem('meetify_muted_communities') || '[]');
      return muted.includes(communityId);
    } catch (e) {
      return false;
    }
  });

  const handleToggleMute = () => {
    let mutedList = [];
    try {
      mutedList = JSON.parse(localStorage.getItem('meetify_muted_communities') || '[]');
    } catch (e) {
      console.error(e);
    }

    if (mutedList.includes(communityId)) {
      mutedList = mutedList.filter(id => id !== communityId);
      setIsMuted(false);
      showToast('Updates from this community will show in your feed.');
    } else {
      mutedList.push(communityId);
      setIsMuted(true);
      showToast('Updates from this community will be hidden.');
    }
    localStorage.setItem('meetify_muted_communities', JSON.stringify(mutedList));
  };
  
  const { data: apiComm, isLoading: isApiLoading, isError: isApiError, error: apiError, refetch: retry } = useCommunityById(communityId);

  const isDeletedError = isApiError && (
    apiError?.response?.status === 404 ||
    apiError?.response?.data?.message === 'COMMUNITY_DELETED' ||
    apiError?.response?.data?.message === 'COMMUNITY_NOT_FOUND' ||
    apiError?.message?.includes('COMMUNITY_DELETED') ||
    apiError?.message?.includes('COMMUNITY_NOT_FOUND')
  );

  const comm = apiComm;
  const isLoading = isApiLoading || (!comm && !isDeletedError && !isApiError);
  const error = isApiError && !isDeletedError;

  const [joining, setJoining] = useState(false);
  const [postLimit, setPostLimit] = useState(15);
  const loadMorePostsRef = useRef(null);

  const userCommunities = useMemo(() => {
    if (!currentUser || !comm) return [];
    return users[currentUser.username]?.communities || currentUser.communities || [];
  }, [users, currentUser, comm]);

  const rawJoined = useMemo(() => {
    if (!comm) return false;
    if (comm.ownerId && currentUser?.id && comm.ownerId === currentUser.id) return true;
    if (comm.userRole === 'OWNER' || comm.userRole === 'MODERATOR' || comm.userRole === 'MEMBER') return true;
    if (comm.isJoined !== undefined && comm.isJoined !== null) return Boolean(comm.isJoined);
    if (Array.isArray(comm.members) && currentUser?.id) {
      return comm.members.some(m => (m.userId || m.id || m.user?.id) === currentUser.id);
    }
    return userCommunities.includes(comm.name);
  }, [comm, currentUser, userCommunities]);

  const entityKey = `joinCommunity:${communityId}`;
  const joined = toggleRegistry.getLatestIntent(entityKey, rawJoined);

  const { data: fetchedPostsData } = useQuery({
    queryKey: ['community-posts', communityId],
    queryFn: async () => {
      const res = await postsApi.getFeed(50, undefined, communityId);
      return res?.posts || (Array.isArray(res) ? res : []);
    },
    enabled: Boolean(communityId),
    staleTime: 10_000,
  });

  const communityPosts = useMemo(() => {
    if (!comm) return [];
    const listFromApi = fetchedPostsData || [];
    const listFromData = (posts || []).filter(p => p.communityId === comm.id);
    const combined = [...listFromApi];
    listFromData.forEach(p => {
      if (!combined.some(existing => existing.id === p.id)) {
        combined.unshift(p);
      }
    });
    return combined;
  }, [comm, fetchedPostsData, posts]);
  const isOwner = comm ? (comm.ownerId === currentUser?.id || comm.userRole === 'OWNER' || (Array.isArray(comm.members) && comm.members.some(m => (m.userId === currentUser?.id || m.user?.id === currentUser?.id) && m.role === 'OWNER'))) : false;
  const isMod = comm ? (comm.userRole === 'MODERATOR' || (Array.isArray(comm.members) && comm.members.some(m => (m.userId === currentUser?.id || m.user?.id === currentUser?.id) && m.role === 'MODERATOR'))) : false;
  const isAdmin = isOwner;

  const visibleCommunityPosts = useMemo(() => communityPosts.slice(0, postLimit), [communityPosts, postLimit]);
  const hasMorePosts = communityPosts.length > visibleCommunityPosts.length;

  useEffect(() => {
    if (!hasMorePosts) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setPostLimit(prev => prev + 15);
        }
      },
      { threshold: 0.1, rootMargin: '200px' }
    );
    if (loadMorePostsRef.current) observer.observe(loadMorePostsRef.current);
    return () => observer.disconnect();
  }, [hasMorePosts]);

  if (isLoading) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.heroSection}>
          <div className={styles.heroCover}>
            <Skeleton type="rect" width="100%" height="100%" style={{ borderRadius: 0 }} />
          </div>
          <div className={styles.heroContent}>
            {/* DESKTOP HERO SKELETON */}
            <div className={styles.desktopHeroLayout}>
              <div className={styles.heroTopRow}>
                <div className={styles.avatarWrapper}>
                  <Skeleton type="circle" width="110px" height="110px" />
                </div>
                <div className={styles.heroMeta} style={{ marginTop: '1rem', gap: '0.6rem' }}>
                  <Skeleton type="text" width="220px" height="2rem" style={{ borderRadius: '8px' }} />
                  <Skeleton type="text" width="160px" height="1rem" style={{ borderRadius: '6px' }} />
                </div>
              </div>
            </div>

            {/* MOBILE HERO SKELETON */}
            <div className={styles.mobileHeroLayout} style={{ padding: '0.75rem 12px 1rem 12px', gap: '0.75rem' }}>
              <div className={styles.mobileHeroTopRow}>
                <Skeleton type="circle" width="56px" height="56px" style={{ flexShrink: 0 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1 }}>
                  <Skeleton type="text" width="60%" height="1.2rem" style={{ borderRadius: '6px' }} />
                  <Skeleton type="text" width="40%" height="0.8rem" style={{ borderRadius: '4px' }} />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <Skeleton type="text" width="90%" height="0.85rem" style={{ borderRadius: '4px' }} />
                <Skeleton type="text" width="65%" height="0.85rem" style={{ borderRadius: '4px' }} />
              </div>
            </div>
          </div>
        </div>

        <div className={styles.main}>
          <div className={styles.leftColumn}>
            <Skeleton type="rect" width="100%" height="90px" style={{ borderRadius: '16px', marginBottom: '1.25rem' }} />
            <PostSkeleton />
            <PostSkeleton />
          </div>
          <div className={styles.rightColumn}>
            <Skeleton type="rect" width="100%" height="280px" style={{ borderRadius: '20px' }} />
          </div>
        </div>
      </div>
    );
  }

function DeletedCommunityView({ onBack }) {
  const navigate = useNavigate();

  return (
    <NotFoundState
      type="community"
      title="Community not found"
      message="This community doesn't exist, has been deleted, or is no longer accessible."
      actionLabel="Back to Communities"
      onAction={() => navigate('/communities')}
      secondaryActionLabel="Back to Home Feed"
      onSecondaryAction={() => navigate('/home')}
      coverPage={true}
    />
  );
}

  if (isApiError || (!isApiLoading && !comm)) {
    const status = apiError?.response?.status;
    const isServerError = status >= 500;

    if (isServerError) {
      return (
        <div className={styles.wrapper} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <ErrorState onRetry={retry} />
        </div>
      );
    }

    return (
      <NotFoundState
        type="community"
        title="Community not found"
        message="This community doesn't exist, has been deleted, or is no longer accessible."
        onAction={() => navigate('/home')}
        coverPage={true}
      />
    );
  }

  const handleToggleJoin = async (e) => {
    if (e) e.stopPropagation();
    const entityKey = `joinCommunity:${communityId}`;
    const nextJoined = toggleRegistry.getNextToggleIntent(entityKey, rawJoined);

    // Private communities require admin approval — send a join request instead of directly joining
    if (!joined && (comm.isPrivate || comm.privacy === 'private')) {
      try {
        const res = await communitiesApi.join(communityId);
        showToast(res?.message || 'Join request sent — waiting for admin approval.');
        queryClient.invalidateQueries({ queryKey: ['community', communityId] });
      } catch (err) {
        showToast(err?.response?.data?.message || err?.message || 'Failed to submit join request');
      }
      return;
    }
    toggleJoin({ communityId, isJoined: nextJoined, currentUser });
    if (nextJoined) {
      setTimeout(() => {
        const inputEl = document.querySelector(`.${styles.composerWrap} div[contenteditable="true"]`) || 
                        document.querySelector(`.${styles.composerWrap} textarea`) || 
                        document.querySelector(`.${styles.composerWrap} input`);
        if (inputEl) {
          inputEl.focus();
          inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 300);
    }
  };

  const handleCreatePostClick = () => {
    if (!joined) {
      toggleJoin({ communityId, isJoined: joined, currentUser });
    }
    setTimeout(() => {
      const inputEl = document.querySelector(`.${styles.composerWrap} div[contenteditable="true"]`) || 
                      document.querySelector(`.${styles.composerWrap} textarea`) || 
                      document.querySelector(`.${styles.composerWrap} input`);
      if (inputEl) {
        inputEl.focus();
        inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);
  };

  const handleDeleteCommunity = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await communitiesApi.delete(communityId);
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      showToast('Community deleted.');
      if (onBack) onBack();
      else navigate('/communities');
    } catch (err) {
      showToast(err?.message || 'Could not delete community.');
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleCommunityPostClick = useCallback((post) => {
    if (onPostClick) onPostClick(post, 'community', comm?.id);
  }, [onPostClick, comm?.id]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.mobileHeader}>
        <button 
          className={styles.backBtn}
          onClick={onBack}
          aria-label="Go back"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
        <div style={{ position: 'relative' }}>
          <button 
            className={styles.backBtn}
            onClick={() => setShowMobileMenu(!showMobileMenu)}
            aria-label="Menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="1"></circle>
              <circle cx="12" cy="5" r="1"></circle>
              <circle cx="12" cy="19" r="1"></circle>
            </svg>
          </button>
          {showMobileMenu && (
            <div className={styles.mobileDropdownMenu}>
              <button 
                onClick={() => {
                  setShowShareModal(true);
                  setShowMobileMenu(false);
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
                Share
              </button>
              <button 
                onClick={() => {
                  setShowMembersModal(true);
                  setShowMobileMenu(false);
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                Members
              </button>
              {isAdmin ? (
                <>
                  <button 
                    onClick={() => {
                      setShowAdminModal(true);
                      setShowMobileMenu(false);
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    Settings
                  </button>
                </>
              ) : (
                <button 
                  onClick={() => {
                    setShowMobileMenu(false);
                    if (!hasReported) setShowReportModal(true);
                  }}
                  disabled={hasReported}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  {hasReported ? 'Reported' : 'Report'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <HeroSection
        comm={comm}
        joined={joined}
        joining={joining}
        onToggleJoin={handleToggleJoin}
        onCreatePost={handleCreatePostClick}
        userCommunities={userCommunities}
        isAdmin={isAdmin}
        onOpenAdmin={() => setShowAdminModal(true)}
        onUpdateCommunity={updateCommunity}
        onViewMembers={() => {
          setShowMembersModal(true);
        }}
        isMuted={isMuted}
        onMuteClick={() => setShowMuteModal(true)}
        onTitleClick={() => setShowMobileAbout(true)}
        onShare={() => setShowShareModal(true)}
      />

      {showAdminModal && (
        <CommunityAdminModal
          community={comm}
          onClose={() => setShowAdminModal(false)}
          onDeleteCommunity={handleDeleteCommunity}
        />
      )}

      {showMembersModal && (
        <CommunityMembersModal
          members={(() => {
            let list = Array.isArray(comm.members) && comm.members.length > 0
              ? comm.members.map(m => ({
                  id: m.user?.id || m.userId || m.id,
                  name: m.user?.displayName || m.user?.username || m.name || m.username || 'Member',
                  username: m.user?.username || m.username,
                  avatar: m.user?.avatar || m.avatar,
                  role: m.role === 'OWNER' || (comm.ownerId && (m.user?.id || m.userId || m.id) === comm.ownerId) ? 'Owner' : (m.role === 'MODERATOR' ? 'Moderator' : 'Member'),
                  admin: m.role === 'OWNER' || (comm.ownerId && (m.user?.id || m.userId || m.id) === comm.ownerId),
                }))
              : (comm.memberList || []);

            if ((!list || list.length === 0) && comm.ownerId) {
              const ownerUser = comm.owner || (currentUser?.id === comm.ownerId ? currentUser : (users && users[comm.ownerId]));
              list = [{
                id: comm.ownerId,
                name: ownerUser?.displayName || ownerUser?.username || 'Owner',
                username: ownerUser?.username || '',
                avatar: ownerUser?.avatar || '',
                role: 'Owner',
                admin: true,
              }];
            }
            return list;
          })()}
          title="Members"
          communityId={comm.id}
          isAdmin={isOwner}
          ownerId={comm.ownerId}
          onClose={() => setShowMembersModal(false)}
        />
      )}

      {showShareModal && (
        <ShareCommunityModal 
          isOpen={showShareModal} 
          onClose={() => setShowShareModal(false)} 
          community={comm} 
        />
      )}

      <ConfirmModal
        visible={showDeleteConfirm}
        title="Delete Community?"
        desc={`Are you sure you want to delete "${comm.name}"? This action is permanent and cannot be undone.`}
        cancelText="No"
        confirmText={deleting ? 'Deleting...' : 'Yes'}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={handleDeleteCommunity}
      />

      {showMobileAbout && createPortal(
        <div 
          className={`${styles.mobileAboutOverlay}${isMobileAboutClosing ? ` ${styles.closing}` : ''}`}
          onAnimationEnd={handleMobileAboutAnimationEnd}
        >
          <div className={styles.mobileAboutHeader}>
            <button 
              className={styles.mobileAboutCloseBtn} 
              onClick={handleCloseMobileAbout}
              aria-label="Go back"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
            </button>
            <h3 className={styles.mobileAboutTitle}>{comm.name}</h3>
          </div>
          <div className={styles.mobileAboutContent}>
            <AboutCard comm={comm} />
            <GuidelinesCard />
          </div>
        </div>,
        document.body
      )}

      {showMuteModal && (
        <div className={styles.muteModalOverlay} onClick={() => setShowMuteModal(false)}>
          <div className={styles.muteModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.muteModalHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0, flex: 1 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--color-primary)' }}>
                  <path d="M10.268 21a2 2 0 0 0 3.464 0" />
                  <path d="M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742" />
                  <path d="m2 2 20 20" />
                  <path d="M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05" />
                </svg>
                <h3 className={styles.muteModalTitle}>Mute this community?</h3>
              </div>
              <button onClick={() => setShowMuteModal(false)} className={styles.muteModalClose}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className={styles.muteModalBody}>
              <p className={styles.muteModalDesc}>
                We'll stop showing posts from this community in your Home feed and recommendations.
              </p>
              <label className={styles.switchToggle}>
                <input
                  type="checkbox"
                  checked={isMuted}
                  onChange={handleToggleMute}
                />
                <span className={styles.switchSlider}></span>
              </label>
            </div>
          </div>
        </div>
      )}

      <div className={styles.main}>
        <div className={styles.leftColumn}>
          <div className={styles.feedHeader}>
            <h2 className={styles.feedTitle}>
              Posts
            </h2>
          </div>

          {comm.canViewPosts === false ? (
            comm.isEligibleToJoin === false ? (
              <div className={styles.emptyPosts} style={{ padding: '3rem 1.5rem', background: 'var(--color-bg-white)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', textAlign: 'center', marginTop: '1rem' }}>
                <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                  </svg>
                </div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: '0 0 0.5rem', color: 'var(--color-text-main)' }}>
                  You're not eligible to join this community.
                </h3>
                <p style={{ fontSize: '0.92rem', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5, maxWidth: '420px', marginLeft: 'auto', marginRight: 'auto' }}>
                  This community is limited to verified students of {comm.college?.name || 'this college'}.
                </p>
              </div>
            ) : (
              <div className={styles.emptyPosts} style={{ padding: '3rem 1.5rem', background: 'var(--color-bg-white)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', textAlign: 'center', marginTop: '1rem' }}>
                <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'rgba(99, 102, 241, 0.1)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: '0 0 0.5rem', color: 'var(--color-text-main)' }}>
                  This Community is Private
                </h3>
                <p style={{ fontSize: '0.92rem', color: 'var(--color-text-muted)', margin: '0 0 1.25rem', lineHeight: 1.5, maxWidth: '420px', marginLeft: 'auto', marginRight: 'auto' }}>
                  Only approved members can view posts and join this community. Send a request to get access.
                </p>
                <button
                  className={styles.emptyJoinBtn}
                  onClick={handleToggleJoin}
                  disabled={joining || comm.hasPendingRequest}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}
                >
                  {comm.hasPendingRequest ? 'Requested' : 'Request to Join'}
                </button>
              </div>
            )
          ) : (
            <>
              {joined && (comm.allowMemberPosts !== false || isAdmin) && (
                <div className={styles.composerWrap}>
                  <PostComposer onSubmit={(text, poll, media, mentions) => addPost(text, poll, communityId, media, mentions)} />
                </div>
              )}

              <div className={styles.postsFeed}>
                {communityPosts.length === 0 ? (
                  <div className={styles.emptyPosts}>
                    <div className={styles.emptyPostsIcon}>
                      {comm.trending ? '🚀' : '💭'}
                    </div>
                    <h3 className={styles.emptyPostsTitle}>
                      This community is waiting for its first post
                    </h3>
                    <p className={styles.emptyPostsDesc}>
                      Share an update, photo, event, or question to get everyone talking.
                    </p>
                    {!joined ? (
                      <button className={styles.emptyJoinBtn} onClick={handleToggleJoin} disabled={joining} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
                        {joining ? (
                          <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px', borderColor: 'white', borderTopColor: 'transparent' }} />
                        ) : null}
                        Join to Post
                      </button>
                    ) : (
                      <button className={styles.emptyJoinBtn} onClick={handleCreatePostClick}>
                        Create Post
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {visibleCommunityPosts.map((p, idx) => (
                      <div key={p.id} className={styles.postWrapper}>
                        <div className={styles.postMetaRow}>
                          {p.authorId && users[p.authorId] && comm.memberList?.find(m => m.name === users[p.authorId]?.displayName)?.admin && (
                            <span className={styles.postAuthorBadge} style={{ background: 'rgba(236, 72, 153, 0.1)', color: '#EC4899', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                              Admin
                            </span>
                          )}
                        </div>
                        <Post key={p.id} postData={p} hideCommunityTag={true} onClick={handleCommunityPostClick} />
                      </div>
                    ))}
                    {hasMorePosts && (
                      <div ref={loadMorePostsRef} style={{ padding: '1.5rem', display: 'flex', justifyContent: 'center' }}>
                        <div className="spinner" style={{ width: '24px', height: '24px', borderWidth: '3px' }} />
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>

        <div className={`${styles.rightColumn} ${!showMobileDetails ? styles.hiddenOnMobile : ''}`}>
          <AboutCard comm={comm} />
          <GuidelinesCard />
        </div>
      </div>

      {comm && (
        <ReportModal
          isOpen={showReportModal}
          onClose={() => setShowReportModal(false)}
          targetType="COMMUNITY"
          targetId={comm.id}
          targetName={comm.name}
          targetAvatar={comm.icon}
          targetPreview={comm.desc || comm.description}
          reportedFrom="community"
          onSubmitted={() => setHasReported(true)}
        />
      )}
    </div>
  );
}
