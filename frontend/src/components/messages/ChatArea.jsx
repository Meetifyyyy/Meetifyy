import { useState, useEffect, useRef, Suspense, lazy } from 'react';
import data from '@emoji-mart/data';
import { isImageUrl } from '../../utils/avatar';
import DefaultAvatar from '../common/DefaultAvatar';
import GroupSettingsModal from './GroupSettingsModal';
import { useSimulatedFetch } from '../../hooks/useSimulatedFetch';
import Skeleton from '../common/Skeleton';
import { ErrorState } from '../common/StateViews';
import styles from './ChatArea.module.css';

const Picker = lazy(() => import('@emoji-mart/react'));

export default function ChatArea({ conversation, onSendMessage, onReactMessage, onClearChat, onBlockUser, onJoinGroup, onBack, showChatOnMobile }) {
  const { isLoading, data: loadedMessages, error, retry } = useSimulatedFetch(conversation?.messages || [], 800, [conversation?.id]);
  const [inputValue, setInputValue] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  
  // Voice Call States
  const [isCalling, setIsCalling] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [isMutedNotifications, setIsMutedNotifications] = useState(false);
  const [showGroupSettings, setShowGroupSettings] = useState(false);

  const bodyRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [conversation?.messages?.length, replyingTo]);

  // Voice Call Duration Timer
  useEffect(() => {
    if (isCalling) {
      setCallDuration(0);
      timerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isCalling]);

  if (!conversation) {
    return (
      <div className={`${styles.msgChatArea} ${styles.msgNoChatSelected}${!showChatOnMobile ? ` ${styles.hideOnMobile}` : ''}`}>
        <div className={styles.msgNoChatContent}>
          <div className={styles.msgNoChatIcon}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <h3>Your Messages</h3>
          <p>Select a conversation from the list to start chatting, or start a new one.</p>
        </div>
      </div>
    );
  }

  const formatDuration = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text || conversation.blocked) return;
    onSendMessage(conversation.id, text, replyingTo);
    setInputValue('');
    setShowEmojiPicker(false);
    setReplyingTo(null);
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
    }, 2500);
  };

  const reactionsList = ['❤️', '👍', '😂', '😮', '😢', '🙏'];

  return (
    <div className={`${styles.msgChatArea}${!showChatOnMobile ? ` ${styles.hideOnMobile}` : ''}`} onClick={() => setShowMoreMenu(false)}>
      {/* Voice Call Overlay */}
      {isCalling && (
        <div className={styles.callOverlay}>
          <div className={styles.callCard}>
            <div className={styles.callAvatarContainer}>
              <div className={`${styles.callAvatarPulse} ${styles.pulse1}`} />
              <div className={`${styles.callAvatarPulse} ${styles.pulse2}`} />
              <div className={styles.callAvatar} style={{ background: isImageUrl(conversation.avatar) ? 'none' : conversation.color }}>
                {isImageUrl(conversation.avatar) ? (
                  <img src={conversation.avatar} alt={conversation.name} className={styles.callAvatarImg} />
                ) : (
                  <DefaultAvatar />
                )}
              </div>
            </div>
            <div className={styles.callName}>{conversation.name}</div>
            <div className={styles.callStatus}>
              {callDuration === 0 ? 'Connecting...' : formatDuration(callDuration)}
            </div>

            {callDuration > 0 && (
              <div className={styles.callWaveform}>
                <span className={`${styles.waveBar} ${styles.bar1}`} />
                <span className={`${styles.waveBar} ${styles.bar2}`} />
                <span className={`${styles.waveBar} ${styles.bar3}`} />
                <span className={`${styles.waveBar} ${styles.bar4}`} />
                <span className={`${styles.waveBar} ${styles.bar5}`} />
                <span className={`${styles.waveBar} ${styles.bar6}`} />
                <span className={`${styles.waveBar} ${styles.bar7}`} />
              </div>
            )}

            <div className={styles.callControls}>
              <button
                className={`${styles.callBtn} ${isMuted ? styles.active : ''}`}
                onClick={() => setIsMuted(!isMuted)}
                title={isMuted ? 'Unmute Mic' : 'Mute Mic'}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {isMuted ? (
                    <>
                      <line x1="1" y1="1" x2="23" y2="23" />
                      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </>
                  ) : (
                    <>
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </>
                  )}
                </svg>
              </button>

              <button
                className={`${styles.callBtn} ${styles.callEndBtn}`}
                onClick={() => setIsCalling(false)}
                title="End Call"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
                  <line x1="3" y1="21" x2="21" y2="3" strokeWidth="2.5" />
                </svg>
              </button>

              <button
                className={`${styles.callBtn} ${isSpeakerOn ? styles.active : ''}`}
                onClick={() => setIsSpeakerOn(!isSpeakerOn)}
                title={isSpeakerOn ? 'Speaker Off' : 'Speaker On'}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.msgChatHeader}>
        <div 
          className={`${styles.msgChatUser} ${conversation.isGroup ? styles.msgChatUserClickable : ''}`}
          onClick={() => conversation.isGroup && setShowGroupSettings(true)}
        >
          {onBack && (
            <button className={styles.msgChatBackBtn} onClick={(e) => { e.stopPropagation(); onBack(); }} title="Back">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
            </button>
          )}
          <div className={styles.msgChatAvatar} style={{ background: isImageUrl(conversation.avatar) ? 'none' : conversation.color }}>
            {isImageUrl(conversation.avatar) ? (
              <img src={conversation.avatar} alt={conversation.name} className={styles.msgChatAvatarImg} />
            ) : (
              <DefaultAvatar />
            )}
          </div>
          <div>
            <div className={styles.msgChatName}>
              {conversation.name}
              {conversation.blocked && (
                <span className={styles.msgBlockedBadge}>Blocked</span>
              )}
            </div>
            <div className={styles.msgChatStatus}>{conversation.online ? 'Online' : 'Offline'}</div>
          </div>
        </div>
        <div className={styles.msgChatActions} onClick={(e) => e.stopPropagation()}>
          <button 
            className={`${styles.msgChatActionBtn} ${isCalling ? styles.msgChatActionBtnActive : ''}`} 
            title="Voice Call"
            onClick={() => setIsCalling(true)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </button>
          <div style={{ position: 'relative' }}>
            <button 
              className={`${styles.msgChatActionBtn} ${showMoreMenu ? styles.msgChatActionBtnActive : ''}`} 
              title="More"
              onClick={() => setShowMoreMenu(!showMoreMenu)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
              </svg>
            </button>
            {showMoreMenu && (
              <div className={styles.msgMoreDropdown}>
                <button 
                  className={styles.msgDropdownItem} 
                  onClick={() => { setShowSearchBar(!showSearchBar); setShowMoreMenu(false); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  Find
                </button>
                <button 
                  className={styles.msgDropdownItem} 
                  onClick={() => { setIsMutedNotifications(!isMutedNotifications); setShowMoreMenu(false); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {isMutedNotifications ? (
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0M1 1l22 22" />
                    ) : (
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
                    )}
                  </svg>
                  {isMutedNotifications ? 'Unmute Alerts' : 'Mute Alerts'}
                </button>
                <button 
                  className={styles.msgDropdownItem} 
                  onClick={() => { onClearChat(); setShowMoreMenu(false); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  Clear Chat
                </button>
                <button 
                  className={`${styles.msgDropdownItem} ${styles.msgDropdownItemDanger}`} 
                  onClick={() => { onBlockUser(); setShowMoreMenu(false); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                  </svg>
                  {conversation.blocked ? 'Unblock Contact' : 'Block Contact'}
                </button>

              </div>
            )}
          </div>
        </div>
      </div>

      {/* Inline Search Bar */}
      {showSearchBar && (
        <div className={styles.msgSearchBar}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input 
            type="text" 
            placeholder="Search messages..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.msgSearchBarInput}
            autoFocus
          />
          <button 
            className={styles.msgSearchBarClose} 
            onClick={() => { setShowSearchBar(false); setSearchQuery(''); }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      <div className={styles.msgChatBody} ref={bodyRef}>
        {isLoading && (
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', width: '100%', justifyContent: 'flex-start' }}>
               <Skeleton type="rect" width="55%" height="3.5rem" style={{ borderRadius: '16px 16px 16px 0' }} />
            </div>
            <div style={{ display: 'flex', width: '100%', justifyContent: 'flex-end' }}>
               <Skeleton type="rect" width="45%" height="2.5rem" style={{ borderRadius: '16px 16px 0 16px' }} />
            </div>
            <div style={{ display: 'flex', width: '100%', justifyContent: 'flex-start' }}>
               <Skeleton type="rect" width="65%" height="4.5rem" style={{ borderRadius: '16px 16px 16px 0' }} />
            </div>
          </div>
        )}

        {!isLoading && error && (
          <ErrorState onRetry={retry} />
        )}

        {!isLoading && !error && loadedMessages && loadedMessages.length === 0 ? (
          <div className={styles.msgEmptyState}>No messages in this chat.</div>
        ) : (
          !isLoading && !error && loadedMessages && loadedMessages.map((msg, i) => {
            const hasQuery = searchQuery && msg.text.toLowerCase().includes(searchQuery.toLowerCase());
            const shouldDim = searchQuery && !hasQuery;
            
            return (
              <div 
                key={i} 
                className={`${styles.msgBubbleContainer} ${msg.from === 'me' ? styles.msgBubbleContainerMe : styles.msgBubbleContainerThem}`}
                style={{ opacity: shouldDim ? 0.45 : 1 }}
              >
                <div className={styles.msgBubbleWrapper}>
                  {conversation.isGroup && msg.from !== 'me' && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '4px', marginLeft: '4px' }}>
                      {msg.senderName || 'Member'}
                    </div>
                  )}
                  <div className={`${styles.msgBubble} ${msg.from === 'me' ? styles.msgBubbleMe : styles.msgBubbleThem}`}>
                    {/* Replied text reference inside bubble */}
                    {msg.replyTo && (
                      <div className={styles.msgBubbleReplyRef}>
                        <div className={styles.msgBubbleReplyRefHeader}>
                          {msg.replyTo.from === 'me' ? 'You' : conversation.name}
                        </div>
                        <div className={styles.msgBubbleReplyRefText}>{msg.replyTo.text}</div>
                      </div>
                    )}

                    <div className={styles.msgText}>
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
                        msg.text
                      )}
                      
                      {msg.inviteData && (
                        <div className={styles.msgInviteCard}>
                          <div className={styles.msgInviteIcon}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                              <circle cx="9" cy="7" r="4"></circle>
                              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                          </div>
                          <div className={styles.msgInviteContent}>
                            <div className={styles.msgInviteTitle}>Group Invitation</div>
                            <div className={styles.msgInviteName}>{msg.inviteData.groupName}</div>
                          </div>
                          <button 
                            className={styles.msgInviteBtn}
                            onClick={() => onJoinGroup && onJoinGroup(msg.inviteData.groupId)}
                          >
                            Join Group
                          </button>
                        </div>
                      )}
                    </div>
                    <div className={styles.msgTimeLabel}>{msg.time}</div>

                    {/* Render reactions badge */}
                    {msg.reactions && msg.reactions.length > 0 && (
                      <div className={styles.msgReactionsBadge}>
                        {msg.reactions.map((r, rIdx) => (
                          <span key={rIdx}>{r}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Hover options menu for message */}
                  <div className={styles.msgHoverActions}>
                    <div className={styles.msgHoverReactionTrigger}>
                      <button className={styles.msgHoverActionBtn} title="React">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                          <line x1="9" y1="9" x2="9.01" y2="9" strokeWidth="2.5" />
                          <line x1="15" y1="9" x2="15.01" y2="9" strokeWidth="2.5" />
                        </svg>
                      </button>
                      <div className={styles.msgHoverReactionsPopover}>
                        {reactionsList.map((emoji) => (
                          <button 
                            key={emoji} 
                            className={styles.msgHoverReactionBtn} 
                            onClick={() => onReactMessage(i, emoji)}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button 
                      className={styles.msgHoverActionBtn} 
                      title="Reply"
                      onClick={() => setReplyingTo({ text: msg.text, from: msg.from, index: i })}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
        {isTyping && !isLoading && (
          <div className={`${styles.msgBubbleContainer} ${styles.msgBubbleContainerThem}`}>
            <div className={styles.msgBubbleWrapper}>
              <div className={`${styles.msgBubble} ${styles.msgBubbleThem}`}>
                <div className={styles.typingIndicator}>
                  <span></span><span></span><span></span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input container */}
      <div className={styles.msgChatInputWrap}>
        {/* Reply preview bar */}
        {replyingTo && (
          <div className={styles.msgReplyPreview}>
            <div className={styles.msgReplyPreviewDetails}>
              <span className={styles.msgReplyPreviewLabel}>
                Replying to {replyingTo.from === 'me' ? 'yourself' : conversation.name}
              </span>
              <span className={styles.msgReplyPreviewText}>{replyingTo.text}</span>
            </div>
            <button className={styles.msgReplyPreviewClose} onClick={() => setReplyingTo(null)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {showEmojiPicker && (
          <div style={{ position: 'absolute', bottom: '100%', left: '1.25rem', marginBottom: '0.5rem', zIndex: 100 }}>
            <Suspense fallback={<div style={{ padding: '1rem', background: 'var(--color-bg-white)', borderRadius: '12px', border: '1px solid #e4e4e7', fontSize: '0.85rem' }}>Loading Emojis...</div>}>
              <Picker 
                data={data} 
                onEmojiSelect={(emoji) => setInputValue((prev) => prev + emoji.native)} 
                theme="light"
              />
            </Suspense>
          </div>
        )}
        
        {conversation.blocked ? (
          <div className={styles.msgBlockedInputOverlay}>
            This contact is blocked. Click the menu to unblock.
          </div>
        ) : (
          <>
            <button className={styles.msgEmojiBtn} title="Emoji" onClick={() => setShowEmojiPicker(!showEmojiPicker)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9" y2="9" /><line x1="15" y1="9" x2="15" y2="9" />
              </svg>
            </button>
            <input
              type="text"
              className={styles.msgInput}
              placeholder="Type a message..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
            />
            <button className={styles.msgSendBtn} onClick={handleSend}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </>
        )}
      </div>

      {showGroupSettings && (
        <GroupSettingsModal
          conversation={conversation}
          onClose={() => setShowGroupSettings(false)}
          onLeaveGroup={() => {
            setShowGroupSettings(false);
            onBack();
          }}
        />
      )}
    </div>
  );
}
