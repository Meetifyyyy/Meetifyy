import { useState, useEffect, useRef } from 'react';

/**
 * Time remaining until an absolute deadline, as a display string.
 *
 * Ticks once a minute above an hour and once a second below it, so a 24-hour
 * header re-renders 24 times over its life rather than 86,400 — the timer
 * costs nothing and never becomes the reason the chat feels janky. It also
 * never polls: the deadline is a fixed timestamp from the server, so the only
 * work per tick is subtracting two numbers.
 *
 * Recomputed from `Date.now()` on every tick rather than decremented, so a
 * suspended tab or a throttled background timer resumes with the right answer
 * instead of however far its own counter happened to get.
 */
export function useCountdown(expiresAt, onElapsed) {
  const [remainingMs, setRemainingMs] = useState(() => remainingFrom(expiresAt));

  // Held in a ref so a caller passing an inline arrow does not restart the
  // interval on every render.
  const elapsedRef = useRef(onElapsed);
  elapsedRef.current = onElapsed;
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    if (!expiresAt) {
      setRemainingMs(0);
      return undefined;
    }

    let timer = null;

    const tick = () => {
      const left = remainingFrom(expiresAt);
      setRemainingMs(left);

      if (left <= 0) {
        // Fire once. The consumer's job is to ask the server what happened,
        // not to treat this as proof of anything.
        if (!firedRef.current) {
          firedRef.current = true;
          elapsedRef.current?.();
        }
        return;
      }
      // Below an hour the minutes are moving, so second-resolution earns its
      // keep; above it, once a minute is indistinguishable and far cheaper.
      timer = window.setTimeout(tick, left > 60 * 60 * 1000 ? 60_000 : 1_000);
    };

    tick();
    return () => { if (timer) window.clearTimeout(timer); };
  }, [expiresAt]);

  return { remainingMs, label: formatRemaining(remainingMs) };
}

function remainingFrom(expiresAt) {
  if (!expiresAt) return 0;
  return Math.max(0, expiresAt - Date.now());
}

/** "23h 42m", "42m", "4m 08s" — the unit that is actually changing leads. */
export function formatRemaining(ms) {
  if (!ms || ms <= 0) return '0m';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes >= 5) return `${minutes}m`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}
