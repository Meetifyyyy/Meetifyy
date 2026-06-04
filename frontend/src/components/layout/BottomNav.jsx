import { useNavigate, useLocation } from 'react-router-dom';

export default function BottomNav({ activeTab, onTabChange }) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleTabClick = (tab) => {
    if (location.pathname !== '/home') {
      navigate('/home', { state: { tab } });
    } else {
      if (onTabChange) {
        onTabChange(tab);
      }
    }
  };

  const isHomeActive = location.pathname === '/home' && activeTab === 'home';
  const isCommunitiesActive = location.pathname === '/home' && (activeTab === 'communities' || activeTab === 'community-detail');
  const isMessagesActive = location.pathname === '/home' && activeTab === 'messages';
  const isProfileActive = location.pathname === '/profile';

  return (
    <div className="bottom-nav">
      <button 
        className={`bottom-nav-item${isHomeActive ? ' active' : ''}`}
        onClick={() => handleTabClick('home')}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
        <span>Home</span>
      </button>

      <button 
        className={`bottom-nav-item${isCommunitiesActive ? ' active' : ''}`}
        onClick={() => handleTabClick('communities')}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <span>Communities</span>
      </button>

      <button 
        className={`bottom-nav-item${isMessagesActive ? ' active' : ''}`}
        onClick={() => handleTabClick('messages')}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
        <span>Messages</span>
      </button>

      <button 
        className={`bottom-nav-item${isProfileActive ? ' active' : ''}`}
        onClick={() => navigate('/profile')}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
        <span>Profile</span>
      </button>
    </div>
  );
}
