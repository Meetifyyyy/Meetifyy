import { useEffect, useState } from 'react';

/**
 * `flag`, but only once it has stayed true for `delayMs`.
 *
 * For "working" indicators on fast round trips: a search refetch usually
 * finishes well inside 300ms, and a spinner that blinks on for a frame on every
 * keystroke reads as flicker rather than progress. It turns off immediately.
 */
export function useDelayedFlag(flag, delayMs = 300) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!flag) {
      setShown(false);
      return undefined;
    }
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [flag, delayMs]);

  return flag && shown;
}
