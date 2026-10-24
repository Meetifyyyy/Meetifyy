import { TIME_PREFERENCES } from '../../constants/matchConstants';
import { TimeIcon } from '../art/icons';

/** When-do-you-want-to-meet picker: three rows, each a radio. */
export default function TimeStep({ selectedTime, onSelect }) {
  return (
    <fieldset className="im-fieldset">
      <legend className="im-sr-only">Choose when you want to meet</legend>

      <div className="im-option-list" role="radiogroup" aria-label="When">
        {TIME_PREFERENCES.map((opt) => {
          const selected = selectedTime === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`im-option ${selected ? 'is-selected' : ''}`}
              onClick={() => onSelect(opt.id)}
            >
              <span className="im-option-icon" aria-hidden="true"><TimeIcon id={opt.id} className="im-duo" /></span>
              <span className="im-option-text">
                <span className="im-option-title">{opt.title}</span>
                <span className="im-option-desc">{opt.desc}</span>
              </span>
              <span className="im-radio" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
