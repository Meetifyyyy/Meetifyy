import { useState, useMemo, useEffect, useRef } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { activitiesApi, usersApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { useNotifications } from '@shared/hooks/useNotifications';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { getRelativeDateLabel } from '@shared/utils/time';
import Avatar from '@shared/components/avatar/Avatar';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import ShareActivityModal from '../components/modals/ShareActivityModal';
import ActivityJoinedModal from '../components/modals/ActivityJoinedModal';
import InviteFriendsModal from '@shared/components/modals/InviteFriendsModal';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import styles from './ActivityDetailPage.module.css';
import { UserPlus } from 'lucide-react';
import { useSavedActivitiesStore } from '@shared/stores/savedActivitiesStore';
import { useJoinActivity } from '../hooks/useJoinActivity';
import { useActivityById } from '@shared/hooks/useCrew';
import { toggleRegistry } from '@shared/utils/mutationRegistry';

/* ── Helpers ───────────────────────────────────────────────── */
const DEFAULT_COVERS = [
  'https://images.unsplash.com/photo-1540575467063-178a50c2df87?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1511556532299-8f662fc26c06?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1528605248644-14dd04022da1?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1551818255-e6e10975bc17?q=80&w=800&auto=format&fit=crop',
];

function getDefaultCover(idOrTitle = '') {
  let hash = 0;
  for (let i = 0; i < idOrTitle.length; i++) {
    hash = (hash << 5) - hash + idOrTitle.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % DEFAULT_COVERS.length;
  return DEFAULT_COVERS[idx];
}

function formatDateTime(activity) {
  if (!activity) return '';
  const startRaw = activity.startDate || activity.date || activity.createdAt;
  if (!startRaw) return '';
  
  const startD = new Date(startRaw);
  if (isNaN(startD.getTime())) return '';

  const endRaw = activity.endDate;
  const endD = endRaw ? new Date(endRaw) : new Date(startD.getTime() + 60 * 60 * 1000);

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
  const cleanId = useMemo(() => id ? id.replace(/^(act_)+/, '') : id, [id]);
  const location = useLocation();
  const { currentUser } = useAuth();
  const goBack = useSmartBack();
  const queryClient = useQueryClient();
  const { data: rawActivity, isLoading: isActivityLoading } = useActivityById(cleanId);

  const activity = useMemo(() => {
    // If we have state from navigation, use it initially
    const baseAct = rawActivity || location.state?.activity;
    if (!baseAct) return null;

    const hostUser = baseAct.creator || baseAct.members?.find(m => m.userId === baseAct.creatorId)?.user;
    const hostId = baseAct.creatorId || hostUser?.id;
    const hostName = hostUser?.displayName || baseAct.members?.find(m => m.userId === baseAct.creatorId)?.user?.displayName || 'Host';
    const hostUsername = hostUser?.username || baseAct.members?.find(m => m.userId === baseAct.creatorId)?.user?.username || 'host';
    const hostAvatar = hostUser?.avatar || baseAct.members?.find(m => m.userId === baseAct.creatorId)?.user?.avatar || '';

    // Members with status MEMBER
    const memberObjs = baseAct.members?.filter(m => m.status === 'MEMBER').map(m => m.user).filter(Boolean) || [];
    
    // Ensure host is included in _membersData if missing
    const allMembersData = [...memberObjs];
    if (hostUser && !allMembersData.some(u => u.id === hostUser.id)) {
      allMembersData.unshift(hostUser);
    } else if (!allMembersData.some(u => u.id === hostId)) {
      allMembersData.unshift({
        id: hostId,
        displayName: hostName,
        username: hostUsername,
        avatar: hostAvatar,
      });
    }

    const participantIds = Array.from(new Set([
      ...(baseAct.members?.filter(m => m.status === 'MEMBER').map(m => m.userId) || []),
      ...(hostId ? [hostId] : [])
    ]));

    const startRaw = baseAct.startDate || baseAct.date || baseAct.createdAt;
    const startD = startRaw ? new Date(startRaw) : null;
    const endD = baseAct.endDate ? new Date(baseAct.endDate) : null;

    return {
      ...baseAct,
      date: startRaw || null,
      endDate: baseAct.endDate || null,
      dateFormatted: startD ? startD.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null,
      dateLabel: startD ? startD.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null,
      time: startD ? startD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null,
      endTime: endD ? endD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null,
      hostId,
      hostName,
      hostUsername,
      hostAvatar,
      participants: participantIds,
      pendingRequests: baseAct.members?.filter(m => m.status === 'PENDING').map(m => m.userId) || [],
      slotsFilled: participantIds.length,
      slotsNeeded: baseAct.maxMembers || 999,
      _membersData: allMembersData
    };
  }, [rawActivity, location.state]);

  const { mutate: toggleJoin } = useJoinActivity();

  const requestMutation = useMutation({
    mutationFn: (actId) => activitiesApi.requestToJoinActivity(actId),
    onSuccess: () => queryClient.invalidateQueries(['activities']),
  });

  const endMutation = useMutation({
    mutationFn: (actId) => activitiesApi.cancelCrewActivity(actId),
    onMutate: async (actId) => {
      await queryClient.cancelQueries({ queryKey: ['activity', actId] });
      const previousActivity = queryClient.getQueryData(['activity', actId]);
      if (previousActivity) {
        queryClient.setQueryData(['activity', actId], {
          ...previousActivity,
          status: 'CANCELLED',
        });
      }
      return { previousActivity };
    },
    onError: (err, actId, context) => {
      if (context?.previousActivity) {
        queryClient.setQueryData(['activity', actId], context.previousActivity);
      }
    },
    onSettled: (data, err, actId) => {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      if (actId) queryClient.invalidateQueries({ queryKey: ['activity', actId] });
    },
  });

  const requestToJoinActivity = (actId) => requestMutation.mutateAsync(actId);
  const endCrewActivity = (actId) => endMutation.mutateAsync(actId);

  const { savedActivities, toggleSaveActivity } = useSavedActivitiesStore();
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

  const containerRef = useRef(null);

  useEffect(() => {
    const coverImage = activity?.coverImage;
    if (!coverImage) return;

    let active = true;
    const timer = setTimeout(() => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.src = coverImage;
      img.onload = () => {
        if (!active) return;
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
    }, 50);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [activity?.coverImage]);

  const [hasJoined, setHasJoined] = useState(false);
  const [hasRequested, setHasRequested] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showJoinedModal, setShowJoinedModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const isSaved = savedActivities?.includes(activity?.id);
  const [comment, setComment] = useState('');
  const [showHeaderTitle, setShowHeaderTitle] = useState(false);

  const handleScroll = (e) => {
    const scrolled = e.target.scrollTop > 50;
    setShowHeaderTitle(prev => prev !== scrolled ? scrolled : prev);
  };

  const [comments, setComments] = useState([
    { id: 1, author: 'Jane Doe', text: 'Looking forward to this!', time: '2 hours ago' },
  ]);
  const [isActionLoading, setIsActionLoading] = useState(false);

  if (isActivityLoading && !activity) {
    return (
      <div className={styles.notFound} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ width: '28px', height: '28px', border: '3px solid rgba(255,255,255,0.15)', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginBottom: '12px' }} />
        <span style={{ fontSize: '0.88rem', opacity: 0.7 }}>Loading activity...</span>
      </div>
    );
  }

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

  const entityKey = `joinActivity:${activity.id}`;
  const isJoined = toggleRegistry.getLatestIntent(entityKey, activity.participants?.includes(currentUser?.id));
  const wasOriginallyJoined = activity.participants?.includes(currentUser?.id);
  const slotsFilledAdjusted = slotsFilled + (isJoined && !wasOriginallyJoined ? 1 : (!isJoined && wasOriginallyJoined ? -1 : 0));
  const spotsLeft = slotsNeeded - slotsFilledAdjusted;
  const isFull = spotsLeft <= 0;
  const isHost = !!(currentUser?.id && (activity.hostId === currentUser.id || activity.creatorId === currentUser.id));
  const isRequested = activity.pendingRequests?.includes(currentUser?.id) || hasRequested;
  const isCancelled = activity.status === 'CANCELLED';
  let hasEnded = activity.status === 'ENDED' || isCancelled;
  const hasGroupChat = !!(activity.createEventGroup || activity.createActivityGroup);

  let hasStarted = false;
  const startRaw = activity.startDate || activity.date;
  const endRaw = activity.endDate;

  if (startRaw) {
    const activityStart = new Date(startRaw);
    if (!isNaN(activityStart.getTime())) {
      hasStarted = new Date() >= activityStart;
    }
  }

  if (endRaw) {
    const activityEnd = new Date(endRaw);
    if (!isNaN(activityEnd.getTime()) && new Date() >= activityEnd) {
      hasEnded = true;
    }
  } else if (startRaw) {
    const activityStart = new Date(startRaw);
    if (!isNaN(activityStart.getTime())) {
      let durationHours = 1;
      if (activity.duration) {
        const match = String(activity.duration).match(/(\d+)/);
        if (match) durationHours = parseInt(match[1], 10);
      }
      const calculatedEnd = new Date(activityStart.getTime() + durationHours * 60 * 60 * 1000);
      if (new Date() >= calculatedEnd) {
        hasEnded = true;
      }
    }
  }

  const handleJoin = () => {
    toggleJoin({ activityId: activity.id, isJoined: true, currentUser });
  };

  const handleLeave = () => {
    if (isHost) return;
    toggleJoin({ activityId: activity.id, isJoined: false, currentUser });
  };

  const handleEndActivity = () => {
    setShowEndConfirm(true);
  };

  const confirmEndActivity = async () => {
    setShowEndConfirm(false);
    await endCrewActivity(activity.id);
    navigate(location.state?.from ?? '/crew', { replace: true });
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

  const coverImgUrl = activity?.coverImage || getDefaultCover(title || cleanId);

  return (
    <div ref={containerRef} data-theme="dark" className={styles.root}>
      {/* Ambient Blurred Background */}
      <div className={styles.ambientBg}>
        <img 
          src={coverImgUrl} 
          alt="" 
          className={styles.ambientImg} 
          onError={(e) => {
            e.target.onerror = null;
            e.target.src = DEFAULT_COVERS[0];
          }}
        />
      </div>

      <div className={styles.glass}>
        {/* Top Bar */}
        <div className={styles.topBar}>
          <div className={styles.headerLeft}>
            <button className={styles.backBtn} onClick={() => navigate(location.state?.from ?? '/crew', { replace: true })} aria-label="Go back">
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
            {isHost && !hasStarted && !isCancelled && !hasEnded && (
              <>
                <button
                  className={styles.actionBtn}
                  onClick={() => setShowInviteModal(true)}
                  title="Invite Friends"
                  style={{ color: '#818cf8', background: 'rgba(99, 102, 241, 0.12)', border: '1px solid rgba(99, 102, 241, 0.3)' }}
                >
                  <UserPlus size={17} />
                </button>
                <button
                  className={styles.actionBtn}
                  onClick={handleEndActivity}
                  title="Cancel Activity"
                  style={{ color: '#f87171', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)' }}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </>
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
                <img 
                  src={coverImgUrl} 
                  alt={title || 'Activity'} 
                  className={styles.coverImg} 
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = DEFAULT_COVERS[0];
                  }}
                />
              </div>
            </div>

            {/* Right: Details */}
            <div className={styles.detailsCol}>
              <div className={styles.leftInfoBlock} style={{ marginTop: 0, marginBottom: '2rem' }}>
                <div className={styles.calendarBox}>
                  <CalendarIcon
                    date={activity?.startDate || activity?.date || activity?.createdAt}
                    dateLabel={activity?.dateLabel}
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

              {description && description.trim() && (
                <p className={styles.description}>{description}</p>
              )}

              {/* Attendees Section */}
              <div className={styles.attendeesSection}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <h3 className={styles.attendeesTitle} style={{ margin: 0 }}>Attendees ({activity.participants?.length || 0})</h3>
                  {isHost && !hasStarted && !isCancelled && !hasEnded && (
                    <button
                      type="button"
                      onClick={() => setShowInviteModal(true)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0.4rem 0.85rem',
                        borderRadius: '20px',
                        background: 'rgba(99, 102, 241, 0.15)',
                        border: '1px solid rgba(99, 102, 241, 0.35)',
                        color: '#818cf8',
                        fontWeight: 600,
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                      }}
                    >
                      <UserPlus size={14} />
                      Invite Friends
                    </button>
                  )}
                </div>
                
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
                  
                  {activity._membersData?.filter(u => u && u.id !== activity.hostId).map(pUser => {
                    return (
                      <div 
                        key={pUser.id} 
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

        {/* Sticky Action Bar */}
        <div className={styles.stickyJoinWrap}>
          {isCancelled ? (
            <button className={`${styles.joinBtn} ${styles.endedBtn}`} disabled style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.4)', flex: 1 }}>
              Cancelled
            </button>
          ) : hasEnded ? (
            <button className={`${styles.joinBtn} ${styles.endedBtn}`} disabled style={{ flex: 1 }}>
              Ended
            </button>
          ) : hasStarted ? (
            <button className={`${styles.joinBtn} ${styles.startedBtn}`} disabled>
              Already started!
            </button>
          ) : isHost ? (
            <div style={{ display: 'flex', gap: '0.75rem', flex: 1, minWidth: 0 }}>
              <button className={`${styles.joinBtn} ${styles.joinedBtn}`} disabled style={{ flex: 1, cursor: 'default', padding: '0.8rem 1rem', minWidth: 0 }}>
                Hosted by you
              </button>
              {!hasStarted && (
                <button
                  type="button"
                  className={styles.joinBtn}
                  onClick={() => setShowInviteModal(true)}
                  style={{
                    flex: 1,
                    background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                    color: '#fff',
                    border: 'none',
                    padding: '0.8rem 1rem',
                    minWidth: 0
                  }}
                >
                  <UserPlus size={16} style={{ marginRight: '0.4rem', flexShrink: 0 }} />
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Invite Friends</span>
                </button>
              )}
            </div>
          ) : isJoined ? (
            <button 
              className={`${styles.joinBtn} ${styles.joinedBtn}`} 
              onClick={handleLeave}
              disabled={isActionLoading}
            >
              {isActionLoading ? <span className={styles.btnSpinner} /> : 'Joined'}
            </button>
          ) : activity?.canJoin === false && activity?.joinRestrictionCode === 'COLLEGE_RESTRICTED' ? (
            <button className={`${styles.joinBtn} ${styles.endedBtn}`} disabled style={{ background: 'rgba(239, 68, 68, 0.12)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)' }} title={activity.joinRestrictionReason}>
              Restricted to College
            </button>
          ) : activity?.canJoin === false && activity?.joinRestrictionCode === 'PRIVATE' ? (
            <button className={`${styles.joinBtn} ${styles.endedBtn}`} disabled style={{ background: 'rgba(107, 114, 128, 0.12)', color: '#9ca3af', border: '1px solid rgba(107, 114, 128, 0.3)' }} title={activity.joinRestrictionReason}>
              Invitation Only
            </button>
          ) : (
            <button 
              className={styles.joinBtn} 
              onClick={handleJoin} 
              disabled={isFull || isActionLoading || activity?.canJoin === false}
            >
              {isActionLoading ? <span className={styles.btnSpinner} /> : (isFull ? 'Activity Full' : 'Join Activity')}
            </button>
          )}

          {hasGroupChat && (isHost || isJoined) && (
            <button 
              className={styles.chatIconBtn}
              onClick={() => navigate(`/messages/group/act_${activity.id}`, { state: { from: location.pathname } })}
              title="Open Activity Group Chat"
              aria-label="Open Activity Group Chat"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
              </svg>
            </button>
          )}
        </div>

        {/* Modals */}
        <ShareActivityModal isOpen={showShareModal} onClose={() => setShowShareModal(false)} activity={activity} />
        <ConfirmModal title="Cancel Activity" desc="Are you sure you want to cancel this activity?" visible={showEndConfirm} onCancel={() => setShowEndConfirm(false)} onConfirm={confirmEndActivity} confirmText="Cancel Activity" cancelText="Go Back" />
      </div>
    </div>
  );
}
