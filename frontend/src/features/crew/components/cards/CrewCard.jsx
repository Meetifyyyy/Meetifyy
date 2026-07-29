import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isImageUrl } from '@shared/utils/avatar';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import { getProcessedAvatarUrl } from '@shared/components/avatar/Avatar';

import ShareActivityModal from '../modals/ShareActivityModal';
import ActivityJoinedModal from '../modals/ActivityJoinedModal';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import styles from './CrewCard.module.css';
import { useData } from '@shared/hooks/useData';
import ReportModal from '@shared/components/modals/ReportModal/ReportModal';

/* ── Helpers ───────────────────────────────────────────────── */
function formatDateTime(activity) {
  if (!activity) return '';
  const startRaw = activity.startDate || activity.date;
  if (!startRaw) return '';
  
  const startD = new Date(startRaw);
  if (isNaN(startD.getTime())) return '';

  const endRaw = activity.endDate;
  const endD = endRaw ? new Date(endRaw) : null;

  const startDateFormatted = startD.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const startTimeStr = activity.time || startD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  if (endD && !isNaN(endD.getTime())) {
    const endDateFormatted = endD.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const endTimeStr = activity.endTime || endD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    if (startDateFormatted === endDateFormatted) {
      return `${startDateFormatted} • ${startTimeStr} – ${endTimeStr}`;
    } else {
      return `${startDateFormatted} • ${startTimeStr} → ${endDateFormatted} • ${endTimeStr}`;
    }
  }

  return `${startDateFormatted} • ${startTimeStr}`;
}

export default function CrewCard({ activity, onClick }) {
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

  const { 
    title, description, dateLabel, time, location,
    hostName, hostAvatar, hostUsername, slotsNeeded, slotsFilled,
    category
  } = activity;

  const { savedActivities, toggleSaveActivity, joinCrewActivity, requestToJoinActivity, currentUser, users } = useData();
  
  const hasRequested = activity.pendingRequests?.includes(currentUser?.id);
  const isSaved = savedActivities?.includes(activity.id);
  const isJoined = activity.participants?.includes(currentUser?.id);
  const isApproval = activity.participationType === 'approval';

  const handleSave = (e) => {
    e.stopPropagation();
    toggleSaveActivity(activity.id);
  };

  const filled = Math.min(slotsFilled, slotsNeeded);

  return (
    <div 
      className={styles.card} 
      onClick={() => onClick(activity.id)}
      style={{ 
        zIndex: showMenu ? 100 : 1
      }}
    >
      
      {/* Left Column: Cover Image & Calendar Badge */}
      <div className={styles.coverCol}>
        {activity.coverImage ? (
          <img src={activity.coverImage} alt={title} className={styles.coverImg} />
        ) : (
          <div className={styles.coverPlaceholder} />
        )}
        
        {(activity.startDate || activity.date || activity.dateLabel) && (
          <div className={styles.calendarBadge}>
            <CalendarIcon date={activity.startDate || activity.date} dateLabel={activity.dateLabel} style={{ border: '3.5px solid var(--color-bg-white, #ffffff)', boxShadow: 'none' }} />
          </div>
        )}
      </div>

      {/* Right Column: Details */}
      <div className={styles.body}>
        
        <div className={styles.topRow}>
          <div className={styles.timeLabel}>
            {formatDateTime(activity)}
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

        <h3 className={styles.title}>{title?.length > 30 ? title.slice(0, 30) + '..' : title}</h3>

        <div className={styles.bottomRow}>
          <div className={styles.goingLine} style={{ cursor: 'default' }}>
            <div className={styles.goingAvatarsGroup}>
              {(() => {
                const seenIds = new Set();
                const displayUsers = [];
                
                // Add host if present
                if (activity.hostAvatar || activity.hostName) {
                  const hId = activity.hostId || 'host';
                  displayUsers.push({
                    id: hId,
                    avatar: activity.hostAvatar,
                    displayName: activity.hostName
                  });
                  seenIds.add(hId);
                }
                
                // Add participants from store users or _membersData
                const participantIds = activity.participants || [];
                const memberObjs = activity._membersData || [];
                
                participantIds.forEach(id => {
                  if (seenIds.has(id)) return;
                  const uObj = Object.values(users || {}).find(u => u.id === id) || memberObjs.find(m => m?.id === id);
                  if (uObj) {
                    displayUsers.push({
                      id: uObj.id || id,
                      avatar: uObj.avatar || uObj.profileImage,
                      displayName: uObj.displayName || uObj.name
                    });
                    seenIds.add(id);
                  }
                });

                const finalAvatars = displayUsers.slice(0, 5);

                return finalAvatars.map((u, i) => (
                  <div 
                    key={u.id || i} 
                    className={styles.goingAvatarWrap} 
                    style={{ zIndex: 5 - i }}
                  >
                    {u.avatar && isImageUrl(u.avatar) ? (
                      <img src={getProcessedAvatarUrl(u.avatar)} alt={u.displayName || "Participant"} className={styles.goingAvatarImg} onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.webp'; }} />
                    ) : (
                      <DefaultAvatar />
                    )}
                  </div>
                ));
              })()}
            </div>
            <span className={styles.goingText}>
              {activity.participants?.length || 1} {activity.status === 'ENDED' || activity.status === 'CANCELLED' ? 'participated' : 'going'}
            </span>
          </div>
          
          <div className={styles.actionsGroup}>
            <button className={`${styles.saveBtn} ${isSaved ? styles.saved : ''}`} aria-label={isSaved ? "Unsave" : "Save"} onClick={handleSave}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill={isSaved ? "currentColor" : "none"} stroke={isSaved ? "none" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
              </svg>
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
