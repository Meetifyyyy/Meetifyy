import React, { useRef, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { useInstantMatch } from '../context/InstantMatchContext';
import {
  ACTIVITY_DETAILS_CONFIG, getActivity, accentVars,
  STEP_ACTIVITY, STEP_TIME, STEP_DETAILS, STEP_LOCATION, STEP_SEARCHING,
} from '../constants/matchConstants';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useAnimatedHeight } from '../hooks/useAnimatedHeight';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import ActivityStep from './steps/ActivityStep';
import TimeStep from './steps/TimeStep';
import DetailsStep from './steps/DetailsStep';
import LocationStep from './steps/LocationStep';
import SearchingScreen from './queue/SearchingScreen';
import MatchedPanel from './match/MatchedPanel';
import { Bolt, PosterBackdrop, Squiggle } from './decor/Decor';
import '../styles/instant-match.css';
import '../styles/instant-match-sheet.css';

const STEP_COPY = {
  [STEP_ACTIVITY]: { eyebrow: 'Step one', title: "What're you up for?", lede: 'Pick the thing you actually want to do right now.' },
  [STEP_TIME]:     { eyebrow: 'Step two', title: 'When?',                lede: 'How soon do you want to be sitting across from someone?' },
  [STEP_DETAILS]:  { eyebrow: 'Step three', title: 'Any detail?',        lede: 'One line. It helps us put you with the right person.' },
  [STEP_LOCATION]: { eyebrow: 'Last step', title: 'Where are you?',      lede: 'Roughly is fine. Closer matches get found faster.' },
};

export default function InstantMatchSheet() {
  const {
    sheetOpen, step, formData, status, error, busy, connected, restoring,
    recentMatch, closeSheet, setStep, updateFormData, startSearch, dismissError,
  } = useInstantMatch();

  const sheetRef = useRef(null);
  const titleId = useId();

  const activity = getActivity(formData.activity);
  const activityNeedsDetails = Boolean(ACTIVITY_DETAILS_CONFIG[formData.activity]);
  const searching = step === STEP_SEARCHING;
  // A fresh pairing outranks the form: reopening after a match should show
  // who you matched with, not step one again.
  // `matched` is the state the user sits in for the life of the 24h chat;
  // `idle` still qualifies because a reload restores the pairing before the
  // status settles. Either way a live pairing outranks the form.
  const showingMatched =
    Boolean(recentMatch) && (status === 'matched' || status === 'idle') && !searching;

  useScrollLock(sheetOpen);
  useFocusTrap(sheetRef, sheetOpen, closeSheet);

  // The steps differ a lot in height; animate between them so the sheet
  // grows and shrinks instead of snapping.
  const { containerRef: bodyRef, contentRef: bodyContentRef } = useAnimatedHeight();

  // Announce validation problems where the user is looking, and put focus back
  // on the offending step rather than leaving the message unread at the bottom.
  const errorRef = useRef(null);
  useEffect(() => {
    if (error && errorRef.current) errorRef.current.focus({ preventScroll: true });
  }, [error]);

  if (!sheetOpen) return null;

  // The whole sheet is tinted by the chosen activity, so the flow visibly
  // becomes "your" search as you fill it in. Both themes' values are passed
  // down and CSS picks — see the --im-accent-l / --im-accent-d resolution.
  const accentStyle = accentVars(activity, 'im-accent');

  const visibleSteps = activityNeedsDetails
    ? [STEP_ACTIVITY, STEP_TIME, STEP_DETAILS, STEP_LOCATION]
    : [STEP_ACTIVITY, STEP_TIME, STEP_LOCATION];

  const goBack = () => {
    if (step === STEP_LOCATION && !activityNeedsDetails) setStep(STEP_TIME);
    else setStep(Math.max(STEP_ACTIVITY, step - 1));
  };

  const goNext = () => {
    if (step === STEP_TIME && !activityNeedsDetails) setStep(STEP_LOCATION);
    else setStep(Math.min(STEP_LOCATION, step + 1));
  };

  const nextDisabled = () => {
    if (step === STEP_ACTIVITY) return !formData.activity;
    if (step === STEP_TIME) return !formData.timePreference;
    return false;
  };

  const renderStep = () => {
    switch (step) {
      case STEP_ACTIVITY:
        return (
          <ActivityStep
            selectedActivity={formData.activity}
            onSelect={(id) => { updateFormData({ activity: id }); setStep(STEP_TIME); }}
          />
        );
      case STEP_TIME:
        return (
          <TimeStep
            selectedTime={formData.timePreference}
            onSelect={(id) => {
              updateFormData({ timePreference: id });
              setStep(ACTIVITY_DETAILS_CONFIG[formData.activity] ? STEP_DETAILS : STEP_LOCATION);
            }}
          />
        );
      case STEP_DETAILS:
        return (
          <DetailsStep
            activityId={formData.activity}
            value={formData.optionalDetail}
            onChange={(val) => updateFormData({ optionalDetail: val })}
            onSubmit={goNext}
          />
        );
      case STEP_LOCATION:
        return (
          <LocationStep
            activityId={formData.activity}
            selectedArea={formData.location.area}
            selectedGPS={formData.location.gps}
            onAreaChange={(area) => updateFormData({ location: { ...formData.location, area } })}
            onGPSChange={(gps) => updateFormData({ location: { ...formData.location, gps } })}
          />
        );
      case STEP_SEARCHING:
        return <SearchingScreen />;
      default:
        return null;
    }
  };

  const copy = showingMatched ? null : STEP_COPY[step];

  return createPortal(
    <div
      className="im-scope im-sheet-overlay"
      style={accentStyle}
      onMouseDown={(e) => {
        // Only a click that starts *and* ends on the scrim dismisses, so a
        // drag that ends outside the sheet does not close it by accident.
        if (e.target === e.currentTarget) closeSheet();
      }}
    >
      <div
        className={`im-sheet ${searching ? 'im-sheet-searching' : ''}`}
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <PosterBackdrop tone={searching ? 'b' : 'a'} />

        <div className="im-sheet-content">
          <header className="im-sheet-head">
            <div className="im-sheet-brand">
              <span className="im-sheet-boltbox"><Bolt /></span>
              <span className="im-sheet-brandtext">
                <span className="im-eyebrow">Meetifyy</span>
                <span className="im-sheet-brandname">Instant Match</span>
              </span>
            </div>

            <button
              type="button"
              className="im-sheet-close"
              onClick={closeSheet}
              aria-label={searching ? 'Minimise — keep searching' : 'Close Instant Match'}
            >
              {searching ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              )}
            </button>
          </header>

          {!connected && (
            <p className="im-sheet-offline" role="status">
              <span className="im-sheet-offline-dot" aria-hidden="true" />
              Reconnecting… your search is safe.
            </p>
          )}

          {copy && (
            <div className="im-sheet-title-block">
              <span className="im-eyebrow">{copy.eyebrow}</span>
              <h2 id={titleId} className="im-display im-display-lg im-sheet-title">
                {copy.title}
              </h2>
              <Squiggle className="im-sheet-squiggle" />
              <p className="im-lede">{copy.lede}</p>
            </div>
          )}
          {searching && <h2 id={titleId} className="im-sr-only">Searching for a match</h2>}
          {showingMatched && <h2 id={titleId} className="im-sr-only">You have a new match</h2>}

          <div
            className={`im-sheet-body ${step === STEP_LOCATION ? 'im-sheet-body-open' : ''}`}
            ref={bodyRef}
          >
            {/* The inner wrapper is what gets measured — the outer box is the
                one whose height animates. */}
            <div className="im-sheet-body-inner" ref={bodyContentRef}>
              {showingMatched
                ? <MatchedPanel />
                : restoring && step !== STEP_SEARCHING
                  ? <SheetSkeleton />
                  : renderStep()}
            </div>
          </div>

          {error && (
            <div
              className="im-sheet-error"
              role="alert"
              tabIndex={-1}
              ref={errorRef}
            >
              <span className="im-sheet-error-mark" aria-hidden="true">!</span>
              <span>{error}</span>
              <button
                type="button"
                className="im-sheet-error-dismiss"
                onClick={dismissError}
                aria-label="Dismiss this message"
              >
                ×
              </button>
            </div>
          )}

          {!searching && !showingMatched && (
            <footer className="im-sheet-foot">
              <ol className="im-steps" aria-label="Progress">
                {visibleSteps.map((idx, i) => (
                  <li
                    key={idx}
                    className={`im-step-dot ${step === idx ? 'is-active' : ''} ${step > idx ? 'is-done' : ''}`}
                    aria-current={step === idx ? 'step' : undefined}
                  >
                    <span className="im-sr-only">
                      Step {i + 1} of {visibleSteps.length}
                      {step === idx ? ' (current)' : ''}
                    </span>
                  </li>
                ))}
              </ol>

              <div className="im-sheet-actions">
                {step > STEP_ACTIVITY && (
                  <button type="button" className="im-btn im-btn-ghost im-btn-sm" onClick={goBack}>
                    Back
                  </button>
                )}

                {step < STEP_LOCATION ? (
                  <button
                    type="button"
                    className="im-btn im-btn-primary"
                    onClick={goNext}
                    disabled={nextDisabled()}
                  >
                    Next
                  </button>
                ) : (
                  <button
                    type="button"
                    className="im-btn im-btn-go"
                    onClick={startSearch}
                    disabled={busy || !formData.activity || !formData.timePreference}
                  >
                    {busy ? 'Starting…' : 'Find my match'}
                    {!busy && <Bolt className="im-btn-bolt" />}
                  </button>
                )}
              </div>
            </footer>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Shown only while the server's authoritative state is still loading, so the
 *  sheet never flashes an empty form that is about to be replaced. */
function SheetSkeleton() {
  return (
    <div className="im-skeleton" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span key={i} className="im-skeleton-tile" style={{ animationDelay: `${i * 70}ms` }} />
      ))}
    </div>
  );
}
