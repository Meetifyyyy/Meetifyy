import React, { useState, useEffect, useRef, useId, useCallback } from 'react';
import { CAMPUS_AREAS, getActivity } from '../../constants/matchConstants';
import { classifyActivity } from '../../utils/activityClassifier';
import { useGPSLocation } from '../../hooks/useGPSLocation';

/**
 * Campus area + optional precise location.
 *
 * The dropdown is a custom listbox rather than a <select> so it can carry the
 * poster styling, which means it has to implement the keyboard contract a
 * native select gives for free: arrows to move, Enter/Space to choose, Escape
 * to close, Home/End to jump, and focus returned to the trigger on close.
 */
export default function LocationStep({
  activityId, selectedArea, selectedGPS, onAreaChange, onGPSChange,
}) {
  const isOutdoor = classifyActivity(activityId) === 'outdoor';
  const activity = getActivity(activityId);

  const { loading, error, requestGPS } = useGPSLocation();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  const selectedOption = CAMPUS_AREAS.find((a) => a.id === selectedArea) || null;
  const options = [{ id: '', label: 'No preference', emoji: '🎲' }, ...CAMPUS_AREAS];

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setActiveIndex(-1);
    if (refocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) close(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [open, close]);

  // Move focus onto the list when it opens, so arrow keys reach onListKeyDown.
  useEffect(() => {
    if (open) listRef.current?.focus({ preventScroll: true });
  }, [open]);

  // Keep the highlighted option in view when arrowing through a long list.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const openList = () => {
    const current = options.findIndex((o) => o.id === (selectedArea || ''));
    setActiveIndex(current >= 0 ? current : 0);
    setOpen(true);
  };

  const choose = (id) => {
    onAreaChange(id);
    close();
  };

  const onTriggerKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openList();
    }
  };

  const onListKeyDown = (e) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % options.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + options.length) % options.length);
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (activeIndex >= 0) choose(options[activeIndex].id);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation(); // don't also close the sheet
        close();
        break;
      case 'Tab':
        close(false);
        break;
      default:
        break;
    }
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
      <div className="im-location-block" ref={wrapRef}>
        <span className="im-field-label" id={`${listId}-label`}>Campus area</span>

        <div className="im-select">
          <button
            type="button"
            ref={triggerRef}
            className={`im-select-trigger ${open ? 'is-open' : ''}`}
            onClick={() => (open ? close() : openList())}
            onKeyDown={onTriggerKeyDown}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-labelledby={`${listId}-label`}
            aria-controls={open ? listId : undefined}
          >
            <span className="im-select-value">
              {selectedOption ? (
                <>
                  <span aria-hidden="true">{selectedOption.emoji}</span>
                  {selectedOption.label}
                </>
              ) : (
                <span className="im-select-placeholder">Anywhere on campus</span>
              )}
            </span>
            <svg
              className={`im-select-chevron ${open ? 'is-open' : ''}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {open && (
            // eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role
            <ul
              id={listId}
              ref={listRef}
              className="im-select-list"
              role="listbox"
              tabIndex={-1}
              aria-labelledby={`${listId}-label`}
              aria-activedescendant={activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
              /* The list takes focus as a whole and is driven by
                 aria-activedescendant, keeping the single tab stop a native
                 select would have. */
              onKeyDown={onListKeyDown}
            >
              {options.map((opt, i) => {
                const isSelected = (selectedArea || '') === opt.id;
                return (
                  <li
                    key={opt.id || 'none'}
                    id={`${listId}-opt-${i}`}
                    role="option"
                    aria-selected={isSelected}
                    className={`im-select-option ${i === activeIndex ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''}`}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => choose(opt.id)}
                  >
                    <span aria-hidden="true">{opt.emoji}</span>
                    {opt.label}
                    {isSelected && <span className="im-select-tick" aria-hidden="true">✓</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className={`im-gps-block ${isOutdoor ? 'is-prominent' : ''}`}>
        <button
          type="button"
          className={`im-gps-btn ${selectedGPS ? 'is-on' : ''}`}
          onClick={handleGPSClick}
          disabled={loading}
          aria-pressed={Boolean(selectedGPS)}
        >
          {loading ? (
            <>
              <svg className="im-gps-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
                <path d="M12 3a9 9 0 0 1 9 9" />
              </svg>
              Finding you…
            </>
          ) : selectedGPS ? (
            <>
              <span className="im-gps-dot" aria-hidden="true" />
              Precise location on (tap to turn off)
            </>
          ) : (
            <>
              <span aria-hidden="true">📍</span>
              Use my precise location
            </>
          )}
        </button>

        <p className="im-gps-note">
          {isOutdoor
            ? `Precise location makes ${activity?.label.toLowerCase() ?? 'outdoor'} matches much sharper, and is only used to rank who's nearby.`
            : 'Optional. Your exact coordinates are never shown to anyone, and only help us rank who is closest.'}
        </p>

        {error && (
          <p className="im-gps-error" role="status">
            {error === 'Permission denied'
              ? "Location is off, so we'll match you by campus area instead."
              : error}
          </p>
        )}
      </div>
    </div>
  );
}
