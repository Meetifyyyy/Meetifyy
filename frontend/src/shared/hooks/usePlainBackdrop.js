import { useLayoutEffect } from 'react';

const VARS = ['--bg-gradient-center', '--bg-gradient-mid', '--bg-gradient-edge'];

/**
 * Flattens the page gradient behind a full-screen surface while the calling
 * screen is mounted (and `enabled`).
 *
 * A fixed overlay cannot cover everything the gradient paints: the document's
 * scrollbar gutter and the status and navigation bars (which read the same
 * variables) still showed its pale blue edge around a white screen. Setting
 * the variables on <html> itself makes all of them plain, in the theme's own
 * surface colour, and the previous inline values are put back on unmount.
 */
export function usePlainBackdrop(enabled = true) {
  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const root = document.documentElement;
    const colour = root.dataset.theme === 'dark' ? '#000000' : '#ffffff';
    const previous = VARS.map((name) => root.style.getPropertyValue(name));
    VARS.forEach((name) => root.style.setProperty(name, colour));
    return () => {
      VARS.forEach((name, i) => {
        if (previous[i]) root.style.setProperty(name, previous[i]);
        else root.style.removeProperty(name);
      });
    };
  }, [enabled]);
}
