import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../../context/DataContext';
import { useSimulatedFetch } from '../../hooks/useSimulatedFetch';
import { showToast } from '../../utils/toast';
import { isImageUrl } from '../../utils/avatar';
import DefaultAvatar from '../common/DefaultAvatar';
import Skeleton from '../common/Skeleton';
import { ErrorState } from '../common/StateViews';
import Post from '../feed/Post';
import PostComposer from '../feed/PostComposer';
import PostSkeleton from '../feed/PostSkeleton';
import CommunityMembersModal from './CommunityMembersModal';
import CommunityAdminModal from './CommunityAdminModal';
import styles from './CommunityView.module.css';
import { useMediaViewer } from '../../context/MediaViewerContext';
import ShareCommunityModal from './ShareCommunityModal';

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

function HeroSection({ comm, joined, onToggleJoin, onCreatePost, userCommunities, onViewMembers, isAdmin, onOpenAdmin, onUpdateCommunity, isMuted, onMuteClick }) {
  const navigate = useNavigate();
  const { openViewer } = useMediaViewer();
  const coverInputRef = useRef(null);
  const avatarInputRef = useRef(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    setImgError(false);
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
    if (file) {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        await onUpdateCommunity(comm.id, { [field]: ev.target.result });
        showToast(`${field === 'coverImage' ? 'Cover' : 'Avatar'} updated successfully!`);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className={styles.heroSection}>
      <div className={styles.heroCover}>
        <img
          src={comm.coverImage}
          alt=""
          className={styles.heroCoverImg}
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
        <div className={styles.heroTopRow}>
          <div className={styles.avatarWrapper}>
            <div 
              className={`${styles.heroAvatar} ${isAdmin ? styles.heroAvatarEditable : ''}`} 
              style={{ background: (!isImageUrl(comm.avatar) || imgError) ? (comm.color || 'var(--color-primary)') : 'var(--color-bg-white)' }}
              onClick={isAdmin ? () => avatarInputRef.current?.click() : undefined}
            >
              {isImageUrl(comm.avatar) && !imgError ? (
                <img src={comm.avatar} alt={comm.name} className={styles.heroAvatarImg} onError={() => setImgError(true)} />
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
            >
              {joined ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Joined
                </>
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
                      setShowShareModal(true);
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
          <div 
            className={styles.memberStackClickable} 
            onClick={() => {
              if (onViewMembers) onViewMembers();
            }} 
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}
            title="View members"
          >
            <div className={styles.memberStack}>
              {(comm.memberList?.length ? comm.memberList : []).slice(0, 4).map((m, i) => (
                <div
                  key={i}
                  className={styles.memberAvatar}
                  style={{ zIndex: 4 - i, background: 'var(--color-bg-alt)', padding: 0, overflow: 'hidden' }}
                >
                  {isImageUrl(m.avatar) ? (
                    <img
                      src={m.avatar}
                      alt={m.name || ''}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', borderRadius: '50%' }}
                    />
                  ) : (
                    <DefaultAvatar style={{ width: '100%', height: '100%', borderRadius: '50%', fontSize: '0.65rem' }} />
                  )}
                </div>
              ))}
              {comm.members > 4 && (
                <div className={styles.memberOverflow}>
                  +{formatCount(comm.members - 4)}
                </div>
              )}
            </div>
            <div className={styles.heroCounts}>
              <span className={styles.heroCount}>
                <strong>{formatCount(Math.max(comm.members || 0, comm.memberList?.length || 0))}</strong> members
              </span>
              <span className={styles.heroCount}>
                <span className={styles.onlineDot} />
                <strong>{formatCount(comm.online)}</strong> active now
              </span>
            </div>
          </div>
        </div>
      </div>
      <ShareCommunityModal 
        isOpen={showShareModal} 
        onClose={() => setShowShareModal(false)} 
        community={comm} 
      />
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
        <p className={styles.aboutDesc}>{comm.desc}</p>
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


export default function CommunityView({ communityId, onBack, onPostClick }) {
  const { posts, communities: allCommunities, users, currentUser, toggleJoinCommunity, addPost, updateCommunity } = useData();
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [showMobileDetails, setShowMobileDetails] = useState(() => {
    const saved = localStorage.getItem('meetify_show_community_details');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showMuteModal, setShowMuteModal] = useState(false);
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
  
  const rawComm = allCommunities[communityId];
  const { isLoading, data: comm, error, retry } = useSimulatedFetch(rawComm, 800, [communityId]);

  if (isLoading) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.mobileHeader}>
          <button className={styles.backBtn} onClick={onBack}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <Skeleton type="text" width="120px" height="1.5rem" style={{ margin: 0 }} />
        </div>
        <div className={styles.heroSection}>
          <Skeleton type="rect" width="100%" height="240px" style={{ borderRadius: 0 }} />
        </div>
        <div className={styles.main}>
          <div className={styles.leftColumn}>
            <Skeleton type="rect" width="100%" height="140px" style={{ marginBottom: '1.5rem' }} />
            <PostSkeleton />
            <PostSkeleton />
          </div>
          <div className={`${styles.rightColumn} ${!showMobileDetails ? styles.hiddenOnMobile : ''}`}>
            <Skeleton type="rect" width="100%" height="400px" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.wrapper} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <ErrorState onRetry={retry} />
      </div>
    );
  }

  if (!comm) return null;

  const userCommunities = users[currentUser?.username]?.communities || currentUser?.communities || [];
  const joined = userCommunities.includes(comm.name);
  const communityPosts = posts.filter(p => p.communityId === comm.id);
  const isAdmin = comm.memberList?.some(m => m.id === currentUser?.id && m.admin);

  const handleToggleJoin = (e) => {
    e.stopPropagation();
    toggleJoinCommunity(communityId);
    if (!joined) {
      showToast(`Welcome to ${comm.name}! 🎉`);
      // Scroll to post composer after joining
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
      toggleJoinCommunity(communityId);
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
        <h1 className={styles.mobileTitle}>{comm.name}</h1>
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
                  const newVal = !showMobileDetails;
                  setShowMobileDetails(newVal);
                  localStorage.setItem('meetify_show_community_details', JSON.stringify(newVal));
                  setShowMobileMenu(false);
                }}
              >
                {showMobileDetails ? 'Hide Details' : 'Show Details'}
              </button>
            </div>
          )}
        </div>
      </div>

      <HeroSection
        comm={comm}
        joined={joined}
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
      />

      {showAdminModal && (
        <CommunityAdminModal
          community={comm}
          onClose={() => setShowAdminModal(false)}
        />
      )}

      {showMembersModal && (
        <CommunityMembersModal
          members={comm.memberList}
          title={`${comm.name} Members`}
          onClose={() => setShowMembersModal(false)}
        />
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

          {joined && (
            <div className={styles.composerWrap}>
              <PostComposer onSubmit={(text, poll, media) => addPost(text, poll, comm.id, media)} />
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
                  <button className={styles.emptyJoinBtn} onClick={handleToggleJoin}>
                    Join to Post
                  </button>
                ) : (
                  <button className={styles.emptyJoinBtn} onClick={handleCreatePostClick}>
                    Create Post
                  </button>
                )}
              </div>
            ) : (
              communityPosts.map((p, idx) => (
                <div key={p.id} className={styles.postWrapper}>
                  <div className={styles.postMetaRow}>
                    {p.authorId && users[p.authorId] && comm.memberList?.find(m => m.name === users[p.authorId]?.displayName)?.admin && (
                      <span className={styles.postAuthorBadge} style={{ background: 'rgba(236, 72, 153, 0.1)', color: '#EC4899', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                        Admin
                      </span>
                    )}
                  </div>
                  <Post key={p.id} postData={p} hideCommunityTag={true} onClick={() => onPostClick && onPostClick(p, 'community', comm.id)} />
                </div>
              ))
            )}
          </div>
        </div>

        <div className={`${styles.rightColumn} ${!showMobileDetails ? styles.hiddenOnMobile : ''}`}>
          <AboutCard comm={comm} />
          <GuidelinesCard />
        </div>
      </div>
    </div>
  );
}