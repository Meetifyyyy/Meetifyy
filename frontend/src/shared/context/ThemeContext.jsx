import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';

const ThemeContext = createContext();

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
    try {
      const saved = localStorage.getItem('theme');
      if (saved) return saved;
    } catch (_) {}
    return 'light';
  });

  /**
   * The live theme, for `toggleTheme` to read.
   *
   * Reading the `theme` state variable inside the handler reads whatever it
   * was when that closure was created. Two clicks in quick succession both
   * saw 'light' and both set 'dark', so the second toggle silently did
   * nothing — the deeper half of "fast clicking does not work", underneath
   * the in-flight guard that was dropping the click outright.
   */
  const themeRef = useRef(theme);
  themeRef.current = theme;

  /** The transition currently playing, so a new click can cut it short
   *  instead of being discarded. */
  const activeTransitionRef = useRef(null);

  /**
   * The clip-path animation currently playing.
   *
   * Held so it can be cancelled. Each toggle starts a WAAPI animation with
   * `fill: 'forwards'` on `::view-transition-new(root)`; left alone, those
   * accumulate. A finished one keeps applying its end value — the fully
   * revealed `circle(200vmax)` — and re-applies it to the pseudo-element the
   * *next* transition creates, so every switch after the first appeared
   * already complete and the 800ms reveal was only ever seen once, on the
   * first click of a page load.
   */
  const activeAnimationRef = useRef(null);

  useEffect(() => {
    try {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('theme', theme);
    } catch (_) {}
  }, [theme]);

  const toggleTheme = (options) => {
    /*
     * Rapid clicks are honoured rather than dropped.
     *
     * This used to return early for the full length of the animation, so
     * anything faster than one click per 800ms was thrown away and the button
     * felt dead. Now an in-flight transition is cut short — `skipTransition`
     * settles it immediately, which is exactly what the API exists for — and
     * the new one starts from the state the user just asked for. The reveal
     * itself is unchanged; only its lifetime is interruptible.
     */
    if (activeTransitionRef.current) {
      try {
        activeTransitionRef.current.skipTransition?.();
      } catch (_) { /* already finished */ }
      activeTransitionRef.current = null;
    }
    // Drop the previous reveal's forwards-fill before starting another, or
    // the new snapshot inherits its end state and skips straight to done.
    if (activeAnimationRef.current) {
      try {
        activeAnimationRef.current.cancel();
      } catch (_) { /* already gone */ }
      activeAnimationRef.current = null;
    }

    try {
      localStorage.setItem('theme_preference_set', 'true');
    } catch (_) {}
    // From the ref, never the closure — see themeRef.
    const newTheme = themeRef.current === 'light' ? 'dark' : 'light';
    themeRef.current = newTheme;

    // Measure live source element coordinates immediately at the moment of click
    const origin = getThemeOrigin(options);
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.visualViewport?.height || window.innerHeight;

    /*
     * `::view-transition-new(root)` is a replaced snapshot. Some Chromium
     * configurations resolve a pixel clip-path against that snapshot's raster
     * box, rather than the CSS viewport that `getBoundingClientRect()` uses.
     * Normalize the measured CSS-pixel point to its viewport fraction before
     * handing it to the snapshot. Percentages are then resolved against the
     * snapshot's own reference box, preserving the same visual location at
     * every browser zoom and display scale.
     */
    const transitionOrigin = {
      x: `${(origin.x / viewportWidth) * 100}%`,
      y: `${(origin.y / viewportHeight) * 100}%`,
    };

    /*
     * The radius that exactly covers the screen from this origin: the
     * distance to whichever corner is farthest away.
     *
     * The reveal used to animate to a flat 200vmax, which on a phone is
     * roughly twice the radius actually needed. Combined with a front-loaded
     * easing curve, the circle reached the far corner about 13% of the way
     * through the timeline — so the visible part of a 1200ms reveal lasted
     * around 150ms and the remaining second was spent expanding invisibly
     * past the edges. That is what read as the circle snapping to fill
     * rather than expanding: the last stretch of screen was crossed in a
     * handful of frames.
     *
     * Expressed in vmax rather than pixels for the same reason the origin is
     * a percentage — see the note above about the snapshot's raster box —
     * with a small margin so rounding cannot leave a sliver uncovered.
     */
    const farthestX = Math.max(origin.x, viewportWidth - origin.x);
    const farthestY = Math.max(origin.y, viewportHeight - origin.y);
    const neededRadiusPx = Math.hypot(farthestX, farthestY);
    const vmaxPx = Math.max(viewportWidth, viewportHeight);
    const revealRadius = `${((neededRadiusPx / vmaxPx) * 100 * 1.02).toFixed(2)}vmax`;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!document.startViewTransition || prefersReducedMotion) {
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
      setTheme(newTheme);
      return;
    }

    // Pre-bind origin coordinates to CSS custom properties before transition begins
    // to guarantee frame 0 renders at the exact origin before WAAPI executes
    document.documentElement.style.setProperty('--vt-origin-x', transitionOrigin.x);
    document.documentElement.style.setProperty('--vt-origin-y', transitionOrigin.y);

    document.documentElement.classList.add('theme-transitioning');

    try {
      const transition = document.startViewTransition(() => {
        flushSync(() => {
          document.documentElement.setAttribute('data-theme', newTheme);
          localStorage.setItem('theme', newTheme);
          setTheme(newTheme);
        });
      });

      activeTransitionRef.current = transition;

      transition.ready
        .then(() => {
          const clipPathFrames = [
            `circle(0px at ${transitionOrigin.x} ${transitionOrigin.y})`,
            // Exactly reaches the farthest corner, so the whole duration is
            // spent revealing screen rather than overshooting past it.
            `circle(${revealRadius} at ${transitionOrigin.x} ${transitionOrigin.y})`,
          ];

          const anim = document.documentElement.animate(
            {
              clipPath: clipPathFrames,
            },
            {
              // A gentle standard curve. The previous one was steeply
              // front-loaded, which compounded the overshoot above: most of
              // the radius was covered in the first fraction of the timeline.
              // With the radius now exactly fitted, an even curve is what
              // keeps the edge moving at a readable speed throughout.
              duration: 1200,
              easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
              fill: 'forwards',
              pseudoElement: '::view-transition-new(root)',
            }
          );

          activeAnimationRef.current = anim;

          /*
           * The forwards-fill is deliberately NOT released here.
           *
           * Cancelling on `finished` reverts clip-path to its CSS value —
           * `circle(0px)` — which blanks the new snapshot entirely for the
           * frames between the animation ending and the browser tearing the
           * pseudo-element down. The old snapshot shows through underneath,
           * so the switch ended with a flash of the previous theme.
           *
           * The fill is released at the start of the *next* toggle instead,
           * by which point this pseudo-element no longer exists. That still
           * stops a stale animation contaminating the next reveal, which is
           * what the cancellation was for, without the flash.
           */
          return anim.finished;
        })
        .catch(() => {
          // A skipped transition rejects `ready`; that is the normal path
          // when a fast second click supersedes this one, not an error.
        });

      transition.finished
        .catch(() => {})
        .finally(() => {
          // Only clear if this is still the current transition: a faster
          // click has already replaced it, and its own cleanup owns the
          // origin variables now.
          if (activeTransitionRef.current !== transition) return;
          activeTransitionRef.current = null;
          document.documentElement.classList.remove('theme-transitioning');
          document.documentElement.style.removeProperty('--vt-origin-x');
          document.documentElement.style.removeProperty('--vt-origin-y');
        });
    } catch (err) {
      console.error('startViewTransition error:', err);
      activeTransitionRef.current = null;
      document.documentElement.classList.remove('theme-transitioning');
      document.documentElement.style.removeProperty('--vt-origin-x');
      document.documentElement.style.removeProperty('--vt-origin-y');
      // The DOM update inside startViewTransition may not have run.
      document.documentElement.setAttribute('data-theme', newTheme);
      setTheme(newTheme);
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
