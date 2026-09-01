import React, { useRef, useEffect, useId } from 'react';
import { ACTIVITY_DETAILS_CONFIG, OPTIONAL_DETAIL_MAX, getActivity } from '../../constants/matchConstants';
import { Starburst } from '../decor/Decor';

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
      <div className="im-detail-card">
        <Starburst className="im-detail-burst" points={8} />

        <label className="im-detail-label" htmlFor={inputId}>
          {config.label}
        </label>

        <input
          id={inputId}
          ref={inputRef}
          className="im-detail-input"
          type="text"
          inputMode="text"
          autoComplete="off"
          placeholder={config.placeholder}
          value={value}
          maxLength={OPTIONAL_DETAIL_MAX}
          aria-describedby={hintId}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSubmit?.();
            }
          }}
        />

        <div className="im-detail-foot">
          <p id={hintId} className="im-detail-hint">
            Optional. Skip it and we&apos;ll still find you someone for{' '}
            {activity?.label.toLowerCase() ?? 'this'}.
          </p>
          <span
            className={`im-detail-count ${remaining <= 10 ? 'is-low' : ''}`}
            aria-live="polite"
          >
            {remaining}
          </span>
        </div>
      </div>
    </div>
  );
}
