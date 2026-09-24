import s from './authKit.module.css';

/**
 * Signup progress on narrow screens: a slim segmented track and nothing else.
 * Wide screens have the named step rail beside the form instead, so there this
 * renders nothing and takes no space. The step's own heading says where the
 * person is; a "Step 1 of 6" label above it only repeated that.
 */
export default function StepProgress({ currentStep, totalSteps }) {
  const segments = Array.from({ length: totalSteps }, (_, i) => i + 1);

  return (
    <div
      className={s.progressTrack}
      role="progressbar"
      aria-label={`Signup progress, step ${currentStep} of ${totalSteps}`}
      aria-valuemin={1}
      aria-valuemax={totalSteps}
      aria-valuenow={currentStep}
    >
      {segments.map((n) => (
        <span
          key={n}
          className={[
            s.progressSegment,
            n < currentStep ? s.progressSegmentDone : '',
            n === currentStep ? s.progressSegmentActive : '',
          ]
            .filter(Boolean)
            .join(' ')}
        />
      ))}
    </div>
  );
}
