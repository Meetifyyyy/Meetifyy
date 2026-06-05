import { useState, useEffect, useRef } from 'react';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';

export default function ChatArea({ conversation, onSendMessage, onReactMessage, onClearChat, onBlockUser, onBack }) {
  const [inputValue, setInputValue] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Voice Call States
  const [isCalling, setIsCalling] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [isMutedNotifications, setIsMutedNotifications] = useState(false);

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

  if (!conversation) return <div className="msg-chat-area" />;

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
  };

  const reactionsList = ['❤️', '👍', '😂', '😮', '😢', '🙏'];

  return (
    <div className="msg-chat-area" onClick={() => setShowMoreMenu(false)}>
      {/* Voice Call UI Overlay */}
      {isCalling && (
        <div className="voice-call-overlay">
          <div className="voice-call-card">
            <div className="voice-call-avatar-container">
              <div className="voice-call-avatar-pulse pulse-1" />
              <div className="voice-call-avatar-pulse pulse-2" />
              <div className="voice-call-avatar" style={{ background: conversation.color }}>
                {conversation.avatar}
              </div>
            </div>
            <div className="voice-call-name">{conversation.name}</div>
            <div className="voice-call-status">
              {callDuration === 0 ? 'Connecting...' : `Active • ${formatDuration(callDuration)}`}
            </div>
            
            {callDuration > 0 && (
              <div className="voice-call-waveform">
                <span className="wave-bar bar-1"></span>
                <span className="wave-bar bar-2"></span>
                <span className="wave-bar bar-3"></span>
                <span className="wave-bar bar-4"></span>
                <span className="wave-bar bar-5"></span>
                <span className="wave-bar bar-6"></span>
                <span className="wave-bar bar-7"></span>
              </div>
            )}

            <div className="voice-call-controls">
              <button 
                className={`voice-call-btn ${isMuted ? 'active' : ''}`} 
                onClick={() => setIsMuted(!isMuted)}
                title={isMuted ? "Unmute Mic" : "Mute Mic"}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {isMuted ? (
                    <>
                      <line x1="1" y1="1" x2="23" y2="23"></line>
                      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                      <line x1="12" y1="19" x2="12" y2="23"></line>
                      <line x1="8" y1="23" x2="16" y2="23"></line>
                    </>
                  ) : (
                    <>
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                      <line x1="12" y1="19" x2="12" y2="23"></line>
                      <line x1="8" y1="23" x2="16" y2="23"></line>
                    </>
                  )}
                </svg>
              </button>
              
              <button 
                className="voice-call-btn end-call" 
                onClick={() => setIsCalling(false)}
                title="End Call"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
                  <line x1="3" y1="21" x2="21" y2="3" strokeWidth="2.5" />
                </svg>
              </button>

              <button 
                className={`voice-call-btn ${isSpeakerOn ? 'active' : ''}`} 
                onClick={() => setIsSpeakerOn(!isSpeakerOn)}
                title={isSpeakerOn ? "Speaker Off" : "Speaker On"}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="msg-chat-header">
        <div className="msg-chat-user">
          {onBack && (
            <button className="msg-chat-back-btn" onClick={onBack} title="Back">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          <div className="msg-chat-avatar" style={{ background: conversation.color }}>
            {conversation.avatar}
          </div>
          <div>
            <div className="msg-chat-name" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              {conversation.name}
              {conversation.blocked && (
                <span className="msg-blocked-badge">Blocked</span>
              )}
            </div>
            <div className="msg-chat-status">{conversation.online ? 'Online' : 'Offline'}</div>
          </div>
        </div>
        <div className="msg-chat-actions" onClick={(e) => e.stopPropagation()}>
          <button 
            className={`msg-chat-action-btn ${isCalling ? 'active' : ''}`} 
            title="Voice Call"
            onClick={() => setIsCalling(true)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </button>
          <div style={{ position: 'relative' }}>
            <button 
              className={`msg-chat-action-btn ${showMoreMenu ? 'active' : ''}`} 
              title="More"
              onClick={() => setShowMoreMenu(!showMoreMenu)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
              </svg>
            </button>
            {showMoreMenu && (
              <div className="msg-more-dropdown">
                <button 
                  className="msg-dropdown-item" 
                  onClick={() => { setShowSearchBar(!showSearchBar); setShowMoreMenu(false); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  Find
                </button>
                <button 
                  className="msg-dropdown-item" 
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
                  className="msg-dropdown-item" 
                  onClick={() => { onClearChat(); setShowMoreMenu(false); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  Clear Chat
                </button>
                <button 
                  className="msg-dropdown-item msg-dropdown-item-danger" 
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
        <div className="msg-search-bar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input 
            type="text" 
            placeholder="Search messages..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="msg-search-bar-input"
            autoFocus
          />
          <button 
            className="msg-search-bar-close" 
            onClick={() => { setShowSearchBar(false); setSearchQuery(''); }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      <div className="msg-chat-body" ref={bodyRef}>
        {conversation.messages.length === 0 ? (
          <div className="msg-empty-state">No messages in this chat.</div>
        ) : (
          conversation.messages.map((msg, i) => {
            const hasQuery = searchQuery && msg.text.toLowerCase().includes(searchQuery.toLowerCase());
            const shouldDim = searchQuery && !hasQuery;
            
            return (
              <div 
                key={i} 
                className={`msg-bubble-container ${msg.from === 'me' ? 'msg-bubble-container-me' : 'msg-bubble-container-them'}`}
                style={{ opacity: shouldDim ? 0.45 : 1 }}
              >
                <div className="msg-bubble-wrapper">
                  <div className={`msg-bubble ${msg.from === 'me' ? 'msg-bubble-me' : 'msg-bubble-them'}`}>
                    {/* Replied text reference inside bubble */}
                    {msg.replyTo && (
                      <div className="msg-bubble-reply-ref">
                        <div className="msg-bubble-reply-ref-header">
                          {msg.replyTo.from === 'me' ? 'You' : conversation.name}
                        </div>
                        <div className="msg-bubble-reply-ref-text">{msg.replyTo.text}</div>
                      </div>
                    )}

                    <div className="msg-text">
                      {searchQuery && hasQuery ? (
                        (() => {
                          const idx = msg.text.toLowerCase().indexOf(searchQuery.toLowerCase());
                          const length = searchQuery.length;
                          return (
                            <>
                              {msg.text.substring(0, idx)}
                              <mark className="msg-search-highlight">{msg.text.substring(idx, idx + length)}</mark>
                              {msg.text.substring(idx + length)}
                            </>
                          );
                        })()
                      ) : (
                        msg.text
                      )}
                    </div>
                    <div className="msg-time-label">{msg.time}</div>

                    {/* Render reactions badge */}
                    {msg.reactions && msg.reactions.length > 0 && (
                      <div className="msg-reactions-badge">
                        {msg.reactions.map((r, rIdx) => (
                          <span key={rIdx}>{r}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Hover options menu for message */}
                  <div className="msg-hover-actions">
                    <div className="msg-hover-reaction-trigger">
                      <button className="msg-hover-action-btn" title="React">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                          <line x1="9" y1="9" x2="9.01" y2="9" strokeWidth="2.5" />
                          <line x1="15" y1="9" x2="15.01" y2="9" strokeWidth="2.5" />
                        </svg>
                      </button>
                      <div className="msg-hover-reactions-popover">
                        {reactionsList.map((emoji) => (
                          <button 
                            key={emoji} 
                            className="msg-hover-reaction-btn" 
                            onClick={() => onReactMessage(i, emoji)}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button 
                      className="msg-hover-action-btn" 
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
      </div>

      {/* Input container */}
      <div className="msg-chat-input-wrap">
        {/* Reply preview bar */}
        {replyingTo && (
          <div className="msg-reply-preview">
            <div className="msg-reply-preview-details">
              <span className="msg-reply-preview-label">
                Replying to {replyingTo.from === 'me' ? 'yourself' : conversation.name}
              </span>
              <span className="msg-reply-preview-text">{replyingTo.text}</span>
            </div>
            <button className="msg-reply-preview-close" onClick={() => setReplyingTo(null)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {showEmojiPicker && (
          <div style={{ position: 'absolute', bottom: '100%', left: '1.25rem', marginBottom: '0.5rem', zIndex: 100 }}>
            <Picker 
              data={data} 
              onEmojiSelect={(emoji) => setInputValue((prev) => prev + emoji.native)} 
              theme="light"
            />
          </div>
        )}
        
        {conversation.blocked ? (
          <div className="msg-blocked-input-overlay">
            This contact is blocked. Click the menu to unblock.
          </div>
        ) : (
          <>
            <button className="msg-emoji-btn" title="Emoji" onClick={() => setShowEmojiPicker(!showEmojiPicker)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9" y2="9" /><line x1="15" y1="9" x2="15" y2="9" />
              </svg>
            </button>
            <input
              type="text"
              className="msg-input"
              placeholder="Type a message..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
            />
            <button className="msg-send-btn" onClick={handleSend}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

