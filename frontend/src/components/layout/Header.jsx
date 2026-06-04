import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import logo from '../../assets/images/logo.webp';

export default function Header({ variant = 'dashboard', activeTab }) {
  const { username, initial, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const navigate = useNavigate();
  const dropdownRef = useRef(null);

  useEffect(() => {
    const close = () => setDropdownOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <header className={activeTab === 'messages' ? 'header--messages' : ''}>
      <div className="nav-left" style={{ cursor: 'pointer' }} onClick={() => navigate('/home')}>
        <img className="logo" src={logo} alt="Meetify" />
        <span className="brand">Meetify</span>
      </div>

      {variant === 'dashboard' && (
        <div className="header-search">
          <input type="text" className="search-bar" placeholder="Search for people, meetings, or topics..." />
        </div>
      )}

      {variant === 'dashboard' ? (
        <nav>
          <div className="notif-icon" title="Notifications">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span className="notif-badge">3</span>
          </div>
          <div className="avatar-wrap">
            <span className="header-username">{username}</span>
            <div
              className="user-avatar"
              onClick={(e) => { e.stopPropagation(); setDropdownOpen(!dropdownOpen); }}
            >
              {initial}
            </div>
            <div className={`dropdown${dropdownOpen ? ' open' : ''}`} ref={dropdownRef}>
              <button onClick={() => navigate('/profile')}>Profile</button>
              <button>Account</button>
              <button>Settings</button>
              <div className="divider" />
              <button className="logout-btn" onClick={handleLogout}>Log out</button>
            </div>
          </div>
        </nav>
      ) : (
        <nav>
          <a href="/">Home</a>
          <a href="#">Features</a>
          <a href="#">About</a>
          <a href="#">Contact</a>
        </nav>
      )}
    </header>
  );
}
