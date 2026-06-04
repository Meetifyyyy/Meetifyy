export default function CommunityCard({ comm, onClick }) {
  return (
    <div className="comm-grid-card" onClick={onClick}>
      <div className="comm-grid-cover" style={{ background: comm.color }}>
        <div className="comm-grid-avatar" style={{ background: comm.color }}>{comm.avatar}</div>
      </div>
      <div className="comm-grid-body">
        <div className="comm-grid-name-row">
          <span className="comm-grid-online-dot" />
          <h3 className="comm-grid-title">{comm.name}</h3>
        </div>
        <p className="comm-grid-desc">{comm.desc}</p>
        <div className="comm-grid-footer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
          </svg>
          <span>{comm.members.toLocaleString()} members</span>
          <span className="comm-grid-online-count">{comm.online} online</span>
        </div>
      </div>
    </div>
  );
}
