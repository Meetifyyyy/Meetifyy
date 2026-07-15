import React, { useState, useEffect, useRef } from 'react';
import { CAMPUS_AREAS } from '../../constants/matchConstants';
import { classifyActivity } from '../../utils/activityClassifier';
import { useGPSLocation } from '../../hooks/useGPSLocation';

export default function LocationStep({ 
  activityId, 
  timePreference, 
  selectedArea, 
  selectedGPS, 
  onAreaChange, 
  onGPSChange 
}) {
  const isOutdoor = classifyActivity(activityId) === 'outdoor';
  
  const { location, loading, error, requestGPS, clearLocation } = useGPSLocation();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Bind hook results to state callback
  useEffect(() => {
    if (location) {
      onGPSChange(location);
    }
  }, [location, onGPSChange]);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const handleGPSClick = async () => {
    if (selectedGPS) {
      clearLocation();
      onGPSChange(null);
    } else {
      const coords = await requestGPS();
      if (coords) {
        onGPSChange(coords);
      }
    }
  };

  const selectedOption = CAMPUS_AREAS.find(area => area.id === selectedArea);

  return (
    <div className="instant-match-step-container">
      <div style={{ textAlign: 'center', marginBottom: '8px' }}>
        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 4px 0' }}>
          Where are you?
        </h3>
        <p style={{ fontSize: '0.825rem', color: 'var(--color-text-light)', margin: 0 }}>
          Providing your location improves match quality
        </p>
      </div>
      
      {/* Primary Area Dropdown */}
      <div className="location-dropdown-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }} ref={dropdownRef}>
        <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-main)' }}>
          Campus Area (Recommended)
        </label>
        
        <div className="custom-dropdown">
          <button 
            type="button"
            className={`custom-dropdown-trigger ${isOpen ? 'open' : ''}`}
            onClick={() => setIsOpen(!isOpen)}
          >
            <span>{selectedOption ? selectedOption.label : 'Select campus area...'}</span>
            <svg 
              className={`chevron-icon ${isOpen ? 'rotated' : ''}`}
              width="16" 
              height="16" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2.5" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          
          {isOpen && (
            <div className="custom-dropdown-menu open-upwards">
              <button 
                type="button"
                className={`custom-dropdown-item placeholder ${!selectedArea ? 'active' : ''}`}
                onClick={() => {
                  onAreaChange('');
                  setIsOpen(false);
                }}
              >
                Select campus area...
              </button>
              {CAMPUS_AREAS.map(area => {
                const isActive = selectedArea === area.id;
                return (
                  <button
                    key={area.id}
                    type="button"
                    className={`custom-dropdown-item ${isActive ? 'active' : ''}`}
                    onClick={() => {
                      onAreaChange(area.id);
                      setIsOpen(false);
                    }}
                  >
                    {area.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* GPS Contextual Layout */}
      <div className="gps-tier-container">
        <button
          type="button"
          className={`gps-btn ${selectedGPS ? 'active' : ''} ${isOutdoor ? 'prominent' : ''} ${loading ? 'loading' : ''}`}
          onClick={handleGPSClick}
          disabled={loading}
        >
          {loading ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <svg className="gps-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" />
              </svg>
              Capturing precise location...
            </span>
          ) : selectedGPS ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="gps-live-dot" /> Precise location shared
            </span>
          ) : (
            <span>📍 Enable precise location (optional)</span>
          )}
        </button>

        {isOutdoor ? (
          <span className="gps-nudge-text">
            Enable location for better Sports/Walk matching. Location matching is significantly more accurate for outdoor activities.
          </span>
        ) : (
          <span className="gps-nudge-text" style={{ fontSize: '0.7rem' }}>
            Your exact coordinates will never be shown to anyone.
          </span>
        )}

        {error && (
          <span style={{ fontSize: '0.75rem', color: 'var(--color-danger)', textAlign: 'center' }}>
            {error === 'Permission denied' 
              ? 'GPS permission denied. Using campus area instead.' 
              : error}
          </span>
        )}
      </div>
    </div>
  );
}
