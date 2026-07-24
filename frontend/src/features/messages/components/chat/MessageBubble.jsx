import { useNavigate } from 'react-router-dom';

import { CheckCheck, Check } from 'lucide-react';
import Avatar from '@shared/components/avatar/Avatar';
import { isImageUrl } from '@shared/utils/avatar';
import RichText from '@shared/components/mentions/RichText';
import { SharedPostPreview } from '../previews/SharedPostPreview';
import { SharedProfilePreview } from '../previews/SharedProfilePreview';
import { SharedCommunityPreview } from '../previews/SharedCommunityPreview';
import { SharedActivityPreview } from '../previews/SharedActivityPreview';
import VoiceMessagePlayer from './VoiceMessagePlayer';
import styles from './ChatMessageList.module.css';
import { useData } from '@shared/hooks/useData';


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
  if (msg.createdAt) {
    return formatToClockTime(msg.createdAt);
  }
  if (msg.timestamp) {
    return formatToClockTime(msg.timestamp);
  }
  const time = msg.time || '';
  const clean = time.trim();
  
  if (clean.match(/^\d{1,2}:\d{2}\s+(am|pm)$/i)) {
    return clean.toUpperCase();
  }

  return formatToClockTime(new Date());
};

export default function MessageBubble({ 
  msg, 
  conversation, 
  currentUser, 
  users, 
  initial, 
  searchQuery, 
  openViewer, 
  onReply,
  onUnsend,
  index = 0,
  isLatestMessage = false,
  onRetry = null
}) {
  const navigate = useNavigate();
  const { conversations, toggleJoinCampusGroup, addGroupMember, requestToJoinGroup } = useData();
  const displayTime = getDisplayClockTime(msg, index);

  const meUser = users[currentUser?.username];
  const targetUser = Object.values(users).find(u => u.username === conversation.username || u.id === conversation.userId);
  const meReceipts = currentUser?.settings?.readReceipts !== false && currentUser?.preferences?.readReceipts !== false;
  const targetReceipts = targetUser?.settings?.readReceipts !== false && targetUser?.preferences?.readReceipts !== false;
  const bothHaveReadReceipts = meReceipts && targetReceipts;

  const getReadStatusIcon = (msg) => {
    return null;
  };

  const renderStatusLabel = () => {
    // Only render status labels for messages sent by ME
    if (msg.from !== 'me') return null;

    if (msg.status === 'failed') {
      return (
        <div className={`${styles.msgStatusLabel} ${styles.msgStatusLabelFailed}`}>
          Failed to send. <button className={styles.msgRetryButton} onClick={() => onRetry && onRetry(msg.id)}>Retry</button>
        </div>
      );
    }

    // Do NOT show "Sending..." text per requirement
    if (msg.status === 'sending') {
      return null;
    }

    // Status label ("Sent" / "Seen") ONLY shows if this message is the latest message in the chat
    if (!isLatestMessage) {
      return null;
    }

    if (msg.status === 'read' && bothHaveReadReceipts) {
      return <div className={styles.msgStatusLabel}>Seen</div>;
    }

    return <div className={styles.msgStatusLabel}>Sent</div>;
  };

  if (msg.type === 'system') {
    const parts = msg.text.split(/(@[a-zA-Z0-9_]+)/g);
    return (
      <div className={styles.systemMessageContainer}>
        <div className={styles.systemMessageText}>
          {parts.map((part, idx) => {
            if (part.startsWith('@')) {
              const username = part.substring(1);
              return (
                <span 
                  key={idx} 
                  style={{ color: 'var(--color-primary)', cursor: 'pointer', fontWeight: 600 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (/^[a-zA-Z0-9_.]{1,50}$/.test(username)) {
                      navigate(`/profile/${username}`);
                    }
                  }}
                >
                  {part}
                </span>
              );
            }
            return <span key={idx}>{part}</span>;
          })}
        </div>
      </div>
    );
  }

  const hasQuery = searchQuery && msg.text && typeof msg.text === 'string' && msg.text.toLowerCase().includes(searchQuery.toLowerCase());
  const shouldDim = searchQuery && !hasQuery;
  const isGroupInvite = msg.inviteData && !msg.inviteData.type;
  
  return (
    <div 
      id={`msg-${msg.id}`}
      className={`${styles.msgBubbleContainer} ${msg.from === 'me' ? styles.msgBubbleContainerMe : styles.msgBubbleContainerThem}`}
      style={{ opacity: shouldDim ? 0.45 : 1 }}
    >
      <div className={styles.msgBubbleWrapper}>
        {(conversation.isGroup || conversation.isActivityChat) && (
          <Avatar
            src={
              msg.from === 'me' 
                ? (currentUser?.avatar && isImageUrl(currentUser.avatar) ? currentUser.avatar : initial)
                : (() => {
                    let avatarUrl = msg.senderAvatar;
                    if (!avatarUrl && users && msg.senderName) {
                      const userObj = Object.values(users).find(u => u.displayName === msg.senderName || u.username === msg.senderName || u.name === msg.senderName);
                      if (userObj) avatarUrl = userObj.avatar;
                    }
                    return avatarUrl || (msg.senderName || 'M').charAt(0).toUpperCase();
                  })()
            }
            name={msg.from === 'me' ? 'Me' : msg.senderName}
            size="28px"
            disableHover={true}
            className={styles.msgAvatar}
            onClick={(e) => {
              e.stopPropagation();
              if (msg.from === 'me') {
                if (currentUser?.username) {
                  navigate(`/profile/${currentUser.username}`);
                }
              } else {
                if (users && msg.senderName) {
                  const userObj = Object.values(users).find(u => u.displayName === msg.senderName || u.username === msg.senderName || u.name === msg.senderName);
                  if (userObj && userObj.username) {
                    navigate(`/profile/${userObj.username}`);
                  }
                }
              }
            }}
          />
        )}
        <div className={styles.msgBubbleContent}>
          {(conversation.isGroup || conversation.isActivityChat) && msg.from !== 'me' && (
            <div className={styles.msgSenderName}>
              {msg.senderName || 'Member'}
            </div>
          )}
          {/* ── Audio Card ── */}
          {msg.mediaUrl && msg.mediaType === 'audio' && (
            <div className={styles.msgAudioCardContainer}>
              <VoiceMessagePlayer src={msg.mediaUrl} fromMe={msg.from === 'me'} />
              {(!msg.text && !msg.linkPreview && !msg.inviteData) && (
                <div className={`${styles.msgImageFooter} ${msg.from === 'me' ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
                  <span>{displayTime}</span>
                  {msg.from === 'me' && !conversation.isGroup && !conversation.isActivityChat && getReadStatusIcon(msg)}
                </div>
              )}
            </div>
          )}

          {/* ── Standalone Media Card ── */}
          {msg.mediaUrl && (msg.mediaType === 'image' || msg.mediaType === 'video') && (
            <div className={styles.msgImageCardContainer}>
              <div className={styles.msgImageCard}>
                {msg.mediaType === 'image' ? (
                  <img
                    src={msg.mediaUrl}
                    alt="Attachment"
                    loading="lazy"
                    className={styles.msgMediaImgStandalone}
                    onClick={() => openViewer(
                      [{ url: msg.mediaUrl, type: 'image' }],
                      0,
                      null
                    )}
                  />
                ) : (
                  <div
                    className={styles.msgMediaVideoWrapperStandalone}
                    onClick={() => openViewer(
                      [{ url: msg.mediaUrl, type: 'video' }],
                      0,
                      null
                    )}
                  >
                    <video
                      src={msg.mediaUrl}
                      className={styles.msgMediaImgStandalone}
                      preload="metadata"
                    />
                    <div className={styles.msgMediaVideoPlayBtn}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '2px' }}>
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    </div>
                  </div>
                )}
              </div>
              {(!msg.text && !msg.linkPreview && !msg.inviteData) && (
                <div className={`${styles.msgImageFooter} ${msg.from === 'me' ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
                  <span>{displayTime}</span>
                  {msg.from === 'me' && !conversation.isGroup && !conversation.isActivityChat && getReadStatusIcon(msg)}
                </div>
              )}
            </div>
          )}

          {(msg.text || msg.inviteData || msg.replyTo) && (
          <div className={`${styles.msgBubble} ${msg.from === 'me' ? styles.msgBubbleMe : styles.msgBubbleThem} ${msg.inviteData && !msg.text && !msg.replyTo ? styles.msgBubbleTransparent : ''}`}>
            <div className={styles.msgText} style={{ display: 'flex', flexDirection: 'column' }}>
            
            {msg.replyTo && (
              <div 
                className={styles.msgBubbleReplyRef}
                style={{ cursor: msg.replyTo.id ? 'pointer' : 'default' }}
                onClick={(e) => {
                  if (msg.replyTo.id) {
                    e.stopPropagation();
                    const el = document.getElementById(`msg-${msg.replyTo.id}`);
                    if (el) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      el.classList.add(styles.highlightFlash);
                      setTimeout(() => {
                        el.classList.remove(styles.highlightFlash);
                      }, 1500);
                    }
                  }
                }}
              >
                <div className={styles.msgBubbleReplyRefHeader}>
                  {msg.replyTo.senderName || (msg.replyTo.from === 'me' ? 'You' : 'Someone')}
                </div>
                <div className={styles.msgBubbleReplyRefText}>
                  {msg.replyTo.text || 'Attachment'}
                </div>
              </div>
            )}

            {/* ── Invite Data FIRST ── */}
            <div style={{ position: 'relative', zIndex: 1 }}>
            
            {msg.inviteData && msg.inviteData.type === 'activityShare' ? (
              <SharedActivityPreview activity={msg.inviteData.activity} />
            ) : msg.inviteData && msg.inviteData.type === 'postShare' ? (
              <SharedPostPreview post={msg.inviteData.post} />
            ) : msg.inviteData && msg.inviteData.type === 'profileShare' ? (
              <SharedProfilePreview 
                profile={msg.inviteData.profile} 
                currentUserId={currentUser?.id} 
              />
            ) : msg.inviteData && msg.inviteData.type === 'communityShare' ? (
              <SharedCommunityPreview community={msg.inviteData.community} currentUserId={currentUser?.id} />
            ) : msg.inviteData ? ( (() => {
              const targetGroupId = msg.inviteData.groupId;
              const isCampusGroup = String(targetGroupId).startsWith('c_');
              const targetConv = conversations?.find(c => String(c.id) === String(targetGroupId));
              const isMember = targetConv 
                ? (targetConv.members || targetConv.participants || []).map(String).includes(String(currentUser?.id))
                : false;
              const isJoinedCampus = isCampusGroup && currentUser?.campusGroups?.map(String).includes(String(targetGroupId));
              const alreadyJoined = isMember || isJoinedCampus;
              
              const inviteAuthorId = typeof msg.inviteData.inviterId === 'string' ? msg.inviteData.inviterId : String(msg.inviteData.inviterId);
              let fromText = msg.from === 'me' ? 'you' : (msg.senderName || 'someone');
              
              const isRequested = targetConv?.pendingRequests?.includes(currentUser?.id);
              const buttonText = alreadyJoined 
                ? 'View Group' 
                : isRequested 
                  ? 'Requested' 
                  : 'Join Group';
              
              const handleJoinGroup = () => {
                if (!alreadyJoined) {
                  if (targetConv?.whoCanJoin === 'Request required' || msg.inviteData.whoCanJoin === 'Request required') {
                    if (!isRequested) {
                      requestToJoinGroup(targetGroupId, currentUser?.id);
                      if (window.showToast) {
                        window.showToast('Join request sent! 📨');
                      }
                    }
                  } else {
                    if (isCampusGroup) {
                      toggleJoinCampusGroup(targetGroupId);
                    } else {
                      addGroupMember(targetGroupId, currentUser?.id);
                    }
                    navigate(`/messages/${targetGroupId}`);
                  }
                } else {
                  navigate(`/messages/${targetGroupId}`);
                }
              };
              
              return (
                <div className={styles.groupInviteCard}>
                  <div className={styles.groupInviteHeader}>
                    <Avatar src={msg.inviteData.groupAvatar} name={msg.inviteData.groupName} size="48px" isGroup={true} />
                    <div className={styles.groupInviteInfo}>
                      <h4>{msg.inviteData.groupName}</h4>
                      <p>Group invite from {fromText}</p>
                    </div>
                  </div>
                  <div className={styles.groupInviteActions}>
                    <button 
                      className={styles.groupInviteBtn}
                      onClick={handleJoinGroup}
                      disabled={!alreadyJoined && isRequested}
                      style={(!alreadyJoined && isRequested) ? { opacity: 0.6, cursor: 'default' } : undefined}
                    >
                      {buttonText}
                    </button>
                  </div>
                </div>
              );
            })()
            ) : null}
            </div>
            
            {/* ── Text content ── */}
            {/* ── Text content ── */}
            {msg.text && !isGroupInvite ? (
               <div className={styles.msgTextWrapper} style={{ marginTop: (msg.inviteData) ? '6px' : '0' }}>
                  {searchQuery && hasQuery ? (
                    (() => {
                      const idx = msg.text.toLowerCase().indexOf(searchQuery.toLowerCase());
                      const length = searchQuery.length;
                      return (
                        <span>
                          {msg.text.substring(0, idx)}
                          <mark className={styles.msgSearchHighlight}>{msg.text.substring(idx, idx + length)}</mark>
                          {msg.text.substring(idx + length)}
                        </span>
                      );
                    })()
                  ) : (
                    <RichText content={msg.text} mentions={msg.mentions} urlLimit={40} />
                  )}
                  
                  {/* ── Inline Time inside text bubble ── */}
                  <span className={styles.msgBubbleTimeTextInline}>
                    <span>{displayTime}</span>
                    {msg.from === 'me' && !conversation.isGroup && !conversation.isActivityChat && getReadStatusIcon(msg)}
                  </span>
               </div>
            ) : (
               (!msg.text && (msg.inviteData || msg.replyTo)) && (
                 <div className={styles.msgBubbleTimeText}>
                   <span>{displayTime}</span>
                   {msg.from === 'me' && !conversation.isGroup && !conversation.isActivityChat && getReadStatusIcon(msg)}
                 </div>
               )
            )}

            </div>
          </div>
          )}
          {(isGroupInvite || (msg.inviteData && !msg.text && !msg.linkPreview && !msg.replyTo)) && (
            <div style={{ display: 'flex', justifyContent: msg.from === 'me' ? 'flex-end' : 'flex-start', marginTop: '4px' }}>
              <div className={`${styles.msgImageFooter} ${msg.from === 'me' ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
                <span>{displayTime}</span>
                {msg.from === 'me' && !conversation.isGroup && !conversation.isActivityChat && getReadStatusIcon(msg)}
              </div>
            </div>
          )}
        </div>
        {/* ── Hover Actions ── */}
        <div className={styles.msgHoverActions}>
          <button 
            className={styles.msgHoverActionBtn}
            onClick={() => onReply(msg)}
            title="Reply"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" />
            </svg>
          </button>
          {msg.from === 'me' && onUnsend && (
            <button 
              className={styles.msgHoverActionBtn}
              onClick={() => onUnsend(msg.id)}
              title="Unsend"
              style={{ color: 'var(--color-danger, #ef4444)' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {renderStatusLabel()}
    </div>
  );
}
