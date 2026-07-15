import React from 'react';
import { MATCH_ACTIVITIES } from '../../constants/matchConstants';

export default function ActivityStep({ selectedActivity, onSelect }) {
  return (
    <div className="instant-match-step-container">
      <div style={{ textAlign: 'center', marginBottom: '8px' }}>
        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 4px 0' }}>
          What are you up for?
        </h3>
        <p style={{ fontSize: '0.825rem', color: 'var(--color-text-light)', margin: 0 }}>
          Select an activity to find someone on campus
        </p>
      </div>

      <div className="activity-grid">
        {MATCH_ACTIVITIES.map(activity => {
          const isSelected = selectedActivity === activity.id;
          return (
            <button
              key={activity.id}
              className={`activity-chip ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelect(activity.id)}
            >
              <span className="activity-emoji">{activity.emoji}</span>
              <span>{activity.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
