// Date and time helpers for the Campus Event form. Dates travel as 'YYYY-MM-DD'
// and times as 'HH:MM' (24-hour), the same shapes `combineDateTime` takes; only
// the labels are 12-hour.

const pad2 = (n) => String(n).padStart(2, '0');

/** Minutes after midnight for an 'HH:MM' string, or null when it is not one. */
export function timeToMinutes(hhmm) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** 'HH:MM' for a minute count within one day, or '' when it falls outside it. */
export function minutesToTime(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) return '';
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

/** '14:05' -> '2:05 PM'. Empty for anything that is not a time. */
export function formatTime12(hhmm) {
  const minutes = timeToMinutes(hhmm);
  if (minutes === null) return '';
  const h24 = Math.floor(minutes / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${pad2(minutes % 60)} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/**
 * Reads what a person types into a time box and returns 'HH:MM', or null.
 *
 * Forgiving on purpose, because typing is the fast path when the time is
 * known: '9', '9am', '9 pm', '9:30', '9.30pm', '930', '0930', '21:15', 'noon'.
 * Without am/pm the hour is read the way an event is usually scheduled: 1-6
 * means afternoon ('5' is 5 PM), 7-12 as typed ('9' is 9 AM, '12' is noon), and
 * 13-23 is 24-hour. A leading zero ('05:30') or 'am' is always taken exactly.
 * The field shows the reading straight away, so a wrong guess is one glance.
 */
export function parseTimeInput(text) {
  const raw = String(text ?? '').trim().toLowerCase().replace(/\./g, ':').replace(/\s+/g, '');
  if (!raw) return null;
  if (raw === 'noon') return '12:00';
  if (raw === 'midnight') return '00:00';

  const match = /^(\d{1,2})(?::?(\d{2}))?(a|p|am|pm)?$/.exec(raw);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const meridiem = match[3];
  if (minute > 59) return null;

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem.startsWith('p') && hour < 12) hour += 12;
    if (meridiem.startsWith('a') && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  } else if (hour >= 1 && hour <= 6 && !match[1].startsWith('0')) {
    hour += 12;
  }
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** Every `stepMinutes` of one day as 'HH:MM', midnight first. */
export function buildTimeSlots(stepMinutes = 15) {
  const slots = [];
  for (let m = 0; m < 24 * 60; m += stepMinutes) slots.push(minutesToTime(m));
  return slots;
}

/** 45 -> '45 min', 60 -> '1 hr', 90 -> '1 hr 30 min', 1500 -> '1 day 1 hr', 4535 -> '3 days 3 hr 35 min'. */
export function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  const total = Math.round(minutes);
  const days = Math.floor(total / (24 * 60));
  const hours = Math.floor((total % (24 * 60)) / 60);
  const mins = total % 60;
  const parts = [];
  if (days) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours) parts.push(`${hours} hr`);
  if (mins) parts.push(`${mins} min`);
  return parts.join(' ');
}

/** Local 'YYYY-MM-DD' for a Date. */
export function toISODate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** The Date (local midnight) for 'YYYY-MM-DD', or null. */
export function fromISODate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `iso` moved by `days`, as 'YYYY-MM-DD'. */
export function addDaysISO(iso, days) {
  const date = fromISODate(iso);
  if (!date) return '';
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

/** 'Fri, Oct 23' - with the year added when it is not this one. */
export function formatDateLabel(iso, now = new Date()) {
  const date = fromISODate(iso);
  if (!date) return '';
  const options = { weekday: 'short', month: 'short', day: 'numeric' };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return date.toLocaleDateString('en-US', options);
}

/** The weeks (Sunday first) that make up a month grid, padded with the
 *  neighbouring months' days so every row has seven cells. */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const weeks = [];
  for (let w = 0; w < 6; w += 1) {
    const week = [];
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      week.push({ iso: toISODate(date), day: date.getDate(), inMonth: date.getMonth() === month });
    }
    weeks.push(week);
  }
  // A sixth row that is entirely the next month only adds height.
  if (!weeks[5].some((cell) => cell.inMonth)) weeks.pop();
  return weeks;
}
