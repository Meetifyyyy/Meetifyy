import { useState, useRef, useEffect, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Reply, MoreVertical, Image as ImageIcon, AlertCircle, Play } from '@shared/components/icons';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import Avatar from '@shared/components/avatar/Avatar';
import { isImageUrl } from '@shared/utils/avatar';
import { mediaCache } from '@shared/utils/MediaCacheManager';
import RichText from '@shared/components/mentions/RichText';
import { generateConversationUrl } from '@shared/utils/conversationUrl';
import { isSystemMessage } from '../utils/cacheUtils';
import { SharedPostPreview } from '../previews/SharedPostPreview';
import { SharedProfilePreview } from '../previews/SharedProfilePreview';
import { SharedCommunityPreview } from '../previews/SharedCommunityPreview';
import ReplyPreviewContent from './ReplyPreviewContent';
import { SharedActivityPreview } from '../previews/SharedActivityPreview';
import VoiceMessagePlayer from './VoiceMessagePlayer';
import styles from './ChatMessageList.module.css';
import { useJoinCommunity } from '@features/communities/hooks/useJoinCommunity';
import { useUsersMap } from '@shared/hooks/useUsersMap';
import { checkIsMe, getMsgTimestamp } from '../utils/cacheUtils';
import { getMediaUrl } from '@shared/api/apiClient';

// How long a finger must stay put before the message menu opens, and how far it
// may drift while doing so. The drift budget is what separates a deliberate
// press from the brief pause everyone makes mid-scroll.
const LONG_PRESS_DELAY_MS = 600;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

function MessageHoverActions({ msg, isMe, onReplyTo, onContextMenu }) {
  const handleReply = (e) => {
    e.stopPropagation();
    if (onReplyTo) onReplyTo(msg);
  };

  const handleMore = (e) => {
    e.stopPropagation();
    if (onContextMenu) onContextMenu(e, msg);
  };

  if (!onReplyTo && !onContextMenu) return null;

  return (
    <div className={`${styles.msgHoverActions} ${isMe ? styles.msgHoverActionsMe : styles.msgHoverActionsThem}`}>
      {onReplyTo && (
        <button
          type="button"
          className={styles.msgHoverBtn}
          onClick={handleReply}
          title="Reply"
          aria-label="Reply to message"
        >
          <Reply size={14} />
        </button>
      )}
      {onContextMenu && (
        <button
          type="button"
          className={styles.msgHoverBtn}
          onClick={handleMore}
          title="More options"
          aria-label="More message options"
        >
          <MoreVertical size={14} />
        </button>
      )}
    </div>
  );
}

function SystemMessageContent({ text, navigate }) {
  if (!text) return 'System Event';
  const strText = String(text);

  const regex = /(@\[([^\]]+)\]\(([^)]+)\)|@([a-zA-Z0-9_.-]+))/g;
  const elements = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(strText)) !== null) {
    if (match.index > lastIndex) {
      elements.push(
        <span key={`text_${lastIndex}`} className={styles.systemNonSelectableText}>
          {strText.slice(lastIndex, match.index)}
        </span>
      );
    }

    const fullMention = match[0];
    const mentionUsername = match[2] || match[4] || fullMention.replace(/^@/, '');

    elements.push(
      <span
        key={`mention_${match.index}`}
        className={styles.systemMentionLink}
        onClick={(e) => {
          e.stopPropagation();
          if (navigate && mentionUsername) {
            navigate(`/profile/${mentionUsername}`, { state: { from: window.location.pathname } });
          }
        }}
        title={`View @${mentionUsername}'s profile`}
      >
        @{mentionUsername}
      </span>
    );

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < strText.length) {
    elements.push(
      <span key={`text_${lastIndex}`} className={styles.systemNonSelectableText}>
        {strText.slice(lastIndex)}
      </span>
    );
  }

  return <>{elements}</>;
}

const loadedImageUrls = new Set();

function ImageWithSkeleton({ src, alt, className, onClick, isStandalone = false, onErrorChange, width, height, onClickSrc }) {
  const [loaded, setLoaded] = useState(() => Boolean(src && loadedImageUrls.has(src)));
  const [imgSrc, setImgSrc] = useState(null);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const prevSrcRef = useRef(src);
  const aspect = (width && height) ? (width / height) : 1;

  useEffect(() => {
    if (src === prevSrcRef.current && retryCount === 0) return;
    prevSrcRef.current = src;

    let isMounted = true;
    const resolvedSync = mediaCache.getSyncUrl(src) || src;
    const isCached = Boolean(resolvedSync && loadedImageUrls.has(resolvedSync));

    if (!isCached) {
      setLoaded(false);
    } else {
      setLoaded(true);
    }
    setError(false);
    if (onErrorChange) onErrorChange(false);

    if (!src) {
      setError(true);
      if (onErrorChange) onErrorChange(true);
      return;
    }

    if (resolvedSync) {
      setImgSrc(resolvedSync);
    }

    if (src.startsWith('blob:') || src.startsWith('data:')) {
      setImgSrc(src);
      setLoaded(true);
      if (src) loadedImageUrls.add(src);
      return;
    }

    const fetchUrl = async () => {
      try {
        const resolvedUrl = await mediaCache.getUrl(src);
        if (isMounted) {
          if (resolvedUrl) {
            setImgSrc(resolvedUrl);
            if (loadedImageUrls.has(resolvedUrl)) {
              setLoaded(true);
            }
          } else if (!resolvedSync) {
            setError(true);
            if (onErrorChange) onErrorChange(true);
          }
        }
      } catch (err) {
        if (isMounted && !resolvedSync) {
          setError(true);
          if (onErrorChange) onErrorChange(true);
        }
      }
    };

    fetchUrl();

    return () => {
      isMounted = false;
    };
  }, [src, retryCount]);

  const handleError = () => {
    if (retryCount === 0 && src) {
      mediaCache.invalidate(src);
      setRetryCount(1);
      return;
    }
    setError(true);
    if (onErrorChange) onErrorChange(true);
  };

  const handleImageLoad = () => {
    setLoaded(true);
    const activeUrl = imgSrc || src;
    if (activeUrl) loadedImageUrls.add(activeUrl);
    if (src) loadedImageUrls.add(src);
  };

  if (error) {
    return (
      <div className={`${styles.msgMediaErrorCard} ${isStandalone ? styles.msgMediaErrorStandalone : ''}`}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <span style={{ fontSize: '0.72rem', opacity: 0.6, marginTop: '4px' }}>Unavailable</span>
      </div>
    );
  }

  const finalSrc = imgSrc || src;

  return (
    <div 
      className={`${styles.msgMediaWrapper} ${isStandalone ? styles.msgMediaWrapperStandalone : styles.msgMediaWrapperInline}`} 
      style={{ '--aspect': aspect }}
    >
      {!loaded && (
        <div className={`${styles.msgMediaSkeleton} ${isStandalone ? styles.msgMediaSkeletonStandalone : ''}`}>
          <ImageIcon size={22} className={styles.msgMediaSkeletonIcon} />
        </div>
      )}
      {finalSrc && (
        <img
          src={finalSrc}
          alt={alt || ''}
          decoding="async"
          className={`${className} ${!loaded ? styles.msgMediaImgHidden : styles.msgMediaImgVisible}`}
          onClick={() => onClick && onClick(onClickSrc || finalSrc)}
          onLoad={handleImageLoad}
          onError={handleError}
        />
      )}
    </div>
  );
}

function VideoPlayerWithOverlay({ src, poster = null, duration = null, width = null, height = null, isInline = false, hasText = false, onOpenMediaModal }) {
  const videoRef = useRef(null);
  const [videoError, setVideoError] = useState(false);
  const resolvedSrc = src ? getMediaUrl(src) : '';
  const resolvedPoster = poster ? getMediaUrl(poster) : '';
  const aspect = (width && height) ? (width / height) : (16 / 9);
  const durationLabel = (Number.isFinite(duration) && duration > 0)
    ? `${Math.floor(duration / 60)}:${String(Math.round(duration % 60)).padStart(2, '0')}`
    : null;

  const handlePlayClick = (e) => {
    e.stopPropagation();
    if (videoError || !resolvedSrc) return;
    if (onOpenMediaModal) {
      onOpenMediaModal(resolvedSrc, 'video');
    } else if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play().catch(() => {});
      } else {
        videoRef.current.pause();
      }
    }
  };

  const handleLoadedMetadata = () => {
    // Media dimension resizing is removed; sizing is purely CSS + --aspect now.
  };

  if (videoError || !resolvedSrc) {
    return (
      <div className={`${styles.msgMediaErrorCard} ${!isInline ? styles.msgMediaErrorStandalone : ''}`}>
        <AlertCircle size={24} style={{ opacity: 0.5 }} />
        <span style={{ fontSize: '0.72rem', opacity: 0.6, marginTop: '4px' }}>Video unavailable</span>
      </div>
    );
  }

  return (
    <div
      className={`${styles.msgMediaWrapper} ${isInline ? styles.msgMediaWrapperInline : styles.msgMediaWrapperStandalone}`}
      style={{
        '--aspect': aspect,
        backgroundColor: '#16181c',
        cursor: 'pointer',
      }}
      onClick={() => onOpenMediaModal && onOpenMediaModal(resolvedSrc, 'video')}
    >
      <video
        ref={videoRef}
        src={resolvedSrc}
        poster={resolvedPoster || undefined}
        playsInline
        muted
        // With a poster + known dimensions we can defer ALL video bytes until the
        // user actually plays (preload="none"); otherwise fetch just metadata.
        preload={resolvedPoster ? 'none' : 'metadata'}
        onLoadedMetadata={handleLoadedMetadata}
        onLoadedData={handleLoadedMetadata}
        onCanPlay={handleLoadedMetadata}
        onError={() => setVideoError(true)}
        className={styles.msgMediaImgVisible}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          marginBottom: isInline && hasText ? '6px' : '0',
          objectFit: 'cover',
          pointerEvents: 'none'
        }}
      />
      {durationLabel && (
        <span style={{ position: 'absolute', bottom: '8px', right: '8px', zIndex: 3, background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: '0.7rem', fontWeight: 600, padding: '2px 6px', borderRadius: '6px', pointerEvents: 'none' }}>
          {durationLabel}
        </span>
      )}
      <button
        type="button"
        onClick={handlePlayClick}
        aria-label="Play in media viewer"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(6px)',
          border: '1.5px solid rgba(255, 255, 255, 0.35)',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 3,
          transition: 'transform 0.15s ease, background-color 0.15s ease',
          pointerEvents: 'auto',
          paddingLeft: '3px'
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Play size={24} fill="white" />
      </button>
    </div>
  );
}

function GroupInviteCard({ msg, currentUser, conversations, navigate, requestToJoinGroup }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutate: toggleJoin } = useJoinCommunity();

  const targetGroupId = msg.inviteData?.groupId || msg.inviteData?.conversationId;
  const isCampusGroup = String(targetGroupId).startsWith('c_');
  const targetConv = conversations?.find(c => String(c.id) === String(targetGroupId));
  
  const memberIds = new Set();
  if (targetConv) {
    (targetConv.members || targetConv.participants || []).forEach(m => {
      const id = typeof m === 'string' ? m : (m.id || m.userId || m.user?.id);
      if (id) memberIds.add(String(id));
    });
  }
  const isMember = memberIds.has(String(currentUser?.id));
  const isJoinedCampus = isCampusGroup && currentUser?.campusGroups?.map(String).includes(String(targetGroupId));
  const alreadyJoined = isMember || isJoinedCampus;
  
  const isExpired = 
    Boolean(msg.inviteData?.isExpired || msg.inviteData?.expired || msg.isExpired) ||
    (msg.inviteData?.expiresAt && new Date(msg.inviteData.expiresAt).getTime() <= Date.now()) ||
    (msg.expiresAt && new Date(msg.expiresAt).getTime() <= Date.now()) ||
    targetConv?.status === 'EXPIRED' ||
    targetConv?.status === 'ENDED' ||
    targetConv?.status === 'CANCELLED' ||
    targetConv?.status === 'CLOSED';

  const isApprovalRequired = (
    targetConv?.whoCanJoin === 'APPROVAL' ||
    targetConv?.whoCanJoin === 'Request required' ||
    targetConv?.whoCanJoin === 'APPROVAL_REQUIRED' ||
    msg.inviteData?.whoCanJoin === 'APPROVAL' ||
    msg.inviteData?.whoCanJoin === 'Request required' ||
    msg.inviteData?.whoCanJoin === 'APPROVAL_REQUIRED'
  );

  const pendingReqs = (targetConv?.pendingRequests || []).map(item => typeof item === 'string' ? item : (item.userId || item.user?.id));
  const isRequested = pendingReqs.includes(currentUser?.id);

  const fromText = msg.from === 'me' ? 'you' : (msg.senderName || 'someone');

  const navigateToGroup = () => {
    const isInbox = window.location.pathname.startsWith('/inbox');
    const basePath = isInbox ? '/inbox' : '/messages';
    const targetPath = generateConversationUrl(targetConv || { id: targetGroupId }, currentUser?.id, basePath);
    navigate(targetPath);
  };

  const handleJoinGroup = async () => {
    if (alreadyJoined) {
      navigateToGroup();
      return;
    }

    if (isSubmitting || isExpired) return;

    setIsSubmitting(true);
    try {
      if (isApprovalRequired) {
        if (!isRequested) {
          await requestToJoinGroup(targetGroupId);
          toast.success('Join request sent');
        }
      } else {
        if (isCampusGroup) {
          toggleJoin({ communityId: targetGroupId, isJoined: true, currentUser });
        } else {
          await requestToJoinGroup(targetGroupId);
        }
        navigateToGroup();
      }
    } catch {
      toast.error('Request failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const groupAvatarSrc = targetConv?.avatarKey || targetConv?.avatar || targetConv?.icon || targetConv?.coverImage || targetConv?.avatarUrl || msg.inviteData?.groupAvatar || msg.inviteData?.avatar || null;
  const groupName = targetConv?.name || msg.inviteData?.groupName || 'Group';

  const getButtonText = () => {
    if (alreadyJoined) return 'View Group';
    if (isExpired) return 'Expired';
    if (isRequested) return 'Requested';
    return 'Join Group';
  };

  return (
    <div className={styles.groupInviteCard}>
      <div className={styles.groupInviteHeader}>
        <Avatar src={groupAvatarSrc} name={groupName} size="48px" isGroup={true} />
        <div className={styles.groupInviteInfo}>
          <h4>{msg.inviteData?.groupName || 'Group'}</h4>
          <p>Group invite from {fromText}</p>
        </div>
      </div>
      <div className={styles.groupInviteActions}>
        <button 
          className={styles.groupInviteBtn}
          onClick={handleJoinGroup}
          disabled={isSubmitting || (!alreadyJoined && (isRequested || isExpired))}
        >
          {getButtonText()}
        </button>
      </div>
    </div>
  );
}

const formatToClockTime = (dateInput) => {
  const d = dateInput ? new Date(dateInput) : new Date();
  const date = isNaN(d.getTime()) ? new Date() : d;
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const minStr = minutes < 10 ? '0' + minutes : minutes;
  return `${hours}:${minStr} ${ampm}`;
};

const getDisplayClockTime = (msg) => {
  if (msg?.createdAt) return formatToClockTime(msg.createdAt);
  if (msg?.timestamp) return formatToClockTime(msg.timestamp);
  return formatToClockTime(new Date());
};



// Lightweight overlay shown over the local preview while media uploads (progress
// ring) or after a failure (retry / cancel). Rendered absolutely over the media
// box so progress ticks (which only patch this one message) never reflow siblings.
function MediaUploadOverlay({ progress = 0, failed = false, onRetry, onCancel }) {
  if (failed) {
    return (
      <div className={styles.msgUploadOverlay} onClick={(e) => e.stopPropagation()}>
        <div className={styles.msgUploadFailedText}>Upload failed</div>
        <div className={styles.msgUploadActions}>
          {onRetry && (
            <button type="button" className={styles.msgUploadBtn} onClick={onRetry}>Retry</button>
          )}
          {onCancel && (
            <button type="button" className={styles.msgUploadBtnGhost} onClick={onCancel}>Cancel</button>
          )}
        </div>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  return (
    <div className={styles.msgUploadOverlay}>
      <div className={styles.msgUploadRing} style={{ '--upload-pct': `${pct}%` }}>
        <span className={styles.msgUploadPct}>{pct}%</span>
      </div>
      {onCancel && (
        <button type="button" className={styles.msgUploadBtnGhost} onClick={(e) => { e.stopPropagation(); onCancel(); }}>Cancel</button>
      )}
    </div>
  );
}

const MessageBubble = memo(function MessageBubble({
  onJumpToMessage,
  msg, 
  conversation, 
  currentUser,
  users,
  isLatestMessage = false,
  onOpenMediaModal,
  onContextMenu,
  onReplyTo,
  onReply,
  conversations,
  requestToJoinGroup,
  onRetryUpload,
  onCancelUpload,
  // Find-in-chat term. ChatMessageList has always passed this down; the prop
  // simply was never declared here, so the value arrived and was discarded.
  searchQuery = '',
}) {
  const navigate = useNavigate();
  const storeUsers = useUsersMap();
  const allUsers = users || storeUsers || {};
  const longPressTimer = useRef(null);
  const touchHandled = useRef(false);
  const replyHandler = onReplyTo || onReply;
  const [mediaError, setMediaError] = useState(false);

  const fireContextMenu = (e, msgObj) => {
    if (!onContextMenu) return;
    let clientX = e.clientX;
    let clientY = e.clientY;
    
    if (clientX === undefined) {
      if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if (e.changedTouches && e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
      }
    }
    
    // Fallbacks if all else fails
    clientX = clientX ?? window.innerWidth / 2;
    const vh = window.visualViewport?.height || window.innerHeight;
    clientY = clientY ?? vh / 2;

    const mockEvent = {
      clientX,
      clientY,
      preventDefault: () => e.preventDefault && e.preventDefault(),
      stopPropagation: () => e.stopPropagation && e.stopPropagation(),
    };
    const finalMsg = mediaError ? { ...msgObj, isMediaUnavailable: true, mediaError: true } : msgObj;
    onContextMenu(mockEvent, finalMsg);
  };

  const touchStartPos = useRef({ x: 0, y: 0 });
  const isSwipingRef = useRef(false);
  const vibratedRef = useRef(false);
  const [swipeX, setSwipeX] = useState(0);

  const handleTouchStart = (e) => {
    if (e.persist) e.persist();
    
    let clientX = e.clientX;
    let clientY = e.clientY;
    if (clientX === undefined && e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }
    
    touchStartPos.current = { x: clientX || 0, y: clientY || 0 };
    isSwipingRef.current = false;
    vibratedRef.current = false;
    touchHandled.current = false;

    const syntheticEvent = { clientX, clientY };

    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      if (!isSwipingRef.current) {
        touchHandled.current = true;
        fireContextMenu(syntheticEvent, msg);
      }
    }, LONG_PRESS_DELAY_MS);
  };

  const handleTouchMove = (e) => {
    if (!e.touches || e.touches.length === 0) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const deltaX = currentX - touchStartPos.current.x;
    const deltaY = currentY - touchStartPos.current.y;

    // Any real movement means this is a scroll or a swipe, not a long press.
    // Only a horizontal swipe used to cancel the timer; a vertical drag hit the
    // early return below and left it running, so pausing briefly while
    // scrolling popped the menu open at the spot the finger started from.
    if (longPressTimer.current && Math.hypot(deltaX, deltaY) > LONG_PRESS_MOVE_TOLERANCE_PX) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    if (!isSwipingRef.current && Math.abs(deltaY) > Math.abs(deltaX)) {
      return;
    }

    if (deltaX > 8 && replyHandler) {
      isSwipingRef.current = true;
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
      }
      
      const distance = Math.min(Math.max(0, deltaX * 0.55), 75);
      setSwipeX(distance);

      if (distance >= 40 && !vibratedRef.current) {
        vibratedRef.current = true;
        try {
          if (navigator.vibrate) navigator.vibrate(15);
        } catch (_) {}
      }
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (!isUnsent && swipeX >= 40 && replyHandler) {
      replyHandler(msg);
    }
    setSwipeX(0);
    isSwipingRef.current = false;
    vibratedRef.current = false;
  };

  // The browser fires touchcancel when it takes the gesture over for scrolling.
  // Without this the timer survived that handover and fired mid-scroll.
  const handleTouchCancel = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    setSwipeX(0);
    isSwipingRef.current = false;
    vibratedRef.current = false;
  };

  const handleContextMenuEvent = (e) => {
    e.preventDefault();
    fireContextMenu(e, msg);
  };

  if (isSystemMessage(msg)) {
    const text = msg.text || msg.payload?.text || '';
    return (
      <div className={styles.systemMessageContainer}>
        <div className={styles.systemMessageText}>
          <SystemMessageContent text={text} navigate={navigate} />
        </div>
      </div>
    );
  }

  const isUnsent = msg.state === 'UNSENT' || msg.isUnsent || msg.text === 'This message was unsent' || msg.payload?.text === 'This message was unsent';
  const isGroup = conversation?.isGroup || conversation?.type === 'GROUP';
  const isMe = checkIsMe(msg, currentUser);
  const showSenderAvatar = isGroup && !isMe;
  const senderName = msg.senderName || msg.sender?.displayName || msg.sender?.name || msg.sender?.username || (msg.senderId && allUsers[msg.senderId] ? (allUsers[msg.senderId].displayName || allUsers[msg.senderId].username || allUsers[msg.senderId].name) : 'Member');
  const senderAvatar = msg.senderAvatar || msg.sender?.avatar || (msg.senderId && allUsers[msg.senderId] ? allUsers[msg.senderId].avatar : null);

  const isRealServerMsg = Boolean(msg?.id && !String(msg.id).startsWith('temp_') && !String(msg.id).startsWith('c_temp_') && !msg?.isOptimistic);
  const isConfirmedSent = msg?.status === 'sent' || msg?.status === 'delivered' || msg?.status === 'read' || msg?.status === 'seen';

  const sendTimeMs = getMsgTimestamp(msg);
  const msgAge = sendTimeMs > 0 ? (Date.now() - sendTimeMs) : Infinity;
  const isStaleSending = !isRealServerMsg && !isConfirmedSent && msg?.status === 'sending' && (isNaN(msgAge) || msgAge > 5000 || msgAge < 0);

  const isFailedMsg = isMe && !isRealServerMsg && !isConfirmedSent && (
    msg.status === 'failed' || 
    msg.status === 'FAILED' || 
    msg.isFailed || 
    msg.status === 'error' || 
    msg.deliveryStatus === 'failed' || 
    msg.state === 'FAILED' ||
    isStaleSending
  );
  
  const inviteData = msg.inviteData || msg.payload?.inviteData;
  const activityData = msg.payload?.activity || msg.payload?.inviteData?.activity || msg.inviteData?.activity;
  const postData = msg.payload?.post || msg.payload?.inviteData?.post || msg.inviteData?.post;
  const profileData = msg.payload?.profile || msg.payload?.inviteData?.profile || msg.inviteData?.profile;
  const communityData = msg.payload?.community || msg.payload?.inviteData?.community || msg.inviteData?.community;
  
  let rawText = msg.text || msg.payload?.text || msg.content || '';
  if (rawText && typeof rawText === 'object') {
    rawText = rawText.body || rawText.text || '';
  }
  const messageText = typeof rawText === 'string' ? rawText : String(rawText);
  const rawMediaUrl = msg.mediaUrl || msg.payload?.mediaUrl;
  const mediaUrl = rawMediaUrl ? getMediaUrl(rawMediaUrl) : '';
  // Prefer the lightweight thumbnail/poster for in-list rendering; the full
  // original is loaded only when the viewer opens (onClick -> mediaUrl).
  const rawThumbUrl = msg.payload?.thumbnailUrl || msg.payload?.localPreviewUrl || rawMediaUrl;
  const thumbUrl = rawThumbUrl ? getMediaUrl(rawThumbUrl) : mediaUrl;
  const mediaWidth = msg.payload?.width || msg.width || null;
  const mediaHeight = msg.payload?.height || msg.height || null;
  const mediaDuration = msg.payload?.duration || msg.duration || null;
  // Upload lifecycle for optimistic media (own outgoing messages only).
  const uploadStatus = msg.uploadStatus;
  const uploadProgress = typeof msg.uploadProgress === 'number' ? msg.uploadProgress : 0;
  const isUploading = uploadStatus === 'uploading';
  const isUploadFailed = uploadStatus === 'failed' || (isMe && isFailedMsg && rawMediaUrl && String(rawMediaUrl).startsWith('blob:'));
  const isAudio = msg.mediaType === 'audio' || msg.type === 'voice' || msg.payload?.mediaType === 'audio';
  const isVideo =
    msg.mediaType === 'video' ||
    msg.type === 'video' ||
    msg.payload?.mediaType === 'video' ||
    (typeof mediaUrl === 'string' && (/\.(mp4|webm|mov|mkv|avi|flv)/i.test(mediaUrl) || mediaUrl.startsWith('data:video/')));
  const hasText = !!(messageText && String(messageText).trim().length > 0);
  const timeText = getDisplayClockTime(msg);

  let innerContent = null;

  // 0. Unsent Message
  if (isUnsent) {
    innerContent = (
      <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
        <div className={`${styles.msgBubble} ${isMe ? styles.msgBubbleMe : styles.msgBubbleThem}`}>
          <div className={styles.msgTextTimeWrap}>
            <span className={styles.msgText} style={{ fontStyle: 'italic', opacity: 0.7 }}>
              This message was unsent
            </span>
            <div className={styles.msgTimeLabel} style={{ opacity: 0.6 }}>{timeText}</div>
          </div>
        </div>
        <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={null} onContextMenu={onContextMenu} />
      </div>
    );
  } else if (profileData || (inviteData && inviteData.type === 'profileShare')) {
    const prof = profileData || inviteData?.profile;
    innerContent = (
      <div className={styles.msgImageCardContainer}>
        <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
          <SharedProfilePreview profile={prof} />
          <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
        </div>
        <div className={`${styles.msgImageFooter} ${isMe ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
          {timeText}
        </div>
      </div>
    );
  } else if (inviteData && inviteData.type !== 'activityShare' && inviteData.type !== 'profileShare' && inviteData.type !== 'postShare' && inviteData.type !== 'communityShare') {
    // 2. Group Invite Card Message
    innerContent = (
      <div className={styles.msgImageCardContainer}>
        <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
          <GroupInviteCard 
            msg={{ ...msg, inviteData }}
            currentUser={currentUser}
            conversations={conversations}
            navigate={navigate}
            requestToJoinGroup={requestToJoinGroup}
          />
          <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
        </div>
        <div className={`${styles.msgImageFooter} ${isMe ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
          {timeText}
        </div>
      </div>
    );
  } else if (activityData || (inviteData && inviteData.type === 'activityShare')) {
    // 2. Activity Share Card Message
    const act = activityData || inviteData?.activity;
    innerContent = (
      <div className={styles.msgImageCardContainer}>
        <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
          <SharedActivityPreview activity={act} />
          <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
        </div>
        <div className={`${styles.msgImageFooter} ${isMe ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
          {timeText}
        </div>
      </div>
    );
  } else if (isAudio) {
    // 3. Voice / Audio Message
    innerContent = (
      <div className={styles.msgAudioCardContainer}>
        <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
          <VoiceMessagePlayer src={mediaUrl} audioUrl={mediaUrl} fromMe={isMe} isMe={isMe} />
          <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
        </div>
        <div className={`${styles.msgImageFooter} ${isMe ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
          {timeText}
        </div>
      </div>
    );
  } else if (isVideo && mediaUrl && !hasText && !msg.replyTo) {
    // 4. Standalone Video Message
    innerContent = (
      <div className={styles.msgImageCardContainer}>
        <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
          <div className={styles.msgImageCard} style={{ overflow: 'hidden', borderRadius: '16px', width: 'fit-content', height: 'fit-content', position: 'relative' }}>
            <VideoPlayerWithOverlay src={mediaUrl} poster={thumbUrl !== mediaUrl ? thumbUrl : null} duration={mediaDuration} width={mediaWidth} height={mediaHeight} isInline={false} onOpenMediaModal={onOpenMediaModal} />
            {(isUploading || isUploadFailed) && (
              <MediaUploadOverlay
                progress={uploadProgress}
                failed={isUploadFailed}
                onRetry={onRetryUpload ? () => onRetryUpload(msg.clientId || msg.tempId) : null}
                onCancel={onCancelUpload ? () => onCancelUpload(msg.clientId || msg.tempId) : null}
              />
            )}
          </div>
          <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
        </div>
        <div className={`${styles.msgImageFooter} ${isMe ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
          {timeText}
        </div>
      </div>
    );
  } else if (mediaUrl && !hasText && !msg.replyTo && !postData && !profileData && !communityData) {
    // 4. Standalone Image Message (Image with no text caption)
    innerContent = (
      <div className={styles.msgImageCardContainer}>
        <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
          <div className={styles.msgImageCard} style={{ position: 'relative' }}>
            <ImageWithSkeleton
              src={thumbUrl}
              onClickSrc={mediaUrl}
              alt=""
              width={mediaWidth}
              height={mediaHeight}
              className={styles.msgMediaImgStandalone}
              onClick={() => !mediaError && !isUploading && onOpenMediaModal && onOpenMediaModal(mediaUrl)}
              isStandalone={true}
              onErrorChange={setMediaError}
            />
            {(isUploading || isUploadFailed) && (
              <MediaUploadOverlay
                progress={uploadProgress}
                failed={isUploadFailed}
                onRetry={onRetryUpload ? () => onRetryUpload(msg.clientId || msg.tempId) : null}
                onCancel={onCancelUpload ? () => onCancelUpload(msg.clientId || msg.tempId) : null}
              />
            )}
          </div>
          {!mediaError && (
            <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
          )}
        </div>
        <div className={`${styles.msgImageFooter} ${isMe ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
          {timeText}
        </div>
      </div>
    );
  } else if (communityData) {
    // Shared Community Card Message
    innerContent = (
      <div className={styles.msgImageCardContainer}>
        <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
          <SharedCommunityPreview community={communityData} />
          <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
        </div>
        <div className={`${styles.msgImageFooter} ${isMe ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
          {timeText}
        </div>
      </div>
    );
  } else if (postData) {
    // Shared Post Card Message
    innerContent = (
      <div className={styles.msgImageCardContainer}>
        <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
          <SharedPostPreview post={postData} />
          <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
        </div>
        <div className={`${styles.msgImageFooter} ${isMe ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
          {timeText}
        </div>
      </div>
    );
  } else {
    // 5. Standard Text Bubble (or Image + Text Caption)
    innerContent = (
      <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
        <div className={`${styles.msgBubble} ${isMe ? styles.msgBubbleMe : styles.msgBubbleThem}`}>
          {msg.replyTo && (
            <div
              className={`${styles.msgBubbleReplyRef} ${onJumpToMessage && msg.replyTo.id ? styles.msgBubbleReplyRefClickable : ''}`}
              role={onJumpToMessage && msg.replyTo.id ? 'button' : undefined}
              tabIndex={onJumpToMessage && msg.replyTo.id ? 0 : undefined}
              aria-label={onJumpToMessage && msg.replyTo.id ? `Go to message from ${msg.replyTo.senderName || 'sender'}` : undefined}
              onClick={(e) => {
                if (!onJumpToMessage || !msg.replyTo.id) return;
                // Must not bubble into the bubble's own tap/context handlers.
                e.stopPropagation();
                onJumpToMessage(msg.replyTo.id);
              }}
              onKeyDown={(e) => {
                if (!onJumpToMessage || !msg.replyTo.id) return;
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onJumpToMessage(msg.replyTo.id); }
              }}
            >
              <div className={styles.msgBubbleReplyRefHeader}>{msg.replyTo.senderName || 'Replying to'}</div>
              {/* Renders every message type — media, voice, shared entities,
                  invites — instead of only text, which left a blank quote for
                  anything without a text body. */}
              <ReplyPreviewContent message={msg.replyTo} />
            </div>
          )}

          {mediaUrl && (
            isVideo ? (
              <div style={{ position: 'relative' }}>
                <VideoPlayerWithOverlay src={mediaUrl} poster={thumbUrl !== mediaUrl ? thumbUrl : null} duration={mediaDuration} width={mediaWidth} height={mediaHeight} isInline={true} hasText={hasText} />
                {(isUploading || isUploadFailed) && (
                  <MediaUploadOverlay
                    progress={uploadProgress}
                    failed={isUploadFailed}
                    onRetry={onRetryUpload ? () => onRetryUpload(msg.clientId || msg.tempId) : null}
                    onCancel={onCancelUpload ? () => onCancelUpload(msg.clientId || msg.tempId) : null}
                  />
                )}
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <ImageWithSkeleton
                  src={thumbUrl}
                  onClickSrc={mediaUrl}
                  alt=""
                  width={mediaWidth}
                  height={mediaHeight}
                  className={styles.msgMediaImg}
                  onClick={() => !mediaError && !isUploading && onOpenMediaModal && onOpenMediaModal(mediaUrl)}
                  isStandalone={false}
                  onErrorChange={setMediaError}
                />
                {(isUploading || isUploadFailed) && (
                  <MediaUploadOverlay
                    progress={uploadProgress}
                    failed={isUploadFailed}
                    onRetry={onRetryUpload ? () => onRetryUpload(msg.clientId || msg.tempId) : null}
                    onCancel={onCancelUpload ? () => onCancelUpload(msg.clientId || msg.tempId) : null}
                  />
                )}
              </div>
            )
          )}

          <div className={styles.msgTextTimeWrap}>
            {hasText && <RichText content={messageText} className={styles.msgText} highlight={searchQuery} />}
            <div className={styles.msgTimeLabel}>{timeText}</div>
          </div>
        </div>
        {!mediaError && (
          <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
        )}
      </div>
    );
  }

  const handleSenderProfileClick = (e) => {
    e.stopPropagation();
    const senderId = msg.senderId || msg.sender?.id || (msg.from !== 'me' ? msg.from : null);
    // was getUserById(senderId), which is defined as exactly `users[id] || null`
    const liveUser = senderId ? (storeUsers[senderId] || null) : null;
    const target = liveUser?.username || msg.senderUsername || msg.sender?.username || senderId;
    if (target) {
      navigate(`/profile/${target}`, { state: { from: window.location.pathname } });
    }
  };

  return (
    <div 
      className={`${styles.msgBubbleContainer} ${isMe ? styles.msgBubbleContainerMe : styles.msgBubbleContainerThem}`}
      /* Anchors used by jump-to-message. Both ids are emitted because a message
         that is still sending only has a clientId, and a reply may target either. */
      data-message-id={msg.id || undefined}
      data-client-id={msg.clientId || msg.tempId || undefined}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onContextMenu={handleContextMenuEvent}
      style={{ position: 'relative', overflow: 'hidden' }}
    >
      {/* Swipe Reply Arrow Indicator */}
      {swipeX > 0 && (
        <div 
          style={{
            position: 'absolute',
            left: `${Math.min(swipeX - 30, 20)}px`,
            top: '50%',
            transform: `translateY(-50%) scale(${Math.min(swipeX / 40, 1)})`,
            opacity: Math.min(swipeX / 30, 1),
            color: 'var(--color-primary, #6366f1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 5,
            transition: swipeX === 0 ? 'all 0.2s ease-out' : 'none',
          }}
        >
          <Reply size={20} />
        </div>
      )}

      <div 
        className={styles.msgBubbleWrapper}
        style={{
          transform: `translateX(${swipeX}px)`,
          transition: swipeX === 0 ? 'transform 0.2s ease-out' : 'none',
          willChange: 'transform',
        }}
      >
        {showSenderAvatar && (
          <div className={styles.msgAvatar} onClick={handleSenderProfileClick} style={{ cursor: 'pointer' }} title={`View ${senderName}`}>
            <Avatar src={senderAvatar} name={senderName} size="28px" />
          </div>
        )}
        <div className={styles.msgBubbleContent}>
          {showSenderAvatar && (
            <span className={styles.msgSenderName} onClick={handleSenderProfileClick} style={{ cursor: 'pointer' }} title={`View ${senderName}`}>
              {senderName}
            </span>
          )}
          
          {innerContent}

          {isMe && (
            <div className={`${styles.msgStatusLabel} ${isFailedMsg ? styles.msgStatusLabelFailed : ''}`} style={{ visibility: (isFailedMsg || isLatestMessage) ? 'visible' : 'hidden' }}>
              {/* Failed status is always shown — never hidden even if not the latest message */}
              {isFailedMsg && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <AlertCircle size={13} style={{ color: '#ef4444' }} />
                  <span>Not delivered</span>
                </span>
              )}
              {/* Normal delivery status: only shown on the latest message */}
              {!isFailedMsg && (() => {
                const s = msg.status;
                if (s === 'sending') return <span>Sending…</span>;
                if (s === 'read' || s === 'seen') return <span>Seen</span>;
                // 'sent', 'delivered', or any unrecognised status → show 'Sent'
                return <span>Sent</span>;
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default MessageBubble;
