import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';

import { resolveInitialTheme, shouldFollowSystem } from '@core/theme/resolveTheme';
import { getThemeTransitionDriver } from '@shared/theme/themeTransition';

const ThemeContext = createContext();

/** Presses closer together than this count as one (see toggleTheme). */
const MIN_PRESS_GAP_MS = 50;

/**
 * Dynamically resolves the origin coordinate (x, y) for the radial theme reveal.
 * - Desktop (> 768px): Originates from the center of the user avatar in the header.
 * - Mobile (<= 768px): Originates from the center of the theme toggle button.
 * - Guarantees fresh measurement at the exact instant of user interaction.
 */
function getThemeOrigin(options) {
  const isDesktop = typeof window !== 'undefined' && window.innerWidth > 768;
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== 'undefined' 
    ? (window.visualViewport?.height || window.innerHeight) 
    : 844;

  // 1. Desktop layout: Origin is the profile picture avatar in the top-right header
  if (isDesktop) {
    let avatarEl = null;

    // A. Explicit originElement passed in options
    if (options?.originElement && typeof options.originElement.getBoundingClientRect === 'function') {
      const r = options.originElement.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        avatarEl = options.originElement;
      }
    }

    // B. Live DOM query for desktop header avatar
    if (!avatarEl && typeof document !== 'undefined') {
      const candidates = [
        document.querySelector('[data-header-avatar="true"]'),
        document.querySelector('[data-header-avatar]'),
        document.querySelector('[data-avatar-user]'),
      ];

      for (const el of candidates) {
        if (el && typeof el.getBoundingClientRect === 'function') {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            avatarEl = el;
            break;
          }
        }
      }
    }

    if (avatarEl) {
      const rect = avatarEl.getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      };
    }

    // Dynamic desktop fallback: Top-right user avatar position
    return {
      x: Math.max(viewportWidth - 56, 20),
      y: 30,
    };
  }

  // 2. Mobile layout (<= 768px): Origin is the theme toggle button in drawer / tap target
  let themeEl = null;

  if (options?.originElement && typeof options.originElement.getBoundingClientRect === 'function') {
    themeEl = options.originElement;
  } else if (options?.currentTarget && typeof options.currentTarget.getBoundingClientRect === 'function') {
    themeEl = options.currentTarget;
  } else if (options?.target && typeof options.target.getBoundingClientRect === 'function') {
    themeEl = options.target.closest('button') || options.target;
  }

  if (!themeEl && typeof document !== 'undefined') {
    themeEl = document.querySelector('[data-theme-toggle="true"]') ||
              document.querySelector('[data-theme-toggle]') ||
              document.querySelector('[aria-label="Toggle theme"]');
  }

  if (themeEl && typeof themeEl.getBoundingClientRect === 'function') {
    const rect = themeEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      };
    }
  }

  if (options?.clientX != null && options?.clientY != null) {
    return {
      x: Math.round(options.clientX),
      y: Math.round(options.clientY),
    };
  }

  return {
    x: Math.max(viewportWidth - 48, 20),
    y: Math.max(viewportHeight - 48, 20),
  };
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    /**
     * Trust the attribute the boot script already set.
     *
     * A blocking inline script in index.html and index.mobile.html resolves the
     * theme before the first paint, because anything decided here happens after
     * the browser has already painted and shows as a flash. Re-deriving it
     * would be a second implementation that can disagree with the first; the
     * attribute IS the decision, so this reads it.
     */
    try {
      const booted = document.documentElement.getAttribute('data-theme');
      if (booted === 'light' || booted === 'dark') return booted;
    } catch (_) {}

    // No boot script ran — a test, or an entry point that predates it.
    try {
      return resolveInitialTheme({
        stored: localStorage.getItem('theme'),
        preferenceSet: localStorage.getItem('theme_preference_set') === 'true',
        prefersDark:
          typeof window !== 'undefined' &&
          window.matchMedia?.('(prefers-color-scheme: dark)').matches,
      });
    } catch (_) {
      return 'light';
    }
  });

  /**
   * Follow the device while the user has not chosen for themselves.
   *
   * Someone who picked light on a dark phone meant it, so `shouldFollowSystem`
   * stops this the moment `toggleTheme` records a choice. Without the guard the
   * OS would quietly overrule them at sunset.
   */
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;

    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event) => {
      let preferenceSet = false;
      try {
        preferenceSet = localStorage.getItem('theme_preference_set') === 'true';
      } catch (_) {}
      if (!shouldFollowSystem({ preferenceSet })) return;
      wantedRef.current = event.matches ? 'dark' : 'light';
      setChoice(wantedRef.current);
      setTheme(wantedRef.current);
    };

    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  /**
   * The theme the user has asked for most recently.
   *
   * Not the `theme` state: a switch that is reversing still shows the theme it
   * was heading to until its circle has closed, and a third press must turn it
   * round again rather than read that and ask for the same thing twice. Kept in
   * step with the state whenever the theme changes for any other reason (the
   * device's setting, while the user has not chosen).
   */
  const wantedRef = useRef(theme);

  /**
   * The same, as state, for the toggle's own icon. The page's theme can lag a
   * press (it changes when the circle allows it, and not at all when a second
   * press turns the circle back), but the control must answer every press at
   * once or rapid presses look ignored.
   */
  const [choice, setChoice] = useState(theme);

  useEffect(() => {
    try {
      if (document.documentElement.getAttribute('data-theme') !== theme) {
        document.documentElement.setAttribute('data-theme', theme);
      }
      /*
       * Hand `color-scheme` back to CSS.
       *
       * The boot script sets it inline so the first frame is right, before any
       * stylesheet exists. An inline style beats a rule, so leaving it would
       * pin the browser's own surfaces — form controls, scrollbars, the canvas
       * — to whatever the DEVICE said, and the landing page (which pins itself
       * to light) would render light with dark controls on it. The rules in
       * variables.css follow `data-theme`, which is what everything else obeys.
       */
      document.documentElement.style.colorScheme = '';
      localStorage.setItem('theme', theme);
    } catch (_) {}
  }, [theme]);

  /** When the last press was taken (see toggleTheme). */
  const lastPressRef = useRef(-Infinity);

  const toggleTheme = (options) => {
    /*
     * Presses closer together than this are one press. A tap that registers
     * twice (a bounce, a touch that also fires a click) or a frantic double
     * hit would otherwise turn the circle round within a frame or two, which
     * reads as a flicker rather than a decision. Deliberate rapid presses are
     * well over this apart and are all honoured.
     */
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastPressRef.current < MIN_PRESS_GAP_MS) return;
    lastPressRef.current = now;

    try {
      localStorage.setItem('theme_preference_set', 'true');
    } catch (_) {}
    const next = wantedRef.current === 'light' ? 'dark' : 'light';
    wantedRef.current = next;
    setChoice(next);

    /*
     * Puts a theme on the page, synchronously. The transition driver calls it
     * only at a moment the change cannot be seen (behind a snapshot, or under a
     * closed circle), so the attribute, React's state and storage all move in
     * that one moment.
     */
    const apply = (value) => {
      const root = document.documentElement;
      if (root.getAttribute('data-theme') !== value) root.setAttribute('data-theme', value);
      try {
        localStorage.setItem('theme', value);
      } catch (_) {}
      flushSync(() => setTheme(value));
    };

    // Measured at the moment of the click, from the control that was pressed.
    getThemeTransitionDriver().switchTo(next, { origin: getThemeOrigin(options), apply });
  };

  return (
    <ThemeContext.Provider value={{ theme, choice, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
