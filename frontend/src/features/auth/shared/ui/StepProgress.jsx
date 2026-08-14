import React from 'react';
import { ArrowLeft } from 'lucide-react';
import s from './authKit.module.css';

/**
 * Signup step indicator: a back control, a slim segmented track that fills in
 * as the user progresses, and a "current / total" counter. Back can be hidden
 * (e.g. the post-OTP step, which must not go back).
 */
export default function StepProgress({ currentStep, totalSteps, onBack, hideBack = false }) {
  const segments = Array.from({ length: totalSteps }, (_, i) => i + 1);

  return (
    <div className={s.progress}>
      <button
        type="button"
        onClick={onBack}
        className={s.back}
        aria-label="Go back"
        disabled={hideBack}
        style={{ visibility: hideBack ? 'hidden' : 'visible' }}
      >
        <ArrowLeft size={17} />
      </button>

      <div className={s.progressTrack}>
        {segments.map((step) => (
          <span
            key={step}
            className={[
              s.progressSegment,
              step < currentStep ? s.progressSegmentDone : '',
              step === currentStep ? s.progressSegmentActive : '',
            ]
              .filter(Boolean)
              .join(' ')}
          />
        ))}
      </div>

      <span className={s.progressLabel}>
        {currentStep}/{totalSteps}
      </span>
    </div>
  );
}
