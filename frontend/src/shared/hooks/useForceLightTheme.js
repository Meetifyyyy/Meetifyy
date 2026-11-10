import { useLayoutEffect } from 'react';

/**
 * Public website surfaces that always render light: the landing page, the
 * four legal documents, About and Help & Support. The index.html boot script keeps
 * the same list so a direct load paints light on its first frame; keep the two
 * in step.
 */
export const LIGHT_ONLY_PATHS = [
  '/',
  '/terms-and-conditions',
  '/privacy-policy',
  '/cookie-policy',
  '/community-guidelines',
  '/help-and-support',
  '/about',
];

/**
 * Holds `data-theme="light"` on <html> while the calling page is mounted.
 *
 * The user's own theme is not changed: ThemeContext keeps it and writes it to
 * storage as usual. On the way out the attribute goes back to that stored
 * choice, so the rest of the app is never left pinned. A layout effect, so the
 * swap happens before paint and no frame shows the wrong theme.
 */
export function useForceLightTheme() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const pin = () => {
      if (root.getAttribute('data-theme') !== 'light') root.setAttribute('data-theme', 'light');
    };
    pin();
    root.style.colorScheme = 'light';
    // Anything else that sets the theme while the page is open (the system
    // preference listener, a toggle) is held back to light.
    const observer = new MutationObserver(pin);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      observer.disconnect();
      root.style.colorScheme = '';
      let stored = null;
      try {
        stored = localStorage.getItem('theme');
      } catch {
        stored = null;
      }
      root.setAttribute('data-theme', stored === 'dark' ? 'dark' : 'light');
    };
  }, []);
}
