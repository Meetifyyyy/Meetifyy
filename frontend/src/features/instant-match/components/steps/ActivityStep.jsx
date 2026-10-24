import { MATCH_ACTIVITIES } from '../../constants/matchConstants';
import { ActivityIcon, CheckIcon } from '../art/icons';

/**
 * Activity picker: a grid of quiet tiles, each a duotone icon over its label.
 * One accent colour — the app's blue — marks the choice. Picking one moves
 * the flow on, so the tile is the whole action.
 */
export default function ActivityStep({ selectedActivity, onSelect, activities = MATCH_ACTIVITIES }) {
  return (
    <fieldset className="im-fieldset">
      <legend className="im-sr-only">Choose an activity</legend>

      <div className="im-activity-grid" role="radiogroup" aria-label="Activity">
        {activities.map((activity, i) => {
          const selected = selectedActivity === activity.id;
          return (
            <button
              key={activity.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`im-activity-tile ${selected ? 'is-selected' : ''}`}
              style={{ '--im-i': i }}
              onClick={() => onSelect(activity.id)}
            >
              <span className="im-activity-icon" aria-hidden="true">
                <ActivityIcon id={activity.id} className="im-duo" />
              </span>
              <span className="im-activity-label">{activity.label}</span>
              <span className="im-activity-check" aria-hidden="true"><CheckIcon /></span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
