import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Clock } from '@shared/components/icons';
import { visibleViewportBottom } from '@shared/utils/visibleViewport';
import {
  addDaysISO,
  buildTimeSlots,
  formatDateLabel,
  formatDuration,
  formatTime12,
  fromISODate,
  monthGrid,
  parseTimeInput,
  timeToMinutes,
  toISODate,
} from '../utils/eventDateTime';
import styles from './EventDateTimeFields.module.css';

/**
 * Date and time entry for the event form: one UI on every device, so the form
 * looks the same on the website and in the installed app.
 *
 * The date is a calendar popover. The time box takes typed text ("9", "9:30pm",
 * "2130" all work) with a list of 15-minute slots as the shortcut, and an end
 * time shows how long the event would last. On a touch screen the time box does
 * not take typing (it is read-only), so tapping it opens the list without
 * raising the keyboard over it.
 *
 * Values in and out are 'YYYY-MM-DD' and 'HH:MM'.
 */

const COARSE_QUERY = '(pointer: coarse)';

function useCoarsePointer() {
  const [coarse, setCoarse] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(COARSE_QUERY).matches
      : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(COARSE_QUERY);
    const update = () => setCoarse(query.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return coarse;
}

/** Closes a popover on an outside press or Escape (which stays inside it). */
function useDismiss(ref, open, close) {
  useEffect(() => {
    if (!open) return undefined;
    const onPress = (event) => {
      if (ref.current && !ref.current.contains(event.target)) close();
    };
    document.addEventListener('mousedown', onPress);
    return () => document.removeEventListener('mousedown', onPress);
  }, [ref, open, close]);
}

/**
 * Which side of its trigger a popover opens on, and how tall it may be.
 *
 * Measured against what is actually visible: the scrolling form that holds the
 * trigger, cut off by the screen and by the keyboard (visibleViewportBottom).
 * It opens below when it fits there, otherwise on whichever side has more room,
 * and is capped to that room so it scrolls inside itself. It never asks the
 * page to scroll or grow to make space, so opening one moves nothing else.
 * Measured when it opens and when the window resizes; while it is open it simply
 * travels with the trigger like any other part of the form.
 */
const POPOVER_GAP = 6;
const POPOVER_MARGIN = 8;
const POPOVER_MIN_HEIGHT = 120;

function usePopoverPlacement(open, anchorRef, wantedHeight) {
  const [placement, setPlacement] = useState({ above: false, maxHeight: wantedHeight });

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!open || !anchor) return undefined;

    const measure = () => {
      const a = anchor.getBoundingClientRect();
      let top = 0;
      let bottom = visibleViewportBottom() || window.innerHeight;
      for (let node = anchor.parentElement; node; node = node.parentElement) {
        const overflow = getComputedStyle(node).overflowY;
        if (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden') {
          const r = node.getBoundingClientRect();
          top = Math.max(top, r.top);
          bottom = Math.min(bottom, r.bottom);
          break;
        }
      }
      const below = bottom - a.bottom - POPOVER_GAP - POPOVER_MARGIN;
      const above = a.top - top - POPOVER_GAP - POPOVER_MARGIN;
      const useAbove = below < wantedHeight && above > below;
      const room = useAbove ? above : below;
      const maxHeight = Math.max(POPOVER_MIN_HEIGHT, Math.min(wantedHeight, Math.floor(room)));
      setPlacement((prev) => (prev.above === useAbove && prev.maxHeight === maxHeight ? prev : { above: useAbove, maxHeight }));
    };

    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [open, anchorRef, wantedHeight]);

  return placement;
}

/* ── Date ─────────────────────────────────────────────────────────────── */

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const CALENDAR_HEIGHT = 340;

function CalendarPanel({ value, min, onPick, placement }) {
  const today = toISODate(new Date());
  const seed = fromISODate(value) || fromISODate(min) || new Date();
  const [view, setView] = useState({ year: seed.getFullYear(), month: seed.getMonth() });
  const weeks = useMemo(() => monthGrid(view.year, view.month), [view]);

  const step = (delta) => setView(({ year, month }) => {
    const next = new Date(year, month + delta, 1);
    return { year: next.getFullYear(), month: next.getMonth() };
  });
  const monthLabel = new Date(view.year, view.month, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const disabledBefore = min || '';
  // Walking back past the earliest allowed month would only show a dead grid.
  const minMonth = fromISODate(disabledBefore);
  const atEarliest = Boolean(minMonth) && (view.year < minMonth.getFullYear()
    || (view.year === minMonth.getFullYear() && view.month <= minMonth.getMonth()));

  const quick = [
    { label: 'Today', iso: today },
    { label: 'Tomorrow', iso: addDaysISO(today, 1) },
  ].filter((q) => !disabledBefore || q.iso >= disabledBefore);

  return (
    <div
      className={`${styles.calendar} ${placement.above ? styles.above : ''}`}
      style={{ maxHeight: placement.maxHeight }}
      role="dialog"
      aria-label="Choose a date"
    >
      <div className={styles.calHeader}>
        <button type="button" className={styles.calNav} onClick={() => step(-1)} disabled={atEarliest} aria-label="Previous month">
          <ChevronLeft size={16} />
        </button>
        <span className={styles.calMonth} aria-live="polite">{monthLabel}</span>
        <button type="button" className={styles.calNav} onClick={() => step(1)} aria-label="Next month">
          <ChevronRight size={16} />
        </button>
      </div>

      <div className={styles.calWeek} aria-hidden="true">
        {WEEKDAYS.map((d) => <span key={d}>{d}</span>)}
      </div>

      <div className={styles.calGrid}>
        {weeks.flat().map((cell) => {
          const disabled = Boolean(disabledBefore) && cell.iso < disabledBefore;
          const selected = cell.iso === value;
          const label = fromISODate(cell.iso)
            .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
          return (
            <button
              key={cell.iso}
              type="button"
              disabled={disabled}
              aria-label={label}
              aria-pressed={selected}
              aria-current={cell.iso === today ? 'date' : undefined}
              className={[
                styles.calDay,
                cell.inMonth ? '' : styles.calOutside,
                cell.iso === today ? styles.calToday : '',
                selected ? styles.calSelected : '',
              ].join(' ')}
              onClick={() => onPick(cell.iso)}
            >
              {cell.day}
            </button>
          );
        })}
      </div>

      {quick.length > 0 && (
        <div className={styles.calQuick}>
          {quick.map((q) => (
            <button key={q.label} type="button" className={styles.calChip} onClick={() => onPick(q.iso)}>
              {q.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function EventDateField({ id, value, onChange, min = '', placeholder = 'Select date' }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(wrapRef, open, close);
  const placement = usePopoverPlacement(open, wrapRef, CALENDAR_HEIGHT);

  const pick = (iso) => {
    onChange(iso);
    setOpen(false);
  };

  return (
    <div
      className={styles.wrap}
      ref={wrapRef}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        id={id}
        type="button"
        className={`${styles.trigger} ${open ? styles.triggerOpen : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={value ? '' : styles.placeholder}>{value ? formatDateLabel(value) : placeholder}</span>
        <Calendar size={16} className={styles.triggerIcon} aria-hidden="true" />
      </button>
      {open && <CalendarPanel value={value} min={min} onPick={pick} placement={placement} />}
    </div>
  );
}

/* ── Time ─────────────────────────────────────────────────────────────── */

const SLOTS = buildTimeSlots(15);
/** Where the list opens when nothing is chosen yet: the start of a working day. */
const DEFAULT_SCROLL_TIME = '09:00';
const SLOT_LIST_HEIGHT = 232;

/**
 * `after` ('HH:MM') limits the list to later slots and labels each with how long
 * the event would run - for an end time on the same day as its start.
 */
export function EventTimeField({ id, value, onChange, after = '', placeholder = 'Select time' }) {
  const coarse = useCoarsePointer();
  const listId = useId();
  const wrapRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  // What is being typed; null while the box just shows the chosen time.
  const [text, setText] = useState(null);
  const [active, setActive] = useState(-1);

  const afterMinutes = after ? timeToMinutes(after) : null;
  const slots = useMemo(
    () => (afterMinutes === null ? SLOTS : SLOTS.filter((s) => timeToMinutes(s) > afterMinutes)),
    [afterMinutes],
  );

  const commit = useCallback(() => {
    if (text === null) return;
    const trimmed = text.trim();
    if (!trimmed) onChange('');
    else {
      const parsed = parseTimeInput(trimmed);
      // Not a time: drop the typing and keep what was there.
      if (parsed) onChange(parsed);
    }
    setText(null);
  }, [text, onChange]);

  const close = useCallback(() => {
    commit();
    setOpen(false);
  }, [commit]);
  useDismiss(wrapRef, open, close);
  const placement = usePopoverPlacement(open, wrapRef, SLOT_LIST_HEIGHT);

  const focusIndex = useCallback((list, target) => {
    const exact = target ? list.indexOf(target) : -1;
    if (exact >= 0) return exact;
    const reference = timeToMinutes(target || DEFAULT_SCROLL_TIME);
    const near = list.findIndex((s) => timeToMinutes(s) >= reference);
    return near === -1 ? list.length - 1 : near;
  }, []);

  // Open on the chosen time (or mid-morning), not at midnight.
  useEffect(() => {
    if (!open) return;
    setActive(focusIndex(slots, value));
  }, [open, slots, value, focusIndex]);

  useEffect(() => {
    if (!open || active < 0 || !listRef.current) return;
    const option = listRef.current.children[active];
    if (!option) return;
    const list = listRef.current;
    const top = option.offsetTop;
    if (top < list.scrollTop || top + option.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top - list.clientHeight / 2 + option.offsetHeight / 2;
    }
  }, [open, active]);

  const pick = (slot) => {
    onChange(slot);
    setText(null);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActive((i) => Math.max(0, Math.min(slots.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Typed text wins over the highlighted slot; with none, take the slot.
      if (text !== null && text.trim()) commit();
      else if (open && slots[active]) onChange(slots[active]);
      setText(null);
      setOpen(false);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setText(null);
      setOpen(false);
    }
  };

  const shown = text ?? formatTime12(value);

  return (
    <div
      className={styles.wrap}
      ref={wrapRef}
      onBlur={(e) => {
        // Tabbing away: take what was typed and put the list away.
        if (!wrapRef.current?.contains(e.relatedTarget)) close();
      }}
    >
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="none"
        autoComplete="off"
        spellCheck={false}
        className={`${styles.trigger} ${styles.timeInput} ${open ? styles.triggerOpen : ''}`}
        placeholder={placeholder}
        value={shown}
        // A touch screen picks from the list; the keyboard would only cover it.
        readOnly={coarse}
        inputMode={coarse ? 'none' : undefined}
        onFocus={(e) => {
          setOpen(true);
          e.target.select();
        }}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          const parsed = parseTimeInput(e.target.value);
          if (parsed) setActive(focusIndex(slots, parsed));
        }}
        onKeyDown={onKeyDown}
      />
      <Clock size={16} className={`${styles.triggerIcon} ${styles.timeIcon}`} aria-hidden="true" />
      {open && (
        <ul
          className={`${styles.slots} ${placement.above ? styles.above : ''}`}
          style={{ maxHeight: placement.maxHeight }}
          id={listId}
          role="listbox"
          ref={listRef}
        >
          {slots.map((slot, i) => (
            <li
              key={slot}
              role="option"
              aria-selected={slot === value}
              className={`${styles.slot} ${slot === value ? styles.slotSelected : ''} ${i === active ? styles.slotActive : ''}`}
              // Keep focus in the box: a click here must not blur it first.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(slot)}
            >
              <span>{formatTime12(slot)}</span>
              {afterMinutes !== null && (
                <span className={styles.slotNote}>{formatDuration(timeToMinutes(slot) - afterMinutes)}</span>
              )}
            </li>
          ))}
          {slots.length === 0 && <li className={styles.slotEmpty}>No later time today</li>}
        </ul>
      )}
    </div>
  );
}
