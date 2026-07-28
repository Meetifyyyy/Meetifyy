import { useState, useRef, useEffect, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Reply, MoreVertical } from 'lucide-react';
import Avatar from '@shared/components/avatar/Avatar';
import { isImageUrl } from '@shared/utils/avatar';
import { mediaCache } from '@shared/utils/MediaCacheManager';
import RichText from '@shared/components/mentions/RichText';
import { generateConversationUrl } from '@shared/utils/conversationUrl';
import { SharedPostPreview } from '../previews/SharedPostPreview';
import { SharedProfilePreview } from '../previews/SharedProfilePreview';
import { SharedCommunityPreview } from '../previews/SharedCommunityPreview';
import { SharedActivityPreview } from '../previews/SharedActivityPreview';
import VoiceMessagePlayer from './VoiceMessagePlayer';
import styles from './ChatMessageList.module.css';
import { useJoinCommunity } from '@features/communities/hooks/useJoinCommunity';
import { useData } from '@shared/hooks/useData';

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
            navigate(`/profile/${mentionUsername}`);
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

function ImageWithSkeleton({ src, alt, className, onClick, isStandalone = false, onErrorChange }) {
  const [imgSrc, setImgSrc] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let isMounted = true;
    setLoaded(false);
    setError(false);
    if (onErrorChange) onErrorChange(false);

    if (!src) {
      setError(true);
      if (onErrorChange) onErrorChange(true);
      return;
    }

    if (src.startsWith('blob:') || src.startsWith('data:')) {
      setImgSrc(src);
      setLoaded(true);
      return;
    }

    const fetchUrl = async () => {
      try {
        const resolvedUrl = await mediaCache.getUrl(src);
        if (isMounted) {
          if (resolvedUrl) {
            setImgSrc(resolvedUrl);
          } else {
            setError(true);
            if (onErrorChange) onErrorChange(true);
          }
        }
      } catch (err) {
        if (isMounted) {
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

  return (
    <div className={styles.msgMediaWrapper}>
      {!loaded && (
        <div className={`${styles.msgMediaSkeleton} ${isStandalone ? styles.msgMediaSkeletonStandalone : ''}`} />
      )}
      <img
        src={imgSrc || src}
        alt={alt || ''}
        loading="lazy"
        decoding="async"
        className={`${className} ${!loaded ? styles.msgMediaImgHidden : styles.msgMediaImgVisible}`}
        onClick={() => onClick && onClick(imgSrc || src)}
        onLoad={() => setLoaded(true)}
        onError={handleError}
      />
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

    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      if (isApprovalRequired) {
        if (!isRequested) {
          await requestToJoinGroup(targetGroupId);
          toast.success('Join request sent! 📨');
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
      toast.error('Failed to send request');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.groupInviteCard}>
      <div className={styles.groupInviteHeader}>
        <Avatar src={msg.inviteData?.groupAvatar} name={msg.inviteData?.groupName} size="48px" isGroup={true} />
        <div className={styles.groupInviteInfo}>
          <h4>{msg.inviteData?.groupName || 'Group'}</h4>
          <p>Group invite from {fromText}</p>
        </div>
      </div>
      <div className={styles.groupInviteActions}>
        <button 
          className={styles.groupInviteBtn}
          onClick={handleJoinGroup}
          disabled={isSubmitting || (!alreadyJoined && isRequested)}
        >
          {alreadyJoined ? 'View Group' : (isRequested ? 'Requested' : 'Join Group')}
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
  if (msg.createdAt) return formatToClockTime(msg.createdAt);
  if (msg.timestamp) return formatToClockTime(msg.timestamp);
  return formatToClockTime(new Date());
};

const MessageBubble = memo(function MessageBubble({ 
  msg, 
  conversation, 
  currentUser,
  isLatestMessage = false,
  onOpenMediaModal,
  onContextMenu,
  onReplyTo,
  onReply,
  onRetry,
  conversations,
  requestToJoinGroup
}) {
  const navigate = useNavigate();
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
    clientY = clientY ?? window.innerHeight / 2;

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
      if (!isSwipingRef.current) {
        touchHandled.current = true;
        fireContextMenu(syntheticEvent, msg);
      }
    }, 500);
  };

  const handleTouchMove = (e) => {
    if (!e.touches || e.touches.length === 0) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const deltaX = currentX - touchStartPos.current.x;
    const deltaY = currentY - touchStartPos.current.y;

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
    }
    if (swipeX >= 40 && replyHandler) {
      replyHandler(msg);
    }
    setSwipeX(0);
    isSwipingRef.current = false;
    vibratedRef.current = false;
  };

  const handleContextMenuEvent = (e) => {
    e.preventDefault();
    fireContextMenu(e, msg);
  };

  if (msg.type === 'system' || msg.type === 'SYSTEM' || msg.isSystem) {
    const text = msg.text || msg.payload?.text || '';
    return (
      <div className={styles.systemMessageContainer}>
        <div className={styles.systemMessageText}>
          <SystemMessageContent text={text} navigate={navigate} />
        </div>
      </div>
    );
  }

  const isGroup = conversation?.isGroup || conversation?.type === 'GROUP' || conversation?.type === 'ACTIVITY';
  const showSenderAvatar = isGroup && msg.from !== 'me';
  const isMe = msg.from === 'me';
  
  const inviteData = msg.inviteData || msg.payload?.inviteData;
  const activityData = msg.payload?.activity || msg.payload?.inviteData?.activity;
  const postData = msg.payload?.post || msg.payload?.inviteData?.post;
  const profileData = msg.payload?.profile || msg.payload?.inviteData?.profile;
  const communityData = msg.payload?.community || msg.payload?.inviteData?.community;
  
  let rawText = msg.decryptedText || msg.text || msg.payload?.text || msg.content || '';
  if (rawText && typeof rawText === 'object') {
    rawText = rawText.body || rawText.text || '';
  }
  if (typeof rawText === 'string' && rawText.startsWith('{"type":') && rawText.includes('"body":')) {
    try {
      const parsed = JSON.parse(rawText);
      rawText = parsed.body || rawText;
    } catch (e) {}
  }
  const messageText = typeof rawText === 'string' ? rawText : String(rawText);
  const rawMediaUrl = msg.mediaUrl || msg.payload?.mediaUrl;
  const mediaUrl = typeof rawMediaUrl === 'string' && rawMediaUrl.trim()
    ? (rawMediaUrl.startsWith('http://') || rawMediaUrl.startsWith('https://') || rawMediaUrl.startsWith('blob:') || rawMediaUrl.startsWith('data:')
        ? rawMediaUrl
        : (rawMediaUrl.startsWith('/') ? rawMediaUrl : `/${rawMediaUrl}`))
    : rawMediaUrl;
  const isAudio = msg.mediaType === 'audio' || msg.type === 'voice' || msg.payload?.mediaType === 'audio';
  const hasText = !!(messageText && String(messageText).trim().length > 0);
  const timeText = getDisplayClockTime(msg);

  let innerContent = null;

  // 1. Profile Share Card Message
  if (profileData || (inviteData && inviteData.type === 'profileShare')) {
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
  } else if (mediaUrl && !hasText && !msg.replyTo && !postData && !profileData && !communityData) {
    // 4. Standalone Image Message (Image with no text caption)
    innerContent = (
      <div className={styles.msgImageCardContainer}>
        <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
          <div className={styles.msgImageCard}>
            <ImageWithSkeleton
              src={mediaUrl}
              alt=""
              className={styles.msgMediaImgStandalone}
              onClick={() => !mediaError && onOpenMediaModal && onOpenMediaModal(mediaUrl)}
              isStandalone={true}
              onErrorChange={setMediaError}
            />
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
  } else {
    // 5. Standard Text Bubble (or Image + Text Caption)
    innerContent = (
      <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
        <div className={`${styles.msgBubble} ${isMe ? styles.msgBubbleMe : styles.msgBubbleThem}`}>
          {msg.replyTo && (
            <div className={styles.msgBubbleReplyRef}>
              <div className={styles.msgBubbleReplyRefHeader}>{msg.replyTo.senderName || 'Replying to'}</div>
              <div>{msg.replyTo.text || msg.replyTo.payload?.text}</div>
            </div>
          )}

          {mediaUrl && (
            <ImageWithSkeleton
              src={mediaUrl}
              alt=""
              className={styles.msgMediaImg}
              onClick={() => !mediaError && onOpenMediaModal && onOpenMediaModal(mediaUrl)}
              isStandalone={false}
              onErrorChange={setMediaError}
            />
          )}

          {postData ? (
            <SharedPostPreview post={postData} />
          ) : profileData ? (
            <SharedProfilePreview profile={profileData} />
          ) : communityData ? (
            <SharedCommunityPreview community={communityData} />
          ) : (
            <div className={styles.msgTextTimeWrap}>
              {hasText && <RichText content={messageText} className={styles.msgText} />}
              <div className={styles.msgTimeLabel}>{timeText}</div>
            </div>
          )}
        </div>
        {!mediaError && (
          <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
        )}
      </div>
    );
  }

  const { getUserById } = useData();

  const handleSenderProfileClick = (e) => {
    e.stopPropagation();
    const senderId = msg.senderId || msg.sender?.id || (msg.from !== 'me' ? msg.from : null);
    const liveUser = (senderId && getUserById) ? getUserById(senderId) : null;
    const target = liveUser?.username || msg.senderUsername || msg.sender?.username || senderId;
    if (target) {
      navigate(`/profile/${target}`);
    }
  };

  return (
    <div 
      className={`${styles.msgBubbleContainer} ${isMe ? styles.msgBubbleContainerMe : styles.msgBubbleContainerThem}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
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
          <div className={styles.msgAvatar} onClick={handleSenderProfileClick} style={{ cursor: 'pointer' }} title={`View ${msg.senderName || 'profile'}`}>
            <Avatar src={msg.senderAvatar} name={msg.senderName} size="28px" />
          </div>
        )}
        <div className={styles.msgBubbleContent}>
          {showSenderAvatar && (
            <span className={styles.msgSenderName} onClick={handleSenderProfileClick} style={{ cursor: 'pointer' }} title={`View ${msg.senderName || 'profile'}`}>
              {msg.senderName}
            </span>
          )}
          
          {innerContent}

          {isMe && isLatestMessage && (
            <div className={`${styles.msgStatusLabel} ${msg.status === 'failed' ? styles.msgStatusLabelFailed : ''}`}>
              {msg.status === 'sending' && <span>Sending</span>}
              {(msg.status === 'sent' || msg.status === 'delivered') && <span>Sent</span>}
              {(!msg.status && msg.status !== 'sending' && msg.status !== 'read' && msg.status !== 'seen' && msg.status !== 'failed') && <span>Sent</span>}
              {(msg.status === 'read' || msg.status === 'seen') && <span>Seen</span>}
              {msg.status === 'failed' && (
                <span>
                  Failed to send
                  {onRetry && (
                    <button
                      type="button"
                      className={styles.msgRetryButton}
                      onClick={(e) => { e.stopPropagation(); onRetry(msg); }}
                    >
                      Retry
                    </button>
                  )}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default MessageBubble;
