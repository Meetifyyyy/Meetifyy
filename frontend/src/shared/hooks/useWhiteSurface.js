import { useLayoutEffect } from 'react';

/**
 * Marks the document as a white surface while the calling screen is mounted
 * (and `enabled`): on a phone in light theme the page gradient behind it, and
 * the status and navigation bars that read it, become plain white instead of
 * the pale blue edge. See `data-white-surface` in global.css.
 */
export function useWhiteSurface(enabled = true) {
  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const root = document.documentElement;
    root.setAttribute('data-white-surface', '');
    return () => root.removeAttribute('data-white-surface');
  }, [enabled]);
}
