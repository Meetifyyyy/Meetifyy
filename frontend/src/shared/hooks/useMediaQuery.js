import { useState, useEffect } from 'react';

/**
 * Subscribes to a CSS media query.
 *
 * Returns `true` / `false` when the query can be evaluated, and `null` when
 * `matchMedia` is unavailable (SSR, very old browsers). Callers that use this to
 * skip rendering work should treat `null` as "unknown" and render everything —
 * that way the JS gate can only ever remove work the CSS was already hiding, and
 * never hides something the CSS would have shown.
 *
 * Pass the SAME breakpoint the stylesheet uses. A JS gate on a different
 * breakpoint than the CSS leaves a band of viewport widths where the element JS
 * rendered is the one CSS hid, and the content disappears.
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    try {
      if (typeof window === 'undefined' || !window.matchMedia) return null;
      return window.matchMedia(query).matches;
    } catch (_) {
      return null;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    try {
      const mql = window.matchMedia(query);
      const handleChange = (e) => setMatches(e.matches);
      setMatches(mql.matches);

      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', handleChange);
        return () => mql.removeEventListener('change', handleChange);
      }
      if (typeof mql.addListener === 'function') {
        mql.addListener(handleChange);
        return () => mql.removeListener(handleChange);
      }
    } catch (_) {}
  }, [query]);

  return matches;
}
