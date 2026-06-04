import { useState, useEffect, useRef } from 'react';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';

export default function ChatArea({ conversation, onSendMessage, onBack }) {
  const [inputValue, setInputValue] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [conversation?.messages?.length]);

  if (!conversation) return <div className="msg-chat-area" />;

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text) return;
    onSendMessage(conversation.id, text);
    setInputValue('');
    setShowEmojiPicker(false);
  };

  return (
    <div className="msg-chat-area">
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
            <div className="msg-chat-name">{conversation.name}</div>
            <div className="msg-chat-status">{conversation.online ? 'Online' : 'Offline'}</div>
          </div>
        </div>
        <div className="msg-chat-actions">
          <button className="msg-chat-action-btn" title="Video Call">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          </button>
          <button className="msg-chat-action-btn" title="Voice Call">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </button>
          <button className="msg-chat-action-btn" title="More">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
            </svg>
          </button>
        </div>
      </div>

      <div className="msg-chat-body" ref={bodyRef}>
        {conversation.messages.map((msg, i) => (
          <div key={i} className={`msg-bubble ${msg.from === 'me' ? 'msg-bubble-me' : 'msg-bubble-them'}`}>
            <div className="msg-text">{msg.text}</div>
            <div className="msg-time-label">{msg.time}</div>
          </div>
        ))}
      </div>

      <div className="msg-chat-input-wrap">
        {showEmojiPicker && (
          <div style={{ position: 'absolute', bottom: '100%', left: '1.25rem', marginBottom: '0.5rem', zIndex: 100 }}>
            <Picker 
              data={data} 
              onEmojiSelect={(emoji) => setInputValue((prev) => prev + emoji.native)} 
              theme="light"
            />
          </div>
        )}
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
      </div>
    </div>
  );
}
