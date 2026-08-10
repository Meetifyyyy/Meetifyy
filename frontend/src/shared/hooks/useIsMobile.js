import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT_QUERY = '(max-width: 768px)';

/**
 * Tracks whether the viewport matches the app's mobile breakpoint (768px),
 * the same breakpoint used across Header.module.css / Sidebar.module.css.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches : false
  );

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    const handleChange = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', handleChange);
    setIsMobile(mql.matches);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  return isMobile;
}
