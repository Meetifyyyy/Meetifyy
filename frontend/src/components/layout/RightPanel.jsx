export default function RightPanel({ children }) {
  return <aside className="right-panel">{children}</aside>;
}

export function QuickActions({ actions }) {
  return (
    <div className="panel-card">
      <h3 className="panel-title">Quick Actions</h3>
      {actions.map((a, i) => (
        <button key={i} className="action-btn" onClick={a.onClick}>
          {a.icon}
          {a.label}
        </button>
      ))}
    </div>
  );
}

export function OnlineFriends() {
  const friends = [
    { name: 'Alice', letter: 'A', status: 'Online', online: true },
    { name: 'Bob', letter: 'B', status: 'Online', online: true },
    { name: 'Charlie', letter: 'C', status: 'Away', online: false },
    { name: 'Diana', letter: 'D', status: 'Offline', online: false },
  ];

  return (
    <div className="panel-card">
      <h3 className="panel-title">Online Friends</h3>
      {friends.map((f, i) => (
        <div key={i} className="friend-item">
          <div className="friend-avatar">{f.letter}</div>
          <div className="friend-info">
            <div className="friend-name">{f.name}</div>
            <div className={`friend-status${f.online ? ' online' : ''}`}>{f.status}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function UpcomingEvents() {
  return (
    <div className="panel-card">
      <h3 className="panel-title">Upcoming</h3>
      <div className="event-item">
        <div className="event-date">Today<br /><span>3PM</span></div>
        <div className="event-detail">
          <div className="event-name">Team Standup</div>
          <div className="event-meta">30 min</div>
        </div>
      </div>
      <div className="event-item">
        <div className="event-date">Fri<br /><span>11AM</span></div>
        <div className="event-detail">
          <div className="event-name">Design Review</div>
          <div className="event-meta">1 hr</div>
        </div>
      </div>
    </div>
  );
}
