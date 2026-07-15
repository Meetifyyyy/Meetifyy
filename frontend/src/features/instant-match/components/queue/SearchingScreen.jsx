import React, { useState, useEffect } from 'react';
import { useInstantMatch } from '../../context/InstantMatchContext';
import QueueMetrics from './QueueMetrics';
import '../../styles/searching-screen.css';

const STATUS_MESSAGES = [
  'Looking for students...',
  'Checking availability...',
  'Finding the best match...',
  'Almost there...'
];

export default function SearchingScreen() {
  const { cancelSearch, closeSheet } = useInstantMatch();
  const [msgIndex, setMsgIndex] = useState(0);
  const [startY, setStartY] = useState(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex(prev => (prev + 1) % STATUS_MESSAGES.length);
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const handleStart = (e) => {
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    setStartY(clientY);
  };

  const handleMove = (e) => {
    if (startY === null) return;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const diffY = clientY - startY;
    if (diffY > 40) { // Dragged down more than 40px
      closeSheet();
      setStartY(null);
    }
  };

  const handleEnd = () => {
    setStartY(null);
  };

  return (
    <div className="searching-container">
      <div 
        className="searching-loader-wrapper"
        onTouchStart={handleStart}
        onTouchMove={handleMove}
        onTouchEnd={handleEnd}
        onMouseDown={handleStart}
        onMouseMove={handleMove}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        style={{ cursor: 'grab' }}
      >
        <div className="searching-loader-ring" />
        <div className="searching-loader-ring" />
        <div className="searching-loader-ring" />
        <div className="searching-loader-core">
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            viewBox="0 0 24 24" 
            fill="currentColor"
          >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <h3 className="searching-title">Finding your match</h3>
        <p className="searching-status-msg">
          {STATUS_MESSAGES[msgIndex]}
        </p>
      </div>

      <QueueMetrics />

      <button className="cancel-search-btn" onClick={cancelSearch}>
        Cancel Search
      </button>
    </div>
  );
}
