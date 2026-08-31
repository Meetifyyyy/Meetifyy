import { useEffect, useState } from 'react';

/**
 * Debounce a fast-changing value so we don't fire a request on every keystroke.
 *
 * Every admin list view keys its React Query cache on the search box, so an
 * undebounced input issues one round trip per character typed — and, because
 * responses can land out of order, briefly renders results for a prefix of what
 * the admin actually typed.
 */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
