import { useLocation } from 'react-router-dom';
import { useInstantMatch } from '../context/InstantMatchContext';
import '../styles/instant-match-fab.css';

export default function InstantMatchFAB() {
  const { sheetOpen, status, openSheet } = useInstantMatch();
  const location = useLocation();

  // Hide FAB if not on /home route or sheet is active
  const isHidden = location.pathname !== '/home' || sheetOpen || status === 'match_found' || status === 'chat_redirect';

  return (
    <div className={`instant-match-fab-container ${isHidden ? 'instant-match-fab-hidden' : ''}`}>
      <button 
        className={`instant-match-fab ${status === 'searching' ? 'searching' : ''}`} 
        onClick={openSheet}
        aria-label="Find Match"
      >
        {status === 'searching' && (
          <>
            <span className="instant-match-fab-ring"></span>
            <span className="instant-match-fab-ring"></span>
            <span className="instant-match-fab-ring"></span>
          </>
        )}
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          viewBox="0 0 24 24" 
          fill="currentColor"
        >
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      </button>
    </div>
  );
}
