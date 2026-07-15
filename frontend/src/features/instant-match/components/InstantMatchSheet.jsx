import React, { useState, useEffect } from 'react';
import { useInstantMatch } from '../context/InstantMatchContext';
import { ACTIVITY_DETAILS_CONFIG } from '../constants/matchConstants';
import ActivityStep from './steps/ActivityStep';
import TimeStep from './steps/TimeStep';
import DetailsStep from './steps/DetailsStep';
import LocationStep from './steps/LocationStep';
import SearchingScreen from './queue/SearchingScreen';
import '../styles/instant-match-sheet.css';

export default function InstantMatchSheet() {
  const {
    sheetOpen,
    step,
    formData,
    status,
    closeSheet,
    nextStep,
    prevStep,
    setStep,
    updateFormData,
    startSearch
  } = useInstantMatch();

  const [hasBeenOpened, setHasBeenOpened] = useState(false);

  useEffect(() => {
    if (sheetOpen) {
      setHasBeenOpened(true);
    }
  }, [sheetOpen]);

  if (!hasBeenOpened) return null;

  const activityNeedsDetails = !!ACTIVITY_DETAILS_CONFIG[formData.activity];

  const handleActivitySelect = (activityId) => {
    updateFormData({ activity: activityId });
    // Advance to time step automatically for a smooth flow
    setStep(2);
  };

  const handleTimeSelect = (timeId) => {
    updateFormData({ timePreference: timeId });
    if (ACTIVITY_DETAILS_CONFIG[formData.activity]) {
      setStep(3);
    } else {
      // Skip DetailsStep (Step 3) since it's not configured for this activity
      updateFormData({ optionalDetail: '' });
      // Skip directly to Step 4 (Location)
      setStep(4);
    }
  };

  const handleBack = () => {
    if (step === 4 && !activityNeedsDetails) {
      setStep(2);
    } else {
      setStep(step - 1);
    }
  };

  const handleNext = () => {
    if (step === 2 && !activityNeedsDetails) {
      setStep(4);
    } else {
      setStep(step + 1);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <ActivityStep
            selectedActivity={formData.activity}
            onSelect={handleActivitySelect}
          />
        );
      case 2:
        return (
          <TimeStep
            selectedTime={formData.timePreference}
            onSelect={handleTimeSelect}
          />
        );
      case 3:
        return (
          <DetailsStep
            activityId={formData.activity}
            value={formData.optionalDetail}
            onChange={(val) => updateFormData({ optionalDetail: val })}
          />
        );
      case 4:
        return (
          <LocationStep
            activityId={formData.activity}
            timePreference={formData.timePreference}
            selectedArea={formData.location.area}
            selectedGPS={formData.location.gps}
            onAreaChange={(area) =>
              updateFormData({ location: { ...formData.location, area } })
            }
            onGPSChange={(gps) =>
              updateFormData({ location: { ...formData.location, gps } })
            }
          />
        );
      case 5:
        return <SearchingScreen />;
      default:
        return null;
    }
  };

  const isNextDisabled = () => {
    if (step === 1) return !formData.activity;
    if (step === 2) return !formData.timePreference;
    if (step === 3) return !formData.optionalDetail && activityNeedsDetails;
    return false;
  };

  return (
    <div className={`instant-match-overlay ${sheetOpen ? 'active' : ''}`} onClick={(e) => {
      // Tap outside to close
      if (e.target.classList.contains('instant-match-overlay') && status !== 'match_found' && status !== 'chat_redirect') {
        closeSheet();
      }
    }}>
      <div className={`instant-match-sheet ${step === 4 ? 'overflow-visible' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="instant-match-drag-handle" onClick={status !== 'match_found' && status !== 'chat_redirect' ? closeSheet : undefined} />
        
        <div className="instant-match-header">
          <h2>
            <span style={{ fontSize: '1.25rem' }}>⚡</span>
            <span>Instant Match</span>
          </h2>
          <button 
            className="instant-match-close-btn" 
            onClick={closeSheet} 
            aria-label={status === 'searching' ? "Minimize" : "Close"}
          >
            {status === 'searching' ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
          </button>
        </div>

        <div className={`instant-match-body ${step === 4 ? 'overflow-visible' : ''}`}>
          {renderStep()}
        </div>

        {step < 5 && (
          <div className="instant-match-footer">
            <div className="instant-match-footer-main-row">
              <div className="step-tracker-container">
                {[1, 2, 3, 4].map(idx => {
                  if (idx === 3 && !activityNeedsDetails) return null;
                  const isActive = step === idx;
                  return <div key={idx} className={`step-dot ${isActive ? 'active' : ''}`} />;
                })}
              </div>

              <div className="instant-match-footer-actions">
                {step > 1 && (
                  <button className="instant-match-btn-secondary" onClick={handleBack}>
                    Back
                  </button>
                )}
                
                {step < 4 ? (
                  <button
                    className="instant-match-btn-primary"
                    onClick={handleNext}
                    disabled={isNextDisabled()}
                  >
                    Next
                  </button>
                ) : (
                  <button
                    className="instant-match-btn-primary accent-btn"
                    onClick={startSearch}
                    disabled={!formData.activity || !formData.timePreference}
                  >
                    Find Match
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
