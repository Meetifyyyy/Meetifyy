import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Reply, MoreVertical } from 'lucide-react';
import Avatar from '@shared/components/avatar/Avatar';
import { isImageUrl } from '@shared/utils/avatar';
import RichText from '@shared/components/mentions/RichText';
import { generateConversationUrl } from '@shared/utils/conversationUrl';
import { SharedPostPreview } from '../previews/SharedPostPreview';
import { SharedProfilePreview } from '../previews/SharedProfilePreview';
import { SharedCommunityPreview } from '../previews/SharedCommunityPreview';
import { SharedActivityPreview } from '../previews/SharedActivityPreview';
import VoiceMessagePlayer from './VoiceMessagePlayer';
import styles from './ChatMessageList.module.css';

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

function GroupInviteCard({ msg, currentUser, conversations, navigate, toggleJoinCampusGroup, requestToJoinGroup }) {
  const [isSubmitting, setIsSubmitting] = useState(false);

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
          await toggleJoinCampusGroup(targetGroupId);
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

export default function MessageBubble({ 
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
  toggleJoinCampusGroup,
  requestToJoinGroup
}) {
  const navigate = useNavigate();
  const longPressTimer = useRef(null);
  const touchHandled = useRef(false);
  const replyHandler = onReplyTo || onReply;

  const handleTouchStart = (e) => {
    touchHandled.current = false;
    longPressTimer.current = setTimeout(() => {
      touchHandled.current = true;
      if (onContextMenu) {
        onContextMenu(e, msg);
      }
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  };

  const handleContextMenuEvent = (e) => {
    e.preventDefault();
    if (onContextMenu) {
      onContextMenu(e, msg);
    }
  };

  if (msg.type === 'system' || msg.type === 'SYSTEM') {
    return (
      <div className={styles.systemMessageContainer}>
        <span className={styles.systemMessageText}>{msg.text || msg.payload?.text || 'System Event'}</span>
      </div>
    );
  }

  const isGroup = conversation?.isGroup || conversation?.type === 'GROUP' || conversation?.type === 'ACTIVITY';
  const showSenderAvatar = isGroup && msg.from !== 'me';
  const isMe = msg.from === 'me';
  
  const inviteData = msg.inviteData || msg.payload?.inviteData;
  const activityData = msg.payload?.activity || msg.payload?.inviteData?.activity;
  const postData = msg.payload?.post;
  const profileData = msg.payload?.profile;
  const communityData = msg.payload?.community;
  
  const messageText = msg.text || msg.payload?.text || msg.content || '';
  const mediaUrl = msg.mediaUrl || msg.payload?.mediaUrl;
  const isAudio = msg.mediaType === 'audio' || msg.type === 'voice' || msg.payload?.mediaType === 'audio';
  const hasText = !!(messageText && String(messageText).trim().length > 0);
  const timeText = getDisplayClockTime(msg);

  // 1. Group Invite Card Message
  if (inviteData && inviteData.type !== 'activityShare') {
    return (
      <div 
        className={`${styles.msgBubbleContainer} ${isMe ? styles.msgBubbleContainerMe : styles.msgBubbleContainerThem}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onContextMenu={handleContextMenuEvent}
      >
        <div className={styles.msgBubbleWrapper}>
          {showSenderAvatar && (
            <div className={styles.msgAvatar}>
              <Avatar src={msg.senderAvatar} name={msg.senderName} size="28px" />
            </div>
          )}
          <div className={styles.msgBubbleContent}>
            {showSenderAvatar && (
              <span className={styles.msgSenderName}>{msg.senderName}</span>
            )}
            <div className={styles.msgImageCardContainer}>
              <GroupInviteCard 
                msg={{ ...msg, inviteData }}
                currentUser={currentUser}
                conversations={conversations}
                navigate={navigate}
                toggleJoinCampusGroup={toggleJoinCampusGroup}
                requestToJoinGroup={requestToJoinGroup}
              />
              <div className={`${styles.msgImageFooter} ${isMe ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
                {timeText}
              </div>
            </div>
          </div>
          <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
        </div>
      </div>
    );
  }

  // 2. Activity Share Card Message
  if (activityData || (inviteData && inviteData.type === 'activityShare')) {
    const act = activityData || inviteData?.activity;
    return (
      <div 
        className={`${styles.msgBubbleContainer} ${isMe ? styles.msgBubbleContainerMe : styles.msgBubbleContainerThem}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onContextMenu={handleContextMenuEvent}
      >
        <div className={styles.msgBubbleWrapper}>
          {showSenderAvatar && (
            <div className={styles.msgAvatar}>
              <Avatar src={msg.senderAvatar} name={msg.senderName} size="28px" />
            </div>
          )}
          <div className={styles.msgBubbleContent}>
            {showSenderAvatar && (
              <span className={styles.msgSenderName}>{msg.senderName}</span>
            )}
            <div className={styles.msgImageCardContainer}>
              <SharedActivityPreview activity={act} />
              <div className={`${styles.msgImageFooter} ${isMe ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
                {timeText}
              </div>
            </div>
          </div>
          <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
        </div>
      </div>
    );
  }

  // 3. Voice / Audio Message
  if (isAudio) {
    return (
      <div 
        className={`${styles.msgBubbleContainer} ${isMe ? styles.msgBubbleContainerMe : styles.msgBubbleContainerThem}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onContextMenu={handleContextMenuEvent}
      >
        <div className={styles.msgBubbleWrapper}>
          {showSenderAvatar && (
            <div className={styles.msgAvatar}>
              <Avatar src={msg.senderAvatar} name={msg.senderName} size="28px" />
            </div>
          )}
          <div className={styles.msgBubbleContent}>
            {showSenderAvatar && (
              <span className={styles.msgSenderName}>{msg.senderName}</span>
            )}
            <div className={styles.msgAudioCardContainer}>
              <VoiceMessagePlayer src={mediaUrl} audioUrl={mediaUrl} fromMe={isMe} isMe={isMe} />
              <div className={`${styles.msgImageFooter} ${isMe ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
                {timeText}
              </div>
            </div>
          </div>
          <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
        </div>
      </div>
    );
  }

  // 4. Standalone Image Message (Image with no text caption)
  if (mediaUrl && !hasText && !msg.replyTo && !postData && !profileData && !communityData) {
    return (
      <div 
        className={`${styles.msgBubbleContainer} ${isMe ? styles.msgBubbleContainerMe : styles.msgBubbleContainerThem}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onContextMenu={handleContextMenuEvent}
      >
        <div className={styles.msgBubbleWrapper}>
          {showSenderAvatar && (
            <div className={styles.msgAvatar}>
              <Avatar src={msg.senderAvatar} name={msg.senderName} size="28px" />
            </div>
          )}
          <div className={styles.msgBubbleContent}>
            {showSenderAvatar && (
              <span className={styles.msgSenderName}>{msg.senderName}</span>
            )}
            <div className={styles.msgImageCardContainer}>
              <div className={styles.msgImageCard}>
                <img 
                  src={mediaUrl} 
                  alt="Attachment" 
                  className={styles.msgMediaImgStandalone}
                  onClick={() => onOpenMediaModal && onOpenMediaModal(mediaUrl)}
                />
              </div>
              <div className={`${styles.msgImageFooter} ${isMe ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
                {timeText}
              </div>
            </div>
          </div>
          <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
        </div>
      </div>
    );
  }

  // 5. Standard Text Bubble (or Image + Text Caption)
  return (
    <div 
      className={`${styles.msgBubbleContainer} ${isMe ? styles.msgBubbleContainerMe : styles.msgBubbleContainerThem}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onContextMenu={handleContextMenuEvent}
    >
      <div className={styles.msgBubbleWrapper}>
        {showSenderAvatar && (
          <div className={styles.msgAvatar}>
            <Avatar src={msg.senderAvatar} name={msg.senderName} size="28px" />
          </div>
        )}
        <div className={styles.msgBubbleContent}>
          {showSenderAvatar && (
            <span className={styles.msgSenderName}>{msg.senderName}</span>
          )}
          <div className={`${styles.msgBubble} ${isMe ? styles.msgBubbleMe : styles.msgBubbleThem}`}>
            {msg.replyTo && (
              <div className={styles.msgBubbleReplyRef}>
                <div className={styles.msgBubbleReplyRefHeader}>{msg.replyTo.senderName || 'Replying to'}</div>
                <div>{msg.replyTo.text || msg.replyTo.payload?.text}</div>
              </div>
            )}

            {mediaUrl && (
              <img 
                src={mediaUrl} 
                alt="Attachment" 
                className={styles.msgMediaImg}
                onClick={() => onOpenMediaModal && onOpenMediaModal(mediaUrl)}
              />
            )}

            {postData ? (
              <SharedPostPreview post={postData} />
            ) : profileData ? (
              <SharedProfilePreview profile={profileData} />
            ) : communityData ? (
              <SharedCommunityPreview community={communityData} />
            ) : (
              hasText && <RichText text={messageText} className={styles.msgText} />
            )}

            <div className={styles.msgTimeLabel}>
              {timeText}
            </div>
          </div>
        </div>
        <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
      </div>
    </div>
  );
}
