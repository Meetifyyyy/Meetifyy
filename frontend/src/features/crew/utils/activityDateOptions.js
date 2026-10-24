/**
 * The options the Create Activity "Date & Time" dropdowns offer.
 *
 * Pure: every function takes "now" and the current start explicitly, so the
 * limits can be tested without a clock. The limits are the ones the modal's
 * pick handlers already enforce (they still clamp; these only stop an option
 * that would be clamped or rejected from being offered):
 *
 *   start   no earlier than today (and, on today, no time already past)
 *   end     on or after the start's day, at least 5 minutes after the start,
 *           and no more than 30 days after it
 *
 * A start has no upper limit of its own; a dropdown needs a finite list, so
 * the start's window is a year from today.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_GAP_MS = 5 * 60 * 1000;
export const MAX_SPAN_MS = 30 * DAY_MS;
export const START_WINDOW_DAYS = 365;

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

/** Every 5-minute slot of a day, `h` 0–23. */
export const TIME_SLOTS = (() => {
  const slots = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 5) {
      const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      slots.push({ h, m, label: `${hour12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}` });
    }
  }
  return slots;
})();

export const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

/**
 * The days a side may be on, as `{ min, max }` (start and end of day).
 * @param {'start'|'end'} side
 * @param {Date|null} start the current complete start, if any
 */
export function dateWindow(side, start, now = new Date()) {
  if (side === 'end' && start) {
    return { min: startOfDay(start), max: endOfDay(new Date(start.getTime() + MAX_SPAN_MS)) };
  }
  const today = startOfDay(now);
  return { min: today, max: endOfDay(new Date(today.getTime() + START_WINDOW_DAYS * DAY_MS)) };
}

/** Every month the window touches, `month` 1–12; the year is shown when it crosses one. */
export function monthOptions(window) {
  const crosses = window.min.getFullYear() !== window.max.getFullYear();
  const out = [];
  let y = window.min.getFullYear();
  let m = window.min.getMonth() + 1;
  const lastY = window.max.getFullYear();
  const lastM = window.max.getMonth() + 1;
  while (y < lastY || (y === lastY && m <= lastM)) {
    out.push({
      value: `${y}-${m}`,
      year: y,
      month: m,
      label: crosses ? `${MONTHS_SHORT[m - 1]} ${y}` : MONTHS_LONG[m - 1],
    });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export const isDayAllowed = (year, month, day, window) => {
  const d = new Date(year, month - 1, day);
  return d >= window.min && d <= window.max;
};

/** One option per day of that month (its real length); days outside the window are disabled. */
export function dayOptions(year, month, window) {
  const out = [];
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    out.push({
      value: d,
      label: `${WEEKDAYS[new Date(year, month - 1, d).getDay()]} ${d}`,
      disabled: !isDayAllowed(year, month, d, window),
    });
  }
  return out;
}

/**
 * The day to land on when the month changes under a chosen day: the same day
 * if the month has it and it is allowed, otherwise the nearest allowed one.
 * Null when nothing in that month is allowed.
 */
export function clampDay(year, month, day, window) {
  const len = daysInMonth(year, month);
  const want = Math.min(Math.max(day || 1, 1), len);
  if (isDayAllowed(year, month, want, window)) return want;
  const allowed = [];
  for (let d = 1; d <= len; d++) if (isDayAllowed(year, month, d, window)) allowed.push(d);
  if (!allowed.length) return null;
  return allowed.reduce((best, d) => (Math.abs(d - want) < Math.abs(best - want) ? d : best));
}

/**
 * Every time slot, disabled where it falls outside the limits on the chosen
 * day. With no day chosen yet nothing is disabled: a time may be picked first.
 * @param {'start'|'end'} side
 * @param {{year:number, month:number, day:number}|null} date the side's chosen day
 * @param {Date|null} start the current complete start, if any
 */
export function timeOptions(side, date, start, now = new Date()) {
  return TIME_SLOTS.map((slot) => {
    let disabled = false;
    if (date && date.day) {
      const at = new Date(date.year, date.month - 1, date.day, slot.h, slot.m).getTime();
      if (side === 'start') disabled = at < now.getTime();
      else if (start) disabled = at < start.getTime() + MIN_GAP_MS || at > start.getTime() + MAX_SPAN_MS;
    }
    return { value: `${slot.h}:${slot.m}`, label: slot.label, slot, disabled };
  });
}
