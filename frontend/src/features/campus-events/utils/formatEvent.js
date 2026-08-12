// Formatting + safety helpers for Campus Events.

export function formatEventDate(dateish) {
  if (!dateish) return '';
  const d = new Date(dateish);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatEventDateLong(dateish) {
  if (!dateish) return '';
  const d = new Date(dateish);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
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
  if (s && e) return `${s} – ${e}`;
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
