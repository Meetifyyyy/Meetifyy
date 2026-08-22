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
    const id = window.setInterval(tick, 250);

    // A backgrounded tab throttles timers; re-read on the way back so the ring
    // is correct the instant the user looks at it again.
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(id);
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
