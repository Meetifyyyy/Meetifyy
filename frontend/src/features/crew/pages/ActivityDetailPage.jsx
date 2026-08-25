import { useState, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@shared/context/AuthContext';
import { CollegeRepresentativeBadge } from '@shared/components/badges/CollegeRepresentativeBadge';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { useMediaQuery } from '@shared/hooks/useMediaQuery';
import { getRelativeDateLabel } from '@shared/utils/time';
import Avatar from '@shared/components/avatar/Avatar';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import ShareActivityModal from '../components/modals/ShareActivityModal';
import ActivityJoinedModal from '../components/modals/ActivityJoinedModal';
import InviteFriendsModal from '@shared/components/modals/InviteFriendsModal';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import styles from './ActivityDetailPage.module.css';
import { Bookmark, UserPlus } from '@shared/components/icons';
import { useSavedActivitiesStore } from '@shared/stores/savedActivitiesStore';
import { useJoinActivity } from '../hooks/useJoinActivity';
import { useActivityById, useActivityAttendees } from '@shared/hooks/useCrew';
import { toggleRegistry } from '@shared/utils/mutationRegistry';
// Deferred: the discussion pulls its own message page and joins a socket room.
// Loading it with the route made the detail page wait on a module and a request
// that nothing above the fold needs. It mounts once the core content has
// painted and the panel is near the viewport.
const ActivityDiscussion = lazy(() =>
  import('../components/ActivityDiscussion').then(m => ({ default: m.ActivityDiscussion })),
);
import ActivityDetailSkeleton from '../components/ActivityDetailSkeleton';
import NotFoundState from '@shared/components/ui/NotFoundState';
import { activitiesApi, getMediaUrl } from '@shared/api/apiClient';

/* ── Access denied ─────────────────────────────────────────────
 * The server decides access and answers 403 with a code; these are the
 * matching UI states. The copy is intentionally generic — the response the
 * client receives carries no title, description, location, host or attendees
 * for an activity the viewer may not see.
 * ─────────────────────────────────────────────────────────── */
const ACCESS_DENIED_COPY = {
  COLLEGE_RESTRICTED: {
    title: 'This activity is from another college',
    message: "You can't access this activity because it's from another college. Ask the host for an invite if you'd like to join.",
  },
  PRIVATE: {
    title: 'This activity is private',
    message: 'This activity is private and you do not have access. Only people the host invites can view or join it.',
  },
  DEFAULT: {
    title: "You don't have access to this activity",
    message: 'You do not have permission to view this activity.',
  },
};

function LockIcon() {
  return (
    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

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

/**
 * Tail control for the attendee list.
 *
 * The detail payload embeds only the first page of attendees, so a large
 * activity opens fast; the rest are fetched here, on request, one cursor page
 * at a time. Renders nothing when everything is already on screen.
 */
function AttendeesMore({ canExpand, total, shown, onExpand, hasNextPage, isFetching, onLoadMore }) {
  if (isFetching) {
    return <div className={styles.attendeesMore} aria-live="polite">Loading…</div>;
  }
  if (canExpand) {
    const remaining = Math.max((total || 0) - shown, 0);
    return (
      <button type="button" className={styles.attendeesMoreBtn} onClick={onExpand}>
        {remaining > 0 ? `Show all ${total} attendees` : 'Show all attendees'}
      </button>
    );
  }
  if (hasNextPage) {
    return (
      <button type="button" className={styles.attendeesMoreBtn} onClick={() => onLoadMore()}>
        Load more
      </button>
    );
  }
  return null;
}

/* ── Main component ────────────────────────────────────────── */
export default function ActivityDetailPage() {
  const { id } = useParams();
  const cleanId = useMemo(() => id ? id.replace(/^(act_)+/, '') : id, [id]);
  const location = useLocation();
  const { currentUser } = useAuth();
  const goBack = useSmartBack();
  const queryClient = useQueryClient();
  const {
    data: rawActivity,
    isLoading: isActivityLoading,
    isAccessDenied,
    accessDeniedCode,
    accessDeniedMessage,
  } = useActivityById(cleanId);

  const activity = useMemo(() => {
    // rawActivity is the authoritative server data (patched optimistically by useJoinActivity).
    // location.state?.activity is only used as visual scaffolding (title, cover, etc.) while
    // the network request is in-flight — it MUST NOT drive join-sensitive state, and it is
    // discarded outright once the server denies access, so navigation state can never be
    // used to render a restricted activity.
    const baseAct = isAccessDenied ? null : (rawActivity || location.state?.activity);
    if (!baseAct) return null;

    const hostUser = baseAct.creator || baseAct.members?.find(m => m.userId === baseAct.creatorId)?.user;
    const hostId = baseAct.creatorId || hostUser?.id;
    const hostName = hostUser?.displayName || baseAct.members?.find(m => m.userId === baseAct.creatorId)?.user?.displayName || 'Host';
    const hostUsername = hostUser?.username || baseAct.members?.find(m => m.userId === baseAct.creatorId)?.user?.username || 'host';
    const hostAvatar = hostUser?.avatar || baseAct.members?.find(m => m.userId === baseAct.creatorId)?.user?.avatar || '';
    const hostIsCampusRep = hostUser?.isCampusRep || baseAct.members?.find(m => m.userId === baseAct.creatorId)?.user?.isCampusRep || false;

    // Members with status MEMBER (rich objects for the attendee list)
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

    // ── Participant IDs: union of members array AND the preserved participants field ──
    // patchActivity preserves baseAct.participants on every optimistic update so it always
    // reflects the full attendee set even when members is sparse (list-cache shape).
    const memberIds = baseAct.members?.filter(m => m.status === 'MEMBER').map(m => m.userId) || [];
    const preservedIds = (Array.isArray(baseAct.participants) ? baseAct.participants : [])
      .map(p => String(typeof p === 'object' ? (p.id || p.userId || p.user?.id || '') : (p || '')))
      .filter(Boolean);
    const participantIds = Array.from(new Set([
      ...(hostId ? [hostId] : []),
      ...memberIds,
      ...preservedIds,
    ]));

    // ── Build _membersData from participantIds so it always reflects optimistic joins ──
    // The members array may be sparse (list-cache only has take:5). Build the display
    // list from participantIds so any user added optimistically via patchActivity appears
    // immediately, even if their server-side member row isn't loaded yet.
    const memberUserMap = new Map();
    allMembersData.forEach(u => { if (u?.id) memberUserMap.set(String(u.id), u); });

    const enrichedMembersData = participantIds.map(pid => {
      const pidStr = String(pid);
      const known = memberUserMap.get(pidStr);
      if (known) return known;
      // Emit a minimal placeholder for IDs we don't have rich user data for yet.
      // The count will be correct immediately; the name/avatar fills in on next refetch.
      return { id: pidStr, displayName: 'Participant', username: 'participant', avatar: null };
    });

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
      hostIsCampusRep,
      participants: participantIds,
      // The server is authoritative for the total: `members` in the detail
      // payload is only the first page of attendees, so counting the ids we
      // happen to hold would under-report a large activity.
      slotsFilled: typeof baseAct.memberCount === 'number'
        ? baseAct.memberCount
        : participantIds.length,
      memberCount: baseAct.memberCount,
      hasMoreMembers: Boolean(baseAct.hasMoreMembers),
      slotsNeeded: baseAct.maxMembers || 999,
      _membersData: enrichedMembersData
    };
  }, [rawActivity, location.state]);

  // Attendees past the embedded first page load only when asked for.
  // Declared here rather than further down because useActivityAttendees below
  // and the attendeeList memo both read it -- when it lived below them the
  // component threw "Cannot access 'showAllAttendees' before initialization".
  const [showAllAttendees, setShowAllAttendees] = useState(false);

  const {
    attendees: fetchedAttendees,
    hasNextPage: hasMoreAttendees,
    isFetchingNextPage: isFetchingAttendees,
    fetchNextPage: fetchMoreAttendees,
  } = useActivityAttendees(cleanId, { enabled: showAllAttendees });

  // Embedded first page until the user expands, then the paginated list. Both
  // are host-first and share the server's ordering, so expanding does not
  // reshuffle what is already on screen.
  const attendeeList = useMemo(() => {
    const embedded = activity?._membersData || [];
    if (!showAllAttendees || fetchedAttendees.length === 0) return embedded;
    const byId = new Map();
    embedded.slice(0, 1).forEach(u => { if (u?.id) byId.set(String(u.id), u); }); // host leads
    fetchedAttendees.forEach(u => { if (u?.id && !byId.has(String(u.id))) byId.set(String(u.id), u); });
    embedded.forEach(u => { if (u?.id && !byId.has(String(u.id))) byId.set(String(u.id), u); });
    return Array.from(byId.values());
  }, [activity?._membersData, showAllAttendees, fetchedAttendees]);

  const canExpandAttendees =
    !showAllAttendees && Boolean(activity?.hasMoreMembers) && attendeeList.length < (activity?.slotsFilled || 0);

  const { mutate: toggleJoin, isJoinPending } = useJoinActivity();

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

  const endCrewActivity = (actId) => endMutation.mutateAsync(actId);

  const { savedActivities, toggleSaveActivity } = useSavedActivitiesStore();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const containerRef = useRef(null);

  useEffect(() => {
    const solid = activity?.coverColor;
    if (solid) {
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(solid);
      if (m && containerRef.current) {
        containerRef.current.style.setProperty(
          '--extracted-rgb',
          `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}`,
        );
      }
      return;
    }

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
  }, [activity?.coverImage, activity?.coverColor]);

  const [showShareModal, setShowShareModal] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showJoinedModal, setShowJoinedModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const isSaved = savedActivities?.includes(activity?.id);
  const [showHeaderTitle, setShowHeaderTitle] = useState(false);

  // The discussion is the heaviest module on the page (its own paginated fetch
  // plus a realtime subscription), and it sits below the fold. An observer
  // mounts it just before it scrolls into view; `rootMargin` gives it a head
  // start so it is ready by the time it is actually visible.
  // The attendee list exists twice — a desktop copy and a mobile copy, one of
  // which the stylesheet always hides — so every attendee row was built twice.
  // This gates each copy on the SAME 900px breakpoint the stylesheet switches
  // at (NOT the app-wide 768px `useIsMobile`, which would blank the list
  // between 769px and 900px). When the query can't be evaluated, both render,
  // exactly as before.
  const isNarrowLayout = useMediaQuery('(max-width: 900px)');
  const renderDesktopAttendees = isNarrowLayout !== true;
  const renderMobileAttendees = isNarrowLayout !== false;

  const discussionSlotRef = useRef(null);
  const [discussionVisible, setDiscussionVisible] = useState(false);
  useEffect(() => {
    if (discussionVisible) return;
    const node = discussionSlotRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setDiscussionVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some(e => e.isIntersecting)) setDiscussionVisible(true);
      },
      { rootMargin: '300px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [discussionVisible, activity?.id]);

  const handleScroll = (e) => {
    const scrolled = e.target.scrollTop > 50;
    setShowHeaderTitle(prev => prev !== scrolled ? scrolled : prev);
  };


  if (isAccessDenied) {
    const denied = ACCESS_DENIED_COPY[accessDeniedCode] || ACCESS_DENIED_COPY.DEFAULT;
    return (
      <main style={{ gridColumn: '2 / -1', width: '100%', maxWidth: 'none', margin: 0, padding: 0 }}>
        <NotFoundState
          type="activity"
          title={denied.title}
          message={accessDeniedMessage || denied.message}
          icon={<LockIcon />}
          onAction={() => goBack('/home')}
          coverPage={true}
        />
      </main>
    );
  }

  if (isActivityLoading && !activity) {
    return <ActivityDetailSkeleton />;
  }

  if (!activity) {
    return (
      <main style={{ gridColumn: '2 / -1', width: '100%', maxWidth: 'none', margin: 0, padding: 0 }}>
        <NotFoundState
          type="activity"
          onAction={() => goBack('/home')}
          coverPage={true}
        />
      </main>
    );
  }

  const {
    title, description, category, tags,
    date, time, duration, location: actLocation, isOnline,
    participationType, slotsNeeded, slotsFilled,
    hostName, hostAvatar, hostIsCampusRep,
  } = activity;

  const entityKey = `joinActivity:${activity.id}`;
  // isJoined is read EXCLUSIVELY from rawActivity?.isJoined — the authoritative server field
  // patched instantly by applyOptimistic on every join/leave click.
  // We never fall back to activity.participants here because that may be built from the stale
  // location.state?.activity snapshot, which causes a "joined → not joined" flicker after leave.
  // When rawActivity hasn't loaded yet the default is false; it updates the moment the server
  // responds (or immediately on optimistic patch).
  const cacheIsJoined = rawActivity?.isJoined ?? false;
  const isJoined = toggleRegistry.getLatestIntent(entityKey, cacheIsJoined);
  const wasOriginallyJoined = cacheIsJoined;
  // Purely an affordance: the button stays clickable so the user can flip intent
  // mid-flight — useToggleMutation coalesces and the latest intent wins.
  const isJoinBusy = isJoinPending(activity?.id);
  const slotsFilledAdjusted = slotsFilled + (isJoined && !wasOriginallyJoined ? 1 : (!isJoined && wasOriginallyJoined ? -1 : 0));
  const spotsLeft = slotsNeeded - slotsFilledAdjusted;
  const isFull = spotsLeft <= 0;
  const isHost = !!(currentUser?.id && (activity.hostId === currentUser.id || activity.creatorId === currentUser.id));
  const isCancelled = activity.status === 'CANCELLED';
  let hasEnded = activity.status === 'ENDED' || isCancelled;

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

  const handleToggleJoin = () => {
    if (isHost) return;
    // Always derive next intent from registry to handle rapid clicks correctly
    const nextIntent = toggleRegistry.getNextToggleIntent(entityKey, isJoined);
    toggleJoin({ activityId: activity.id, isJoined: nextIntent, currentUser });
  };

  const handleJoin = handleToggleJoin;
  const handleLeave = handleToggleJoin;

  const handleEndActivity = () => {
    setShowEndConfirm(true);
  };

  const confirmEndActivity = async () => {
    setShowEndConfirm(false);
    await endCrewActivity(activity.id);
    goBack('/crew');
  };

  const handleSave = () => {
    toggleSaveActivity(activity.id);
  };

  const coverColor = activity?.coverColor || null;
  const coverImgUrl = activity?.coverImage ? getMediaUrl(activity.coverImage) : getDefaultCover(title || cleanId);

  return (
    <div ref={containerRef} data-theme="dark" className={styles.root}>
      {/* Ambient Blurred Background */}
      <div className={styles.ambientBg}>
        {coverColor ? (
          <div className={styles.ambientImg} style={{ background: coverColor }} />
        ) : (
          <img 
            src={coverImgUrl} 
            alt="" 
            className={styles.ambientImg} 
            onError={(e) => {
              e.target.onerror = null;
              e.target.src = DEFAULT_COVERS[0];
            }}
          />
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
              <Bookmark size={18} strokeWidth={2} fill={isSaved ? 'currentColor' : 'none'} />
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
                      e.target.src = DEFAULT_COVERS[0];
                    }}
                  />
                )}
              </div>

              {renderDesktopAttendees && (
              <div className={`${styles.attendeesSection} ${styles.desktopOnlyAttendees}`}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <h3 className={styles.attendeesTitle} style={{ margin: 0 }}>Attendees ({activity.slotsFilled || activity.participants?.length || 0})</h3>
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
                  {/* _membersData is always ordered: host first, then other members.
                      Both are patched atomically by patchActivity on join/leave. */}
                  {attendeeList.map((pUser, idx) => {
                    if (!pUser) return null;
                    const isThisHost = pUser.id === activity.hostId;
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
                          <div className={styles.attendeeNameRow}>
                            <span className={styles.attendeeName}>{pUser.displayName || pUser.username}</span>
                            <CollegeRepresentativeBadge isCampusRep={pUser.isCampusRep} user={pUser} size="md" />
                          </div>
                          <span className={styles.attendeeRole}>@{pUser.username}{isThisHost ? ' (Host)' : ''}</span>
                        </div>
                      </div>
                    );
                  })}
                  <AttendeesMore
                    canExpand={canExpandAttendees}
                    total={activity.slotsFilled}
                    shown={attendeeList.length}
                    onExpand={() => setShowAllAttendees(true)}
                    hasNextPage={showAllAttendees && hasMoreAttendees}
                    isFetching={isFetchingAttendees}
                    onLoadMore={fetchMoreAttendees}
                  />
                </div>
              </div>
              )}
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
                    size="44px"
                  />
                  <div className={styles.hostMeta}>
                    <span className={styles.hostedBy}>Hosted by</span>
                    <div className={styles.hostNameRow}>
                      <span className={styles.hostName}>{hostName}</span>
                      <CollegeRepresentativeBadge 
                        isCampusRep={hostIsCampusRep} 
                        collegeName={activity.hostCollege?.name || activity.hostCollege || activity.collegeName || activity.college?.name} 
                        user={activity.creator} 
                        size="md" 
                      />
                    </div>
                  </div>
                </div>
              </div>

              {description && description.trim() && (
                <p className={styles.description}>{description}</p>
              )}

              {/* Mobile Attendees Section */}
              {renderMobileAttendees && (
              <div className={`${styles.attendeesSection} ${styles.mobileOnlyAttendees}`}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <h3 className={styles.attendeesTitle} style={{ margin: 0 }}>Attendees ({activity.slotsFilled || activity.participants?.length || 0})</h3>
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
                  {attendeeList.map((pUser, idx) => {
                    if (!pUser) return null;
                    const isThisHost = pUser.id === activity.hostId;
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
                          <div className={styles.attendeeNameRow}>
                            <span className={styles.attendeeName}>{pUser.displayName || pUser.username}</span>
                            <CollegeRepresentativeBadge isCampusRep={pUser.isCampusRep} user={pUser} size="md" />
                          </div>
                          <span className={styles.attendeeRole}>@{pUser.username}{isThisHost ? ' (Host)' : ''}</span>
                        </div>
                      </div>
                    );
                  })}
                  <AttendeesMore
                    canExpand={canExpandAttendees}
                    total={activity.slotsFilled}
                    shown={attendeeList.length}
                    onExpand={() => setShowAllAttendees(true)}
                    hasNextPage={showAllAttendees && hasMoreAttendees}
                    isFetching={isFetchingAttendees}
                    onLoadMore={fetchMoreAttendees}
                  />
                </div>
              </div>
              )}

              {/* Discussion — mounted only once it is near the viewport. */}
              <div ref={discussionSlotRef}>
                {discussionVisible && (
                  <Suspense fallback={<div className={styles.discussionPlaceholder} aria-hidden="true" />}>
                    <ActivityDiscussion variant="inline" activityId={activity.id} />
                  </Suspense>
                )}
              </div>
            </div>
          </div>
        </div>



        {/* Sticky Action Bar */}
        {typeof document !== 'undefined' && createPortal(
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
                type="button"
                className={`${styles.joinBtn} ${styles.joinedBtn}`} 
                onClick={handleLeave}
                aria-busy={isJoinBusy}
                data-pending={isJoinBusy ? 'true' : undefined}
              >
                <span className={styles.imInContent}>
                  <img src="/thumbs_up_3d.png" alt="" className={`${styles.thumbsEmoji} ${styles.thumbsEmojiJoined}`} />
                  <span>I'm in</span>
                </span>
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
                type="button"
                className={styles.joinBtn} 
                onClick={handleJoin} 
                disabled={isFull || activity?.canJoin === false}
                aria-busy={isJoinBusy}
                data-pending={isJoinBusy ? 'true' : undefined}
              >
                {isFull ? (
                  'Activity Full'
                ) : (
                  <span className={styles.imInContent}>
                    <img src="/thumbs_up_3d.png" alt="" className={`${styles.thumbsEmoji} ${isJoined ? styles.thumbsEmojiJoined : ''}`} />
                    <span>I'm in</span>
                  </span>
                )}
              </button>
            )}
          </div>,
          document.body
        )}

        {/* Modals */}
        <ShareActivityModal isOpen={showShareModal} onClose={() => setShowShareModal(false)} activity={activity} />
        <ConfirmModal 
          title="Cancel Activity" 
          desc="This will cancel the activity and notify all participants." 
          visible={showEndConfirm} 
          onCancel={() => setShowEndConfirm(false)} 
          onConfirm={confirmEndActivity} 
          confirmText="Yes" 
          cancelText="No" 
          isDestructive={true} 
        />
      </div>
    </div>
  );
}
