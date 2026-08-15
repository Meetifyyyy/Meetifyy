import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT_QUERY = '(max-width: 768px)';

/**
 * Tracks whether the viewport matches the app's mobile breakpoint (768px),
 * the same breakpoint used across Header.module.css / Sidebar.module.css.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    try {
      return typeof window !== 'undefined' ? window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches : false;
    } catch (_) {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    try {
      const mql = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
      const handleChange = (e) => setIsMobile(e.matches);

      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', handleChange);
      } else if (typeof mql.addListener === 'function') {
        mql.addListener(handleChange);
      }

      setIsMobile(mql.matches);

      return () => {
        if (typeof mql.removeEventListener === 'function') {
          mql.removeEventListener('change', handleChange);
        } else if (typeof mql.removeListener === 'function') {
          mql.removeListener(handleChange);
        }
      };
    } catch (_) {}
  }, []);

  return isMobile;
}
