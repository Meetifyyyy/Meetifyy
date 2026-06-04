import { useAuth } from '../../context/AuthContext';

export default function Sidebar({ activeTab, onTabChange, onCommunityClick }) {
  const { username, initial } = useAuth();

  const communityItems = [
    { id: 'design', name: 'Design Buddies', letter: 'D', members: '12.4k', gradient: 'linear-gradient(135deg, #EC4899, #F97316)' },
    { id: 'aiml', name: 'AI/ML Enthusiasts', letter: 'A', members: '8.2k', gradient: 'linear-gradient(135deg, #3B82F6, #06B6D4)' },
    { id: 'startup', name: 'Startup Hub', letter: 'S', members: '6.7k', gradient: 'linear-gradient(135deg, #22C55E, #10B981)' },
    { id: 'hackathon', name: 'Hackathon Heroes', letter: 'H', members: '4.1k', gradient: 'linear-gradient(135deg, #A855F7, #EC4899)' },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-user">
        <div className="sidebar-avatar">{initial}</div>
        <div>
          <div className="sidebar-name">{username}</div>
          <div className="sidebar-username">@{username}</div>
          <div className="sidebar-status">Online</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <a
          href="#"
          className={`sidebar-link${activeTab === 'home' ? ' active' : ''}`}
          onClick={(e) => { e.preventDefault(); onTabChange('home'); }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          Home
        </a>
        <a
          href="#"
          className={`sidebar-link${activeTab === 'communities' ? ' active' : ''}`}
          onClick={(e) => { e.preventDefault(); onTabChange('communities'); }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          Communities
        </a>
        <a
          href="#"
          className={`sidebar-link${activeTab === 'messages' ? ' active' : ''}`}
          onClick={(e) => { e.preventDefault(); onTabChange('messages'); }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
          Messages
        </a>
      </nav>

      <div className="sidebar-section">
        <div className="sidebar-section-title">Top Communities</div>
        {communityItems.map((c) => (
          <div key={c.id} className="community-item" onClick={() => onCommunityClick(c.id)}>
            <div className="community-avatar" style={{ background: c.gradient }}>{c.letter}</div>
            <div className="community-info">
              <div className="community-name">{c.name}</div>
              <div className="community-meta">{c.members} members</div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
