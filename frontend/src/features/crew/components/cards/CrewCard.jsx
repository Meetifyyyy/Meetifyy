import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { isImageUrl } from '@shared/utils/avatar';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import { getProcessedAvatarUrl } from '@shared/components/avatar/Avatar';

import ShareActivityModal from '../modals/ShareActivityModal';
import ActivityJoinedModal from '../modals/ActivityJoinedModal';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import styles from './CrewCard.module.css';
import { useSavedActivitiesStore } from '@shared/stores/savedActivitiesStore';
import ReportModal from '@shared/components/modals/ReportModal/ReportModal';
import { getMediaUrl } from '@shared/api/apiClient';
import { Bookmark } from '@shared/components/icons';

import { useAuth } from '@shared/context/AuthContext';
import { openVerificationModal } from '@shared/stores/verificationModalStore';
import {
  DEFAULT_ACTIVITY_COVERS,
  getDefaultActivityCover as getDefaultCover,
} from '@shared/utils/activityCover';


function formatDateTime(activity) {
  if (!activity) return '';
  const startRaw = activity.startDate || activity.date || activity.createdAt;
  if (!startRaw) return '';
  
  const startD = new Date(startRaw);
  if (isNaN(startD.getTime())) return '';

  const endRaw = activity.endDate;
  const endD = endRaw ? new Date(endRaw) : new Date(startD.getTime() + 60 * 60 * 1000);

  const startDateFormatted = startD.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const startTimeStr = activity.time || startD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  if (endD && !isNaN(endD.getTime())) {
    const endDateFormatted = endD.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endTimeStr = activity.endTime || endD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    if (startDateFormatted === endDateFormatted) {
      return `${startDateFormatted} • ${startTimeStr} – ${endTimeStr}`;
    } else {
      return `${startDateFormatted} • ${startTimeStr} → ${endDateFormatted} • ${endTimeStr}`;
    }
  }

  return `${startDateFormatted} • ${startTimeStr}`;
}

/**
 * Derives a deduplicated attendee list and count from the canonical sources:
 * - `activity.participants` — the authoritative flat ID list (preserved by patchActivity on
 *    every optimistic update, so it always reflects the correct attendee set)
 * - `activity.members`     — optional rich objects used as a data LOOKUP for avatar/displayName
 *
 * Never skip participants based on members.length — members is sparse in list-cache items.
 * Returns { list: Array<{id,avatar,displayName}>, count: number }.
 */
/**
 * Builds the avatar stack for a card.
 *
 * Enrichment comes from the activity payload itself (the feed select ships
 * `members[].user` for the handful of avatars a card shows). It used to fall
 * back to the global user store, which meant an `Object.values(users).find()`
 * scan per participant per card per render — O(participants x users) work on
 * every list render, for data the payload already carried.
 */
function deriveAttendees(activity) {
  const rawParticipants = Array.isArray(activity?.participants) ? activity.participants : [];
  const rawMembers      = Array.isArray(activity?.members)      ? activity.members      : [];

  // Build a userId → member object lookup for rich avatar/name data
  const memberMap = new Map();
  rawMembers.forEach(m => {
    if (!m) return;
    const uid = String(m.userId || m.id || m.user?.id || '');
    if (uid) memberMap.set(uid, m);
  });

  const list    = [];
  const seenIds = new Set();

  // ── 1. Host always leads ────────────────────────────────────────────────────
  const hostId   = String(activity?.hostId || activity?.creatorId || activity?.creator?.id || activity?.host?.id || '');
  const hostAvatar = activity?.hostAvatar || activity?.creator?.avatar || activity?.host?.avatar || activity?.user?.avatar;
  const hostName   = activity?.hostName   || activity?.creator?.displayName || activity?.host?.displayName || activity?.user?.displayName || 'Host';
  if (hostId) {
    list.push({ id: hostId, avatar: hostAvatar, displayName: hostName });
    seenIds.add(hostId);
  }

  // ── 2. All participants (canonical) — enrich from members map or user store ─
  rawParticipants.forEach(p => {
    const uid = String(typeof p === 'object' ? (p.id || p.userId || p.user?.id || '') : (p || ''));
    if (!uid || seenIds.has(uid)) return;

    const m = memberMap.get(uid);

    list.push({
      id: uid,
      avatar:      m?.user?.avatar || m?.avatar || (typeof p === 'object' ? p.avatar : null),
      displayName: m?.user?.displayName || m?.displayName || (typeof p === 'object' ? p.displayName : 'Participant'),
    });
    seenIds.add(uid);
  });

  // ── 3. Any members not already in participants (detail-cache-only entries) ──
  rawMembers
    .filter(m => m && (!m.status || m.status === 'MEMBER' || m.status === 'ACCEPTED'))
    .forEach(m => {
      const uid = String(m.userId || m.id || m.user?.id || '');
      if (!uid || seenIds.has(uid)) return;
      list.push({
        id: uid,
        avatar:      m.user?.avatar || m.avatar,
        displayName: m.user?.displayName || m.displayName || 'Participant',
      });
      seenIds.add(uid);
    });

  return { list, count: Math.max(list.length, 1) };
}

function CrewCard({ activity, onClick, onMouseEnter }) {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [showMenu, setShowMenu] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showJoinedModal, setShowJoinedModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [hasReported, setHasReported] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const activityId = activity?.id;

  // Two narrow store subscriptions instead of the global data hook. Selecting
  // the boolean (not the array) means a card only re-renders when ITS OWN saved
  // state flips, rather than whenever anyone's bookmark changes.
  const isSaved = useSavedActivitiesStore(
    (s) => Boolean(activityId) && s.savedActivities.includes(activityId),
  );
  const toggleSaveActivity = useSavedActivitiesStore((s) => s.toggleSaveActivity);

  const attendees = useMemo(() => deriveAttendees(activity), [activity]);

  const handleSave = useCallback((e) => {
    e.stopPropagation();
    if (activityId) toggleSaveActivity(activityId);
  }, [activityId, toggleSaveActivity]);

  const handleCardClick = useCallback(() => {
    if (currentUser?.verificationStatus !== 'VERIFIED') {
      openVerificationModal('Verify your account to view activity details.');
      return;
    }
    if (activityId) onClick?.(activityId);
  }, [activityId, currentUser?.verificationStatus, onClick]);

  // Hover prefetch: the callers have always passed this, but the card never
  // attached it, so the detail page was never warmed before the click.
  const handleMouseEnter = useCallback(() => {
    if (activityId) onMouseEnter?.(activityId);
  }, [activityId, onMouseEnter]);

  // Every hook above runs unconditionally — the guard has to come after them,
  // or a card whose activity resolves late changes the hook count between
  // renders and React throws.
  if (!activity) return null;

  const {
    title = '', description, dateLabel, time, location,
    hostName, hostAvatar, hostUsername, slotsNeeded, slotsFilled,
    category
  } = activity;

  // A solid-colour cover is an explicit choice, so it must win over the
  // deterministic default-image fallback.
  const coverColor = activity.coverColor || null;
  const coverImgUrl = activity.coverImage ? getMediaUrl(activity.coverImage) : getDefaultCover(title || activity.id);

  return (
    <div 
      className={styles.card} 
      onClick={handleCardClick}
      onMouseEnter={handleMouseEnter}
      style={{ 
        zIndex: showMenu ? 100 : 1
      }}
    >
      
      {/* Left Column: Cover Image & Calendar Badge */}
      <div className={styles.coverCol}>
        {coverColor ? (
          <div
            className={styles.coverImg}
            style={{ background: coverColor }}
            role="img"
            aria-label={title || 'Activity'}
          />
        ) : (
          <img 
            src={coverImgUrl} 
            alt={title || 'Activity'} 
            className={styles.coverImg} 
            onError={(e) => {
              e.target.onerror = null;
              e.target.src = DEFAULT_ACTIVITY_COVERS[0];
            }}
          />
        )}
        
        {(activity.startDate || activity.date || activity.dateLabel || activity.createdAt) && (
          <div className={styles.calendarBadge}>
            <CalendarIcon date={activity.startDate || activity.date || activity.createdAt} dateLabel={activity.dateLabel} style={{ border: '3.5px solid var(--color-bg-white, #ffffff)', boxShadow: 'none' }} />
          </div>
        )}
      </div>

      {/* Right Column: Details */}
      <div className={styles.body}>
        
        <div className={styles.topRow}>
          <div className={styles.timeLabel}>
            {formatDateTime(activity)}
            {/* College tag. Rendered only for college-scoped activities, which
                is what the Campus and College surfaces show — an "Anyone"
                activity has no single college it belongs to. */}
            {activity.visibility === 'COLLEGE_ONLY' && activity.collegeName && (
              <span className={styles.collegeTag} title={activity.collegeName}>
                {activity.collegeName}
              </span>
            )}
          </div>
          <div className={styles.menuContainer} ref={menuRef}>
            <button className={styles.moreBtn} aria-label="More options" onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle>
              </svg>
            </button>
            {showMenu && (
              <div className={styles.dropdownMenu}>
                <button
                  className={styles.dropdownItem}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(false);
                    if (!hasReported) setShowReportModal(true);
                  }}
                  disabled={hasReported}
                  style={{ color: hasReported ? 'var(--color-text-muted)' : 'var(--color-text-main)' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>
                  {hasReported ? 'Already Reported' : 'Report Activity'}
                </button>

                <button className={styles.dropdownItem} onClick={(e) => { e.stopPropagation(); setShowShareModal(true); setShowMenu(false); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="18" cy="5" r="3"></circle>
                    <circle cx="6" cy="12" r="3"></circle>
                    <circle cx="18" cy="19" r="3"></circle>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                  </svg>
                  Share
                </button>
              </div>
            )}
          </div>
        </div>

        <h3 className={styles.title}>{typeof title === 'string' && title.length > 30 ? title.slice(0, 30) + '..' : (title || '')}</h3>

        <div className={styles.bottomRow}>
          <div className={styles.goingLine} style={{ cursor: 'default' }}>
            {/* Single derivation — count and avatars always come from the same list */}
            {(() => {
              const { list, count } = attendees;
              const visibleAvatars = list.slice(0, 5);
              const label = activity.status === 'ENDED' || activity.status === 'CANCELLED' ? 'participated' : 'going';
              return (
                <>
                  <div className={styles.goingAvatarsGroup}>
                    {visibleAvatars.map((u, i) => (
                      <div
                        key={u.id || i}
                        className={styles.goingAvatarWrap}
                        style={{ zIndex: 5 - i }}
                      >
                        {u.avatar && isImageUrl(u.avatar) ? (
                          <img
                            src={getProcessedAvatarUrl(u.avatar)}
                            alt={u.displayName || 'Participant'}
                            className={styles.goingAvatarImg}
                            onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.webp'; }}
                          />
                        ) : (
                          <DefaultAvatar />
                        )}
                      </div>
                    ))}
                  </div>
                  <span className={styles.goingText}>{count} {label}</span>
                </>
              );
            })()}
          </div>
          
          <div className={styles.actionsGroup}>
            <button className={`${styles.saveBtn} ${isSaved ? styles.saved : ''}`} aria-label={isSaved ? "Unsave" : "Save"} onClick={handleSave}>
              <Bookmark size={18} strokeWidth={2} fill={isSaved ? 'currentColor' : 'none'} />
            </button>
          </div>
        </div>
      </div>
      <ShareActivityModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        activity={activity}
      />
      <ReportModal
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
        targetType="ACTIVITY"
        targetId={activity.id}
        targetName={title}
        targetPreview={`${activity.hostName || ''} · ${activity.locationName || activity.location || ''}`}
        reportedFrom="crew"
        onSubmitted={() => setHasReported(true)}
      />
    </div>
  );
}

/**
 * Memoized: the Crew list re-renders on every keystroke in the search box and on
 * every tab change, and without this each of those re-rendered every card.
 * Callers must pass a stable `onClick`.
 */
export default memo(CrewCard);
