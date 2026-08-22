import React from 'react';
import { MATCH_ACTIVITIES, accentVars } from '../../constants/matchConstants';
import { Ticks } from '../decor/Decor';

/**
 * Activity picker. Each tile is its own little poster, coloured by the
 * activity, so the grid reads as a set of options rather than a list of words.
 */
export default function ActivityStep({ selectedActivity, onSelect }) {
  return (
    <fieldset className="im-fieldset">
      <legend className="im-sr-only">Choose an activity</legend>

      <div className="im-activity-grid" role="radiogroup" aria-label="Activity">
        {MATCH_ACTIVITIES.map((activity, i) => {
          const selected = selectedActivity === activity.id;
          return (
            <button
              key={activity.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`im-activity-tile ${selected ? 'is-selected' : ''}`}
              style={accentVars(activity)}
              onClick={() => onSelect(activity.id)}
            >
              {/* Every third tile gets a tick field, so the grid has rhythm
                  without every cell being identically decorated. */}
              {i % 3 === 1 && <Ticks className="im-activity-ticks" />}
              <span className="im-activity-emoji im-emoji" aria-hidden="true">{activity.emoji}</span>
              <span className="im-activity-label">{activity.label}</span>
              {selected && <span className="im-activity-check" aria-hidden="true">✓</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
