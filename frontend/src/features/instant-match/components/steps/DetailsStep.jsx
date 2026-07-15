import React from 'react';
import { ACTIVITY_DETAILS_CONFIG } from '../../constants/matchConstants';

export default function DetailsStep({ activityId, value, onChange }) {
  const config = ACTIVITY_DETAILS_CONFIG[activityId];

  // Fallback or empty if not configured (should be skipped by parent sheet anyway)
  if (!config) {
    return null;
  }

  return (
    <div className="instant-match-step-container">
      <div style={{ textAlign: 'center', marginBottom: '8px' }}>
        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 4px 0' }}>
          Add details
        </h3>
        <p style={{ fontSize: '0.825rem', color: 'var(--color-text-light)', margin: 0 }}>
          Help others understand what you are looking for
        </p>
      </div>

      <div className="detail-input-wrapper">
        <label htmlFor="details-step-input">{config.label}</label>
        <input
          id="details-step-input"
          type="text"
          placeholder={config.placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={60}
          autoFocus
        />
      </div>
    </div>
  );
}
