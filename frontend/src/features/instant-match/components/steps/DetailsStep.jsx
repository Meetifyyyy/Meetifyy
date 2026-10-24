import { useRef, useEffect, useId } from 'react';
import {
  ACTIVITY_DETAILS_CONFIG, OPTIONAL_DETAIL_MAX, getActivity, accentVars,
} from '../../constants/matchConstants';
import { ActivityIcon } from '../art/icons';

/** Optional one-liner. Never blocks progress — an empty detail is valid. */
export default function DetailsStep({ activityId, value, onChange, onSubmit }) {
  const config = ACTIVITY_DETAILS_CONFIG[activityId];
  const activity = getActivity(activityId);
  const inputRef = useRef(null);
  const inputId = useId();
  const hintId = `${inputId}-hint`;

  useEffect(() => {
    // Focus without scroll-jumping the sheet on mobile.
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  if (!config) return null;

  const remaining = OPTIONAL_DETAIL_MAX - value.length;

  return (
    <div className="im-detail-step">
      <label className="im-field-label" htmlFor={inputId}>
        {config.label}
      </label>

      <div className="im-input-wrap" style={accentVars(activity)}>
        <span className="im-icon-tile im-icon-tile-sm" aria-hidden="true">
          <ActivityIcon id={activityId} />
        </span>
        <input
          id={inputId}
          ref={inputRef}
          className="im-input"
          type="text"
          inputMode="text"
          autoComplete="off"
          enterKeyHint="next"
          placeholder={config.placeholder}
          value={value}
          maxLength={OPTIONAL_DETAIL_MAX}
          aria-describedby={hintId}
          // No leading spaces and no runs of them: a detail of blanks reads
          // as empty everywhere it is shown, and the server trims it anyway.
          onChange={(e) => onChange(e.target.value.replace(/^\s+/, '').replace(/\s{2,}/g, ' '))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSubmit?.();
            }
          }}
        />
        <span
          className={`im-input-count ${remaining <= 10 ? 'is-low' : ''}`}
          aria-live="polite"
        >
          {remaining}
        </span>
      </div>

      <p id={hintId} className="im-field-hint">
        Optional. Skip it and we&apos;ll still find you someone for{' '}
        {activity?.label.toLowerCase() ?? 'this'}.
      </p>
    </div>
  );
}
