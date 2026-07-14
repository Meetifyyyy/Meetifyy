import { useState, useMemo, useEffect, useRef } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { useData } from '@shared/context/DataContext';
import { useNotifications } from '@shared/context/NotificationContext';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { getRelativeDateLabel } from '@shared/utils/time';
import Avatar from '@shared/components/Avatar';
import ConfirmModal from '@shared/components/ConfirmModal';
import ShareActivityModal from '../components/activities/ShareActivityModal';
import ActivityJoinedModal from '../components/activities/ActivityJoinedModal';
import CalendarIcon from '@shared/components/CalendarIcon';
import styles from './ActivityDetailPage.module.css';

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

  // Fallback for old activities without endDate/endTime
  let endTimeStr = '';
  if (duration) {
    const match = time.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (match) {
      let h = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      const ampm = match[3].toUpperCase();
      if (ampm === 'PM' && h !== 12) h += 12;
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

/* ── Details card ──────────────────────────────────────────── */
function DetailsCard({ date, time, duration, actLocation, isOnline, slotsFilled, spotsLeft, activity }) {
  const computedDateLabel = getRelativeDateLabel(date) || activity?.dateLabel;
  return (
    <div className={styles.detailsCard}>
      <h2 className={styles.detailsTitle}>Details</h2>
      <div className={styles.detailsGrid}>
        <div className={styles.detailRow} style={{ alignItems: 'center' }}>
          <CalendarIcon date={date} dateLabel={computedDateLabel} />
          <div>
            <div className={styles.detailLabel}>{computedDateLabel}</div>
            <div className={styles.detailValue}>{new Date(date).toLocaleDateString()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Main component ────────────────────────────────────────── */
export default function ActivityDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const goBack = useSmartBack();

  const { crewActivities, savedActivities, toggleSaveActivity, currentUser, joinCrewActivity, leaveCrewActivity, requestToJoinActivity, endCrewActivity, getUserById } = useData();
  const { addNotification } = useNotifications();
  const navigate = useNavigate();
  const discussionRef = useRef(null);
  const commentInputRef = useRef(null);

  useEffect(() => {
    if (location.search.includes('discussion=1') && discussionRef.current) {
      setTimeout(() => {
        discussionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        commentInputRef.current?.focus();
      }, 300);
    }
  }, [location.search]);

  const activity = useMemo(() => {
    return crewActivities?.find(a => a.id === id) || location.state?.activity;
  }, [crewActivities, id, location.state]);

  const containerRef = useRef(null);

  useEffect(() => {
    const coverImage = activity?.coverImage;
    if (!coverImage) return;

    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = coverImage;
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 10;
        canvas.height = 10;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 10, 10);
        const data = ctx.getImageData(0, 0, 10, 10).data;

        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i+1];
          b += data[i+2];
          count++;
        }
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);

        if (containerRef.current) {
          containerRef.current.style.setProperty('--extracted-rgb', `${r}, ${g}, ${b}`);
        }
      } catch (e) {
        console.warn('Failed to extract dominant color from cover image:', e);
      }
    };
  }, [activity?.coverImage]);

  const [hasJoined, setHasJoined] = useState(false);
  const [hasRequested, setHasRequested] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showJoinedModal, setShowJoinedModal] = useState(false);
  const isSaved = savedActivities?.includes(activity?.id);
  const [comment, setComment] = useState('');
  const [showHeaderTitle, setShowHeaderTitle] = useState(false);

  const handleScroll = (e) => {
    if (e.target.scrollTop > 50) {
      setShowHeaderTitle(true);
    } else {
      setShowHeaderTitle(false);
    }
  };

  const [comments, setComments] = useState([
    { id: 1, author: 'Jane Doe', text: 'Looking forward to this!', time: '2 hours ago' },
  ]);

  if (!activity) {
    return (
      <div className={styles.notFound}>
        <h2>Activity not found</h2>
        <button onClick={() => goBack('/crew')} className={styles.joinBtn} style={{ width: 'auto' }}>
          Back to Crew
        </button>
      </div>
    );
  }

  const {
    title, description, category, tags,
    date, time, duration, location: actLocation, isOnline,
    participationType, slotsNeeded, slotsFilled,
    hostName, hostAvatar,
  } = activity;

  const spotsLeft = slotsNeeded - slotsFilled;
  const isFull = spotsLeft <= 0;
  const isHost = activity.hostId === currentUser?.id;
  const isJoined = activity.participants?.includes(currentUser?.id) || hasJoined;
  const isRequested = activity.pendingRequests?.includes(currentUser?.id) || hasRequested;

  let hasStarted = false;
  if (activity.date && activity.time) {
    const match = activity.time.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (match) {
      let h = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      const ampm = match[3].toUpperCase();
      if (ampm === 'PM' && h < 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      
      const activityStart = new Date(activity.date);
      activityStart.setHours(h, m, 0, 0);
      hasStarted = new Date() >= activityStart;
    }
  }

  const handleJoin = async () => {
    if (participationType === 'open') {
      await joinCrewActivity(activity.id);
      setHasJoined(true);
      setShowJoinedModal(true);
    } else {
      await requestToJoinActivity(activity.id);
      setHasRequested(true);
    }
  };

  const handleLeave = async () => {
    await leaveCrewActivity(activity.id);
    setHasJoined(false);
  };

  const handleEndActivity = () => {
    setShowEndConfirm(true);
  };

  const confirmEndActivity = async () => {
    setShowEndConfirm(false);
    await endCrewActivity(activity.id);
    navigate('/crew');
  };

  const handleSave = () => {
    toggleSaveActivity(activity.id);
  };

  const handlePostComment = (e) => {
    e.preventDefault();
    if (!comment.trim()) return;
    setComments([...comments, { id: Date.now(), author: 'You', text: comment, time: 'Just now' }]);
    if (currentUser?.id !== activity.hostId) {
      const preview = comment.length > 60 ? comment.slice(0, 60) + '...' : comment;
      addNotification('activity_discussion', {
        activityId: activity.id,
        actorId: currentUser?.id,
        text: `commented on your activity: "${preview}"`,
      });
    }
    setComment('');
  };

  return (
    <div ref={containerRef} data-theme="dark" className={styles.root}>
      {/* Ambient Blurred Background */}
      <div className={styles.ambientBg}>
        {activity.coverImage && (
          <img src={activity.coverImage} alt="" className={styles.ambientImg} />
        )}
      </div>

      <div className={styles.glass}>
        {/* Top Bar */}
        <div className={styles.topBar}>
          <div className={styles.headerLeft}>
            <button className={styles.backBtn} onClick={() => goBack('/crew')} aria-label="Go back">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          </div>

          <div className={styles.rightActions}>
            <button className={styles.actionBtn} onClick={() => setShowShareModal(true)} aria-label="Share Activity">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
              </svg>
            </button>
            <button className={`${styles.actionBtn} ${isSaved ? styles.saved : ''}`} aria-label={isSaved ? "Unsave" : "Save"} onClick={handleSave}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill={isSaved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
              </svg>
            </button>
            {activity.createEventGroup && (
              <button className={styles.actionBtn} onClick={() => navigate('/messages')} aria-label="Open Group Chat">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                </svg>
              </button>
            )}
            {isHost && !hasStarted && (
              <button className={styles.actionBtn} onClick={handleEndActivity} title="End Activity">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="9" x2="15" y2="15"></line><line x1="15" y1="9" x2="9" y2="15"></line>
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Scroll Area */}
        <div className={styles.scrollArea} onScroll={handleScroll}>
          {/* Content */}
          <div className={styles.contentRow}>
            {/* Left: Image & Info */}
            <div className={styles.imgCol}>
              <h1 className={styles.mainTitle}>{title?.length > 30 ? title.slice(0, 30) + '...' : title}</h1>
              <div className={styles.imgSquare}>
                {activity.coverImage && (
                  <img src={activity.coverImage} alt={title} className={styles.coverImg} />
                )}
              </div>
            </div>

            {/* Right: Details */}
            <div className={styles.detailsCol}>
              <div className={styles.leftInfoBlock} style={{ marginTop: 0, marginBottom: '2rem' }}>
                <div className={styles.calendarBox}>
                  <CalendarIcon
                    date={activity.date}
                    dateLabel={activity.dateLabel}
                    variant="glass"
                    style={{ width: '32px', height: '32px', borderRadius: '6px', boxShadow: 'none' }}
                    className={styles.noRings}
                  />
                  <div className={styles.timeText}>
                    {formatDateTime(activity)}
                  </div>
                </div>

                <div className={styles.locationBox}>
                  <div className={styles.locIconWrap}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.locIcon}>
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                  </div>
                  <span className={styles.locText}>{actLocation}{isOnline ? ' (Online)' : ''}</span>
                </div>
              </div>

              <div className={styles.hostRow}>
                <div 
                  className={styles.hostLink}
                  onClick={(e) => { e.stopPropagation(); navigate(`/profile/${activity.hostUsername}`); }}
                >
                  <Avatar
                    src={hostAvatar}
                    name={hostName}
                    size="40px"
                  />
                  <div className={styles.hostMeta}>
                    <span className={styles.hostedBy}>Hosted by</span>
                    <span className={styles.hostName}>{hostName}</span>
                  </div>
                </div>
              </div>

              <p className={styles.description}>{description}</p>

              {/* Attendees Section */}
              <div className={styles.attendeesSection}>
                <h3 className={styles.attendeesTitle}>Attendees ({activity.participants?.length || 0})</h3>
                
                <div className={styles.attendeesList}>
                  {activity.participants?.includes(activity.hostId) && (
                    <div 
                      className={styles.attendeeRow}
                      onClick={() => navigate(`/profile/${activity.hostUsername}`)}
                    >
                      <Avatar
                        src={hostAvatar}
                        name={hostName}
                        size="44px"
                        className={styles.attendeeAvatar}
                      />
                      <div className={styles.attendeeMeta}>
                        <span className={styles.attendeeName}>{hostName}</span>
                        <span className={styles.attendeeRole}>@{activity.hostUsername} (Host)</span>
                      </div>
                    </div>
                  )}
                  
                  {activity.participants?.filter(pid => pid !== activity.hostId).map(participantId => {
                    const pUser = getUserById(participantId);
                    if (!pUser) return null;
                    return (
                      <div 
                        key={participantId} 
                        className={styles.attendeeRow}
                        onClick={() => navigate(`/profile/${pUser.username}`)}
                      >
                        <Avatar
                          src={pUser.avatar}
                          name={pUser.displayName || pUser.username}
                          size="44px"
                          className={styles.attendeeAvatar}
                        />
                        <div className={styles.attendeeMeta}>
                          <span className={styles.attendeeName}>{pUser.displayName || pUser.username}</span>
                          <span className={styles.attendeeRole}>@{pUser.username}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sticky Join Button */}
        <div className={styles.stickyJoinWrap}>
          {isJoined ? (
            <button 
              className={`${styles.joinBtn} ${styles.leaveBtn}`} 
              onClick={handleLeave}
            >
              Joined
            </button>
          ) : isRequested ? (
            <button className={styles.joinBtn} disabled>Request Sent</button>
          ) : (
            <button className={styles.joinBtn} onClick={handleJoin} disabled={isFull}>
              {isFull ? 'Activity Full' : participationType === 'open' ? 'Join Activity' : 'Request to Join'}
            </button>
          )}
        </div>

        {/* Modals */}
        <ShareActivityModal isOpen={showShareModal} onClose={() => setShowShareModal(false)} activity={activity} />
        <ConfirmModal title="End Activity" desc="Are you sure you want to end this activity? This will also delete the group chat." visible={showEndConfirm} onCancel={() => setShowEndConfirm(false)} onConfirm={confirmEndActivity} confirmText="End Activity" />
        <ActivityJoinedModal isOpen={showJoinedModal} onClose={() => setShowJoinedModal(false)} activity={activity} />
      </div>
    </div>
  );
}
