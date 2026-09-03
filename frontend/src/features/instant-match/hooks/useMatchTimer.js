import { useState, useEffect, useRef } from 'react';

/**
 * Counts down to an absolute server deadline.
 *
 * Deadline-based rather than tick-based on purpose: a per-second decrement
 * drifts whenever the tab is backgrounded or the main thread is busy, which
 * would leave the ring showing time the server has already taken away. Reading
 * the clock each tick keeps the display honest, including after the device
 * wakes from sleep.
 *
 * @param {number|null} expiresAt  ms epoch deadline from the server
 * @param {number}      fallbackSecs duration to use if no deadline was sent
 * @param {Function}    onExpire   fired once, when the countdown empties
 */
export function useMatchTimer(expiresAt, fallbackSecs, onExpire) {
  const deadlineRef = useRef(null);
  const firedRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  // Resolve the deadline once per match, so re-renders cannot restart it.
  if (deadlineRef.current === null || deadlineRef.current.key !== expiresAt) {
    deadlineRef.current = {
      key: expiresAt,
      at: Number.isFinite(expiresAt) && expiresAt > 0
        ? expiresAt
        : Date.now() + (fallbackSecs || 30) * 1000,
    };
    firedRef.current = false;
  }

  const deadline = deadlineRef.current.at;
  const remaining = () => Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  const [timeLeft, setTimeLeft] = useState(remaining);

  useEffect(() => {
    setTimeLeft(remaining());

    const tick = () => {
      const left = remaining();
      setTimeLeft(left);
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpireRef.current?.();
      }
    };

    tick();

    /*
     * One tick a second, not four.
     *
     * The 250 ms interval existed so the ring depleted smoothly, which meant
     * re-rendering the whole match popup four times a second for the entire
     * accept window. The ring is now depleted by a CSS animation that the
     * browser interpolates at display rate (see CountdownRing), so React only
     * has to keep up with the digits — and those change once a second.
     */
    const id = window.setInterval(tick, 1000);

    /*
     * Expiry is scheduled exactly rather than discovered by polling, so
     * lengthening the interval cannot delay it by up to a second. The tick
     * above is still the safety net for a tab that was asleep at the deadline.
     */
    const untilDeadline = Math.max(0, deadline - Date.now());
    const expiryId = window.setTimeout(tick, untilDeadline + 20);

    // A backgrounded tab throttles timers; re-read on the way back so the ring
    // is correct the instant the user looks at it again.
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(id);
      window.clearTimeout(expiryId);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline]);

  const total = Number.isFinite(fallbackSecs) && fallbackSecs > 0 ? fallbackSecs : 30;
  return {
    timeLeft,
    progress: Math.max(0, Math.min(1, timeLeft / total)),
  };
}
