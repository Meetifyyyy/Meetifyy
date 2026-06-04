export default function ConversationList({ conversations, activeChatId, onSelect }) {
  return (
    <div className="msg-conv-list">
      <div className="msg-conv-header">
        <h2 className="msg-conv-title">Messages</h2>
        <button className="msg-new-btn" title="New Message">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
        </button>
      </div>
      <div className="msg-conv-search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input type="text" className="msg-search-input" placeholder="Search conversations..." />
      </div>
      <div className="msg-conv-scroll">
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={`conv-item${activeChatId === conv.id ? ' conv-item-active' : ''}`}
            onClick={() => onSelect(conv.id)}
          >
            <div className="conv-avatar" style={{ background: conv.color }}>
              {conv.avatar}
              {conv.online && <span className="conv-online-dot" />}
            </div>
            <div className="conv-info">
              <div className="conv-name">
                {conv.name}
                {conv.unread > 0 && <span className="conv-badge">{conv.unread}</span>}
              </div>
              <div className="conv-preview">{conv.lastMsg}</div>
            </div>
            <div className="conv-time">{conv.time}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
