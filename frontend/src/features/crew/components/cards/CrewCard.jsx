import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isImageUrl } from '@shared/utils/avatar';
import DefaultAvatar from '@shared/components/DefaultAvatar';
import { useData } from '@shared/context/DataContext';
import ShareActivityModal from '../activities/ShareActivityModal';
import ActivityJoinedModal from '../activities/ActivityJoinedModal';
import CalendarIcon from '@shared/components/CalendarIcon';
import styles from './CrewCard.module.css';

/* ── Helpers ───────────────────────────────────────────────── */
function formatDateTime(activity) {
  if (!activity) return '';
  const { date, time, endDate, endTime, duration } = activity;
  if (!date) return '';
  
  const d = new Date(date);
  const dateFormatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (!time) return dateFormatted;

  if (endDate && endTime) {
    const endD = new Date(endDate);
    const endDateFormatted = endD.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (dateFormatted === endDateFormatted) {
      return `${dateFormatted} • ${time} - ${endTime}`;
    } else {
      return `${dateFormatted} • ${time} - ${endDateFormatted} • ${endTime}`;
    }
  }

  // Fallback for old activities
  let endTimeStr = '';
  if (duration) {
    const match = time.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (match) {
      let h = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      const ampm = match[3].toUpperCase();
      if (ampm === 'PM' && h < 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;

      let addHours = 0;
      if (duration.includes('1 hour')) addHours = 1;
      else if (duration.includes('2 hours')) addHours = 2;
      else if (duration.includes('Half day')) addHours = 4;
      else if (duration.includes('All day')) addHours = 8;
      else {
         const hrsMatch = duration.match(/(\d+)/);
         if (hrsMatch) addHours = parseInt(hrsMatch[1], 10);
      }

      if (addHours > 0) {
        h += addHours;
        const endAmPm = h >= 12 && h < 24 ? 'PM' : 'AM';
        let endH = h % 12;
        if (endH === 0) endH = 12;
        const endMStr = m < 10 ? '0' + m : m;
        endTimeStr = ` - ${endH}:${endMStr} ${endAmPm}`;
      }
    }
  }

  return `${dateFormatted} • ${time}${endTimeStr}`;
}

export default function CrewCard({ activity, onClick }) {
  const navigate = useNavigate();
  const [showMenu, setShowMenu] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showJoinedModal, setShowJoinedModal] = useState(false);
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
        
        {(activity.date || activity.dateLabel) && (
          <div className={styles.calendarBadge}>
            <CalendarIcon date={activity.date} dateLabel={activity.dateLabel} />
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
                <button className={styles.dropdownItem} onClick={(e) => { e.stopPropagation(); alert('Host reported.'); setShowMenu(false); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>
                  Report Host
                </button>
                <button className={styles.dropdownItem} onClick={(e) => { e.stopPropagation(); alert('Activities hidden.'); setShowMenu(false); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                  Hide activities from this person
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
                const participantsCount = activity.participants?.length || 1;
                const maxAvatars = Math.min(participantsCount, 5);
                
                let displayUsers = (activity.participants || [])
                  .map(id => Object.values(users || {}).find(u => u.id === id))
                  .filter(Boolean);
                  
                if (displayUsers.length === 0 && activity.hostAvatar) {
                  displayUsers = [{ id: activity.hostId || 'host', avatar: activity.hostAvatar, displayName: activity.hostName }];
                }
                
                while (displayUsers.length < maxAvatars) {
                  displayUsers.push({ id: `dummy-${displayUsers.length}` });
                }
                
                displayUsers = displayUsers.slice(0, 5);
                
                return displayUsers.map((u, i) => (
                  <div 
                    key={u.id} 
                    className={styles.goingAvatarWrap} 
                    style={{ 
                      zIndex: 5 - i
                    }}
                  >
                    {u.avatar && isImageUrl(u.avatar) ? (
                      <img src={u.avatar} alt={u.displayName || "Participant"} className={styles.goingAvatarImg} />
                    ) : (
                      <DefaultAvatar />
                    )}
                  </div>
                ));
              })()}
            </div>
            <span className={styles.goingText}>{activity.participants?.length || 1} going</span>
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
      <ActivityJoinedModal
        isOpen={showJoinedModal}
        onClose={() => setShowJoinedModal(false)}
        activity={activity}
      />
    </div>
  );
}
