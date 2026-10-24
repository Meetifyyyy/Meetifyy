import { CAMPUS_AREAS, getActivity } from '../../constants/matchConstants';
import { classifyActivity } from '../../utils/activityClassifier';
import { useGPSLocation } from '../../hooks/useGPSLocation';
import { AreaIcon, LocateIcon, SpinnerIcon } from '../art/icons';

const AREA_OPTIONS = [{ id: '', label: 'No preference' }, ...CAMPUS_AREAS];

/**
 * Campus area + optional precise location.
 *
 * The areas are a radio group of chips rather than a dropdown: eight short
 * options fit on one screen, a tap is one action instead of two, and nothing
 * has to escape the sheet's scrolling body to be seen.
 */
export default function LocationStep({
  activityId, selectedArea, selectedGPS, onAreaChange, onGPSChange,
}) {
  const isOutdoor = classifyActivity(activityId) === 'outdoor';
  const activity = getActivity(activityId);
  const { loading, error, requestGPS } = useGPSLocation();

  const current = selectedArea || '';

  // Arrow keys move within the group, as they would in a native radio set.
  const onKeyDown = (e) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const index = AREA_OPTIONS.findIndex((o) => o.id === current);
    const next = AREA_OPTIONS[(index + step + AREA_OPTIONS.length) % AREA_OPTIONS.length];
    onAreaChange(next.id);
    e.currentTarget.querySelector(`[data-area="${next.id}"]`)?.focus();
  };

  const handleGPSClick = async () => {
    if (selectedGPS) {
      onGPSChange(null);
      return;
    }
    const coords = await requestGPS();
    if (coords) onGPSChange(coords);
  };

  return (
    <div className="im-location-step">
      <span className="im-field-label" id="im-area-label">Campus area</span>
      <div
        className="im-area-grid"
        role="radiogroup"
        aria-labelledby="im-area-label"
        onKeyDown={onKeyDown}
      >
        {AREA_OPTIONS.map((opt) => {
          const selected = current === opt.id;
          return (
            <button
              key={opt.id || 'none'}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              data-area={opt.id}
              className={`im-area ${selected ? 'is-selected' : ''}`}
              onClick={() => onAreaChange(opt.id)}
            >
              <AreaIcon id={opt.id} />
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className={`im-gps ${selectedGPS ? 'is-on' : ''} ${isOutdoor ? 'is-prominent' : ''}`}
        onClick={handleGPSClick}
        disabled={loading}
        role="switch"
        aria-checked={Boolean(selectedGPS)}
      >
        <span className="im-gps-icon" aria-hidden="true">
          {loading ? <SpinnerIcon /> : <LocateIcon />}
        </span>
        <span className="im-gps-text">
          <span className="im-gps-title">
            {loading ? 'Finding you…' : 'Use my precise location'}
          </span>
          <span className="im-gps-note">
            {isOutdoor
              ? `Makes ${activity?.label.toLowerCase() ?? 'outdoor'} matches much sharper. Only used to rank who's nearby.`
              : 'Never shown to anyone. Only used to rank who is closest.'}
          </span>
        </span>
        <span className="im-switch" aria-hidden="true" />
      </button>

      {error && (
        <p className="im-field-hint im-field-hint-warn" role="status">
          {error === 'Permission denied'
            ? "Location is off, so we'll match you by campus area instead."
            : error}
        </p>
      )}
    </div>
  );
}
