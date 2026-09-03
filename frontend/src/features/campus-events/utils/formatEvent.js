// Formatting + safety helpers for Campus Events.

/**
 * Returns true when startTime and endTime fall on the same calendar date
 * (local time). Used to decide whether to show single-day or multi-day UI.
 */
export function isSingleDayEvent(startTime, endTime) {
  if (!startTime || !endTime) return true;
  const s = new Date(startTime);
  const e = new Date(endTime);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return true;
  return (
    s.getFullYear() === e.getFullYear() &&
    s.getMonth() === e.getMonth() &&
    s.getDate() === e.getDate()
  );
}

/** "Mon, Aug 12" — compact for cards */
export function formatEventDate(dateish) {
  if (!dateish) return '';
  const d = new Date(dateish);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "Friday, August 21, 2026" — full for detail page */
export function formatEventDateLong(dateish) {
  if (!dateish) return '';
  const d = new Date(dateish);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/** "Aug 12" — short month+day, no year (used in ranges) */
function formatShortDate(dateish) {
  if (!dateish) return '';
  const d = new Date(dateish);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Date display for the detail page:
 *   single-day → "Friday, August 21, 2026"
 *   multi-day  → "Aug 12 – Aug 20, 2026"
 */
export function formatDetailDate(startTime, endTime) {
  if (isSingleDayEvent(startTime, endTime)) {
    return formatEventDateLong(startTime);
  }
  const s = new Date(startTime);
  const e = new Date(endTime);
  const sameYear = s.getFullYear() === e.getFullYear();
  const startStr = formatShortDate(s);
  const endStr = sameYear
    ? e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${startStr} to ${endStr}`;
}

/**
 * Date display for the redesigned detail page:
 *   single-day               -> "Thursday, September 10, 2026"
 *   multi-day (same year)    -> "September 10 – September 12, 2026"
 *   multi-day (cross-year)   -> "December 30, 2026 – January 2, 2027"
 */
export function formatDetailDateDisplay(startTime, endTime) {
  if (!startTime) return '';
  const s = new Date(startTime);
  if (isNaN(s.getTime())) return '';

  if (!endTime || isSingleDayEvent(startTime, endTime)) {
    return s.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }

  const e = new Date(endTime);
  if (isNaN(e.getTime())) {
    return s.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }

  const sameYear = s.getFullYear() === e.getFullYear();
  if (sameYear) {
    const startStr = s.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    const endStr = e.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    return `${startStr} – ${endStr}`;
  }

  const startStr = s.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const endStr = e.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return `${startStr} – ${endStr}`;
}

/**
 * Time display for the redesigned detail page:
 *   all-day   -> "All day"
 *   range     -> "1:15 PM – 3:15 PM"
 *   single    -> "1:15 PM"
 */
export function formatDetailTimeDisplay(startTime, endTime) {
  if (!startTime) return '';
  const s = new Date(startTime);
  if (isNaN(s.getTime())) return '';

  const formatT = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  if (endTime) {
    const e = new Date(endTime);
    if (!isNaN(e.getTime())) {
      // Check for all-day: 00:00 to 23:59 or 23:59:59
      if (s.getHours() === 0 && s.getMinutes() === 0 && e.getHours() === 23 && e.getMinutes() >= 59) {
        return 'All day';
      }

      const sTime = formatT(s);
      const eTime = formatT(e);
      if (sTime === eTime) return sTime;
      return `${sTime} – ${eTime}`;
    }
  }

  return formatT(s);
}

/**
 * Time display for the detail page:
 *   single-day -> "5:00 PM to 8:00 PM"
 *   multi-day  -> "Aug 12 at 5:00 PM to Aug 20 at 5:00 PM"
 */
export function formatDetailTime(startTime, endTime) {
  if (isSingleDayEvent(startTime, endTime)) {
    return formatTimeRange(startTime, endTime);
  }
  const s = new Date(startTime);
  const e = new Date(endTime);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return '';
  const fmtDate = (d) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const fmtTime = (d) =>
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${fmtDate(s)} at ${fmtTime(s)} to ${fmtDate(e)} at ${fmtTime(e)}`;
}

/**
 * Combined date and time display:
 *   single-day -> "Friday, August 21, 2026, 5:00 PM to 8:00 PM"
 *   multi-day  -> "Aug 12 at 3:00 PM to Aug 20, 2026 at 8:00 PM"
 */
export function formatCombinedDateTime(startTime, endTime) {
  if (isSingleDayEvent(startTime, endTime)) {
    return `${formatEventDateLong(startTime)}, ${formatTimeRange(startTime, endTime)}`;
  }
  const s = new Date(startTime);
  const e = new Date(endTime);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return '';
  
  const sameYear = s.getFullYear() === e.getFullYear();
  const fmtDate = (d, includeYear) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(includeYear ? { year: 'numeric' } : {}) });
  const fmtTime = (d) =>
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  return `${fmtDate(s, !sameYear)} at ${fmtTime(s)} to ${fmtDate(e, true)} at ${fmtTime(e)}`;
}

/**
 * Card date chip:
 *   single-day -> "Mon, Aug 12"
 *   multi-day  -> "Aug 12 to 20" (same month) or "Aug 12 to Sep 3"
 */
export function formatCardDate(startTime, endTime) {
  if (!startTime) return '';
  if (isSingleDayEvent(startTime, endTime)) {
    return formatEventDate(startTime);
  }
  const s = new Date(startTime);
  const e = new Date(endTime);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return formatEventDate(startTime);
  const sMonth = s.toLocaleDateString('en-US', { month: 'short' });
  const eMonth = e.toLocaleDateString('en-US', { month: 'short' });
  if (sMonth === eMonth && s.getFullYear() === e.getFullYear()) {
    return `${sMonth} ${s.getDate()} to ${e.getDate()}`;
  }
  return `${formatShortDate(s)} to ${formatShortDate(e)}`;
}

/**
 * Formats an event date into "XX SEP" format (e.g. "10 SEP" or "05 SEP") for the card bottom badge.
 */
export function formatCardDateBadge(dateish) {
  if (!dateish) return '';
  const d = new Date(dateish);
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  return `${day} ${month}`;
}

export function formatTime(dateish) {
  if (!dateish) return '';
  const d = new Date(dateish);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function formatTimeRange(start, end) {
  const s = formatTime(start);
  const e = formatTime(end);
  if (s && e) return `${s} to ${e}`;
  return s || e || '';
}

/**
 * Only allow http/https registration links to be opened. Mirrors the backend
 * sanitizer — frontend defence-in-depth, never the sole check.
 */
export function isSafeRegistrationUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const p = new URL(url);
    return p.protocol === 'https:' || p.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Converts a datetime into the value expected by <input type="datetime-local">. */
export function toDatetimeLocal(dateish) {
  if (!dateish) return '';
  const d = new Date(dateish);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Extracts the YYYY-MM-DD part from a datetime string (ISO or datetime-local). */
export function toLocalDate(dateish) {
  if (!dateish) return '';
  const d = new Date(dateish);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Extracts the HH:MM part from a datetime string (ISO or datetime-local). */
export function toLocalTime(dateish) {
  if (!dateish) return '';
  const d = new Date(dateish);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Combines a YYYY-MM-DD date string and a HH:MM time string into a local
 * datetime string that can be passed to `new Date(...)` reliably.
 * Returns '' if either part is missing.
 */
export function combineDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return '';
  // Using T separator produces a valid ISO-like string that Date can parse as local time.
  const combined = `${dateStr}T${timeStr}`;
  const d = new Date(combined);
  return isNaN(d.getTime()) ? '' : combined;
}
