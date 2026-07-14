const fs = require('fs');
const path = require('path');

const dir = 'src/features/messages/components/chat';
const chatAreaFile = path.join(dir, 'ChatArea.jsx');
const chatAreaCssFile = path.join(dir, 'ChatArea.module.css');

let jsx = fs.readFileSync(chatAreaFile, 'utf8');
let css = fs.readFileSync(chatAreaCssFile, 'utf8');

// The MessageBubble needs to import previews and VoiceMessagePlayer
const messageBubbleJsx = `import { useNavigate } from 'react-router-dom';
import { CheckCheck, Check } from 'lucide-react';
import Avatar from '@shared/components/Avatar';
import { isImageUrl } from '@shared/utils/avatar';
import RichText from '@shared/components/mentions/RichText';
import { SharedPostPreview } from '../previews/SharedPostPreview';
import { SharedProfilePreview } from '../previews/SharedProfilePreview';
import { SharedCommunityPreview } from '../previews/SharedCommunityPreview';
import { SharedActivityPreview } from '../previews/SharedActivityPreview';
import VoiceMessagePlayer from './VoiceMessagePlayer';
import styles from './ChatMessageList.module.css';

export default function MessageBubble({ 
  msg, 
  conversation, 
  currentUser, 
  users, 
  initial, 
  searchQuery, 
  openViewer, 
  onReply 
}) {
  const navigate = useNavigate();

  const getReadStatusIcon = (msg) => {
    let status = msg.status;
    if (!status) {
      status = 'read';
    }
    const meUser = users[currentUser];
    const targetUser = Object.values(users).find(u => u.username === conversation.username || u.id === conversation.userId);
    const bothHaveReadReceipts = (meUser?.settings?.privacy?.readReceipts !== false) && (targetUser?.settings?.privacy?.readReceipts !== false);
    
    const isRead = status === 'read' && bothHaveReadReceipts;
    const isDelivered = status === 'read' || status === 'delivered';
    
    let strokeColor = 'rgba(255, 255, 255, 0.6)';
    let readColor = '#38bdf8';

    if (isRead) {
      return <CheckCheck size={16} color={readColor} strokeWidth={2.5} style={{ display: 'inline-block', verticalAlign: 'middle' }} title="Read" />;
    } else if (isDelivered) {
      return <CheckCheck size={16} color={strokeColor} strokeWidth={2.5} style={{ display: 'inline-block', verticalAlign: 'middle' }} title="Delivered" />;
    } else {
      return <Check size={16} color={strokeColor} strokeWidth={2.5} style={{ display: 'inline-block', verticalAlign: 'middle' }} title="Sent" />;
    }
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
                    navigate(\`/profile/\${username}\`);
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
      className={\`\${styles.msgBubbleContainer} \${msg.from === 'me' ? styles.msgBubbleContainerMe : styles.msgBubbleContainerThem}\`}
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
            onClick={(e) => {
              e.stopPropagation();
              if (msg.from === 'me') {
                if (currentUser?.username) {
                  navigate(\`/profile/\${currentUser.username}\`);
                }
              } else {
                if (users && msg.senderName) {
                  const userObj = Object.values(users).find(u => u.displayName === msg.senderName || u.username === msg.senderName || u.name === msg.senderName);
                  if (userObj && userObj.username) {
                    navigate(\`/profile/\${userObj.username}\`);
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
                <div className={\`\${styles.msgImageFooter} \${msg.from === 'me' ? styles.msgImageFooterMe : styles.msgImageFooterThem}\`}>
                  <span>{msg.time}</span>
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
                <div className={\`\${styles.msgImageFooter} \${msg.from === 'me' ? styles.msgImageFooterMe : styles.msgImageFooterThem}\`}>
                  <span>{msg.time}</span>
                  {msg.from === 'me' && !conversation.isGroup && !conversation.isActivityChat && getReadStatusIcon(msg)}
                </div>
              )}
            </div>
          )}

          {(msg.text || msg.inviteData) && (
          <div className={\`\${styles.msgBubble} \${msg.from === 'me' ? styles.msgBubbleMe : styles.msgBubbleThem} \${msg.inviteData && !msg.text ? styles.msgBubbleTransparent : ''}\`}>
            <div className={styles.msgText} style={{ display: 'flex', flexDirection: 'column' }}>
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
              let groupMembers = [];
              const groupInfo = msg.inviteData.groupInfo; // fallback if needed
              
              const inviteAuthorId = typeof msg.inviteData.inviterId === 'string' ? msg.inviteData.inviterId : String(msg.inviteData.inviterId);
              let fromText = msg.from === 'me' ? 'you' : (msg.senderName || 'someone');
              
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
                      onClick={() => navigate(\`/chat/c_\${targetGroupId}\`)}
                    >
                      View Group
                    </button>
                  </div>
                </div>
              );
            })()
            ) : null}
            </div>
            
            {/* ── Text content ── */}
            {msg.text && !isGroupInvite && (
               <div style={{ marginTop: (msg.inviteData) ? '6px' : '0' }}>
                  {searchQuery && hasQuery ? (
                    (() => {
                      const idx = msg.text.toLowerCase().indexOf(searchQuery.toLowerCase());
                      const length = searchQuery.length;
                      return (
                        <>
                          {msg.text.substring(0, idx)}
                          <mark className={styles.msgSearchHighlight}>{msg.text.substring(idx, idx + length)}</mark>
                          {msg.text.substring(idx + length)}
                        </>
                      );
                    })()
                  ) : (
                    <RichText content={msg.text} mentions={msg.mentions} urlLimit={40} />
                  )}
               </div>
            )}
          </div>
          {(isGroupInvite || (msg.inviteData && !msg.text && !msg.linkPreview)) ? (
            <div style={{ display: 'flex', justifyContent: msg.from === 'me' ? 'flex-end' : 'flex-start', marginTop: '4px' }}>
              <div className={\`\${styles.msgImageFooter} \${msg.from === 'me' ? styles.msgImageFooterMe : styles.msgImageFooterThem}\`}>
                <span>{msg.time}</span>
                {msg.from === 'me' && !conversation.isGroup && !conversation.isActivityChat && getReadStatusIcon(msg)}
              </div>
            </div>
          ) : (
            <div className={styles.msgTimeLabel}>
              {msg.time}
              {msg.from === 'me' && !conversation.isGroup && !conversation.isActivityChat && getReadStatusIcon(msg)}
            </div>
          )}
        </div>
        )}
      </div>
      
      {/* ── Inline Reply Button ── */}
      <button 
        className={\`\${styles.msgInlineReplyBtn} \${msg.from === 'me' ? styles.msgInlineReplyBtnLeft : styles.msgInlineReplyBtnRight}\`}
        onClick={() => onReply(msg)}
        title="Reply"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" />
        </svg>
      </button>
    </div>
  );
}
`;
fs.writeFileSync(path.join(dir, 'MessageBubble.jsx'), messageBubbleJsx);

const chatMessageListJsx = `import { useEffect, useRef } from 'react';
import MessageRowSkeleton from './MessageRowSkeleton';
import { ErrorState } from '@shared/components/StateViews';
import MessageBubble from './MessageBubble';
import styles from './ChatMessageList.module.css';

export default function ChatMessageList({
  isLoading,
  error,
  retry,
  loadedMessages,
  conversation,
  currentUser,
  users,
  initial,
  searchQuery,
  openViewer,
  onReply,
  isTyping,
  replyingTo
}) {
  const bodyRef = useRef(null);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [loadedMessages?.length, replyingTo]);

  return (
    <div className={styles.msgChatBody} ref={bodyRef}>
      {isLoading && (
        <MessageRowSkeleton />
      )}

      {!isLoading && error && (
        <ErrorState onRetry={retry} />
      )}

      {!isLoading && !error && loadedMessages && loadedMessages.length === 0 ? (
        <div className={styles.msgEmptyState}>No messages in this chat.</div>
      ) : (
        !isLoading && !error && loadedMessages && loadedMessages.map((msg, i) => (
          <MessageBubble
            key={i}
            msg={msg}
            conversation={conversation}
            currentUser={currentUser}
            users={users}
            initial={initial}
            searchQuery={searchQuery}
            openViewer={openViewer}
            onReply={onReply}
          />
        ))
      )}
      {isTyping && !isLoading && (
        <div className={\`\${styles.msgBubbleContainer} \${styles.msgBubbleContainerThem}\`}>
          <div className={styles.msgBubbleWrapper}>
            <div className={\`\${styles.msgBubble} \${styles.msgBubbleThem}\`}>
              <div className={styles.typingIndicator}>
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
`;
fs.writeFileSync(path.join(dir, 'ChatMessageList.jsx'), chatMessageListJsx);

// Extract CSS
const bodyStart = css.indexOf('.msgChatBody');
const bodyEnd = css.indexOf('.msgChatInputWrap'); // wait, msgChatInputWrap was already removed!
// We can just take everything from .msgChatBody down to the end of the file.
if (bodyStart !== -1) {
  const listCss = css.substring(bodyStart);
  fs.writeFileSync(path.join(dir, 'ChatMessageList.module.css'), listCss);
  
  // also remove it from ChatArea.module.css
  const newCss = css.substring(0, bodyStart);
  fs.writeFileSync(chatAreaCssFile, newCss);
  console.log('Extracted ChatMessageList CSS');
}

// Update ChatArea.jsx
// 1. Remove getReadStatusIcon
const iconStart = 'const getReadStatusIcon = (msg) => {';
const iconEndStr = '  };\n';
const iconStartIdx = jsx.indexOf(iconStart);
const iconEndIdx = jsx.indexOf(iconEndStr, iconStartIdx);

if (iconStartIdx !== -1 && iconEndIdx !== -1) {
  jsx = jsx.substring(0, iconStartIdx) + jsx.substring(iconEndIdx + iconEndStr.length);
}

// 2. Remove bodyRef and useEffect for scrollTop
const bodyRefStart = 'const bodyRef = useRef(null);';
const bodyRefEnd = '}, [conversation?.messages?.length, replyingTo]);';
const bodyRefStartIdx = jsx.indexOf(bodyRefStart);
const bodyRefEndIdx = jsx.indexOf(bodyRefEnd, bodyRefStartIdx);
if (bodyRefStartIdx !== -1 && bodyRefEndIdx !== -1) {
  jsx = jsx.substring(0, bodyRefStartIdx) + jsx.substring(bodyRefEndIdx + bodyRefEnd.length);
}

// 3. Replace <div className={styles.msgChatBody}> block
const renderBodyStart = '<div className={styles.msgChatBody} ref={bodyRef}>';
const renderBodyEndStr = '{/* Inline Search Bar */}'; // wait, the search bar is BEFORE the chat body.
// So the chat body ends right before <ChatInputArea
const renderBodyEndStr2 = '<ChatInputArea';
const renderBodyStartIdx = jsx.indexOf(renderBodyStart);
const renderBodyEndIdx = jsx.indexOf(renderBodyEndStr2, renderBodyStartIdx);

if (renderBodyStartIdx !== -1 && renderBodyEndIdx !== -1) {
  const replacement = `      <ChatMessageList
        isLoading={isLoading}
        error={error}
        retry={retry}
        loadedMessages={loadedMessages}
        conversation={conversation}
        currentUser={currentUser}
        users={users}
        initial={initial}
        searchQuery={searchQuery}
        openViewer={openViewer}
        onReply={setReplyingTo}
        isTyping={isTyping}
        replyingTo={replyingTo}
      />\n\n      `;
  jsx = jsx.substring(0, renderBodyStartIdx) + replacement + jsx.substring(renderBodyEndIdx);
}

// 4. Add import
jsx = jsx.replace("import ChatInputArea from './ChatInputArea';", "import ChatInputArea from './ChatInputArea';\nimport ChatMessageList from './ChatMessageList';");

// 5. Remove unused imports in ChatArea.jsx (like CheckCheck, etc., Previews)
// This might be tricky with regex, we can just let eslint ignore it or remove them manually later.
fs.writeFileSync(chatAreaFile, jsx);
console.log('Done replacing ChatMessageList');
