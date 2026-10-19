import { useEffect, useState } from 'react';

/**
 * True once the first screen has rendered and the browser has gone idle (at
 * most IDLE_TIMEOUT_MS after the first caller mounts), and true for the rest of
 * the session after that.
 *
 * For requests nothing on the first screen waits for: badge counts, sidebar
 * widgets. Opening the app sent 11-16 requests in the same second, and on the
 * production API (one replica, half a CPU) the feed and messages that the
 * person is actually looking at queued behind them. Gating the extras here lets
 * the first screen's own requests go first.
 */
const IDLE_TIMEOUT_MS = 3000;
const FALLBACK_DELAY_MS = 1200;

let appIdle = false;
let scheduled = false;
const listeners = new Set();

function markIdle() {
  if (appIdle) return;
  appIdle = true;
  listeners.forEach((notify) => notify(true));
  listeners.clear();
}

function scheduleIdle() {
  if (scheduled || appIdle) return;
  scheduled = true;
  if (typeof window === 'undefined') {
    markIdle();
    return;
  }
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(markIdle, { timeout: IDLE_TIMEOUT_MS });
  } else {
    setTimeout(markIdle, FALLBACK_DELAY_MS);
  }
}

export function useAppIdle() {
  const [idle, setIdle] = useState(appIdle);
  useEffect(() => {
    if (appIdle) {
      setIdle(true);
      return undefined;
    }
    listeners.add(setIdle);
    scheduleIdle();
    return () => listeners.delete(setIdle);
  }, []);
  return idle;
}

/** Test seam: treat the first screen as already up. */
export function markAppIdleForTests() {
  markIdle();
}

/** Test seam: forget the session state. */
export function resetAppIdleForTests() {
  appIdle = false;
  scheduled = false;
  listeners.clear();
}
