import React from 'react';
import { TIME_PREFERENCES, accentVars } from '../../constants/matchConstants';
import { Blob } from '../decor/Decor';

/** When-do-you-want-to-meet picker: three stacked poster bands. */
export default function TimeStep({ selectedTime, onSelect }) {
  return (
    <fieldset className="im-fieldset">
      <legend className="im-sr-only">Choose when you want to meet</legend>

      <div className="im-time-stack" role="radiogroup" aria-label="When">
        {TIME_PREFERENCES.map((opt) => {
          const selected = selectedTime === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`im-time-card ${selected ? 'is-selected' : ''}`}
              style={accentVars(opt)}
              onClick={() => onSelect(opt.id)}
            >
              <Blob className="im-time-blob" variant={2} />
              <span className="im-time-badge im-emoji" aria-hidden="true">{opt.emoji}</span>
              <span className="im-time-text">
                <span className="im-time-title">{opt.title}</span>
                <span className="im-time-desc">{opt.desc}</span>
              </span>
              {/* Drawn rather than typed: the arrow and tick glyphs render
                  thin and inconsistently across platforms, which read as
                  weak next to the display type. */}
              <span className="im-time-mark" aria-hidden="true">
                {selected ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="4" y1="12" x2="18" y2="12" />
                    <polyline points="12 6 18 12 12 18" />
                  </svg>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
