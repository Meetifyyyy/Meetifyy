import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSmartBack } from '../../hooks/useSmartBack';
import ShareProfileModal from './ShareProfileModal';
import styles from './ProfilePageHeader.module.css';

export default function ProfilePageHeader({ username, isOwnProfile, profileUser }) {
  const goBack = useSmartBack();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleMenuClick = () => {
    if (isOwnProfile) {
      navigate('/settings');
    } else {
      setMenuOpen(!menuOpen);
    }
  };

  const handleAction = (action) => {
    if (action === 'Share Profile') {
      setIsShareModalOpen(true);
    } else {
      console.log(`Action clicked: ${action}`);
    }
    setMenuOpen(false);
  };

  return (
    <>
    <header className={styles.header}>
      <button
        className={styles.backBtn}
        onClick={() => goBack('/home')}
        aria-label="Go back"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
      </button>

      <span className={styles.username}>
        {username || '\u00A0'}
      </span>

      <div className={styles.menuContainer} ref={menuRef}>
        <button
          className={styles.menuBtn}
          onClick={handleMenuClick}
          aria-label={isOwnProfile ? "Settings menu" : "Profile options"}
        >
          {isOwnProfile ? (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          ) : (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          )}
        </button>

        {!isOwnProfile && menuOpen && (
          <div className={styles.dropdownMenu}>
            <button className={styles.dropdownItem} style={{ display: 'flex', alignItems: 'center' }} onClick={() => handleAction('Share Profile')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}>
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              Share Profile
            </button>
            <button className={styles.dropdownItem} style={{ display: 'flex', alignItems: 'center' }} onClick={() => handleAction('Block')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}>
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
              </svg>
              Block
            </button>
            <button className={`${styles.dropdownItem} ${styles.dangerItem}`} style={{ display: 'flex', alignItems: 'center' }} onClick={() => handleAction('Report')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}>
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
                <line x1="4" y1="22" x2="4" y2="15"></line>
              </svg>
              Report
            </button>
          </div>
        )}
      </div>
    </header>
    
    {profileUser && (
      <ShareProfileModal 
        isOpen={isShareModalOpen} 
        onClose={() => setIsShareModalOpen(false)} 
        profileUser={profileUser} 
      />
    )}
    </>
  );
}
