/**
 * A moment as an email prints it, in the reader's own timezone.
 *
 * The server runs in UTC, so formatting with no zone printed UTC with no label
 * ("3:50 PM" for someone in India at 9:20 PM). The zone comes from the client
 * (an IANA name such as `Asia/Kolkata`); it is validated here because it is
 * caller-supplied, and a missing or invalid one falls back to Indian Standard Time,
 * where most users are. The zone is always printed, so the time is never
 * ambiguous.
 */
/** Used when the client did not tell us its zone. */
export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (
    typeof timeZone !== 'string' ||
    timeZone.length === 0 ||
    timeZone.length > 64
  ) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function formatEmailTime(
  date: Date = new Date(),
  timeZone?: unknown,
): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  return date.toLocaleString('en-US', {
    timeZone: zone,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}
