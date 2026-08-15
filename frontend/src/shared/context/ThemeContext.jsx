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
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 844;

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
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    return 'light';
  });

  const isTransitioningRef = useRef(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = (options) => {
    if (isTransitioningRef.current) {
      return;
    }

    localStorage.setItem('theme_preference_set', 'true');
    const newTheme = theme === 'light' ? 'dark' : 'light';

    // Measure live source element coordinates immediately at the moment of click
    const origin = getThemeOrigin(options);
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

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
    isTransitioningRef.current = true;

    try {
      const transition = document.startViewTransition(() => {
        flushSync(() => {
          document.documentElement.setAttribute('data-theme', newTheme);
          localStorage.setItem('theme', newTheme);
          setTheme(newTheme);
        });
      });

      transition.ready
        .then(() => {
          const clipPathFrames = [
            `circle(0px at ${transitionOrigin.x} ${transitionOrigin.y})`,
            // Deliberately exceeds the farthest viewport corner without relying
            // on the snapshot's pixel dimensions for radius calculation.
            `circle(200vmax at ${transitionOrigin.x} ${transitionOrigin.y})`,
          ];

          const anim = document.documentElement.animate(
            {
              clipPath: clipPathFrames,
            },
            {
              duration: 800,
              easing: 'cubic-bezier(0.42, 0, 0.58, 1)',
              fill: 'forwards',
              pseudoElement: '::view-transition-new(root)',
            }
          );

          return anim.finished;
        })
        .catch((err) => {
          console.error('transition.ready error:', err);
        });

      transition.finished
        .catch(() => {})
        .finally(() => {
          document.documentElement.classList.remove('theme-transitioning');
          document.documentElement.style.removeProperty('--vt-origin-x');
          document.documentElement.style.removeProperty('--vt-origin-y');
          isTransitioningRef.current = false;
        });
    } catch (err) {
      console.error('startViewTransition error:', err);
      document.documentElement.classList.remove('theme-transitioning');
      document.documentElement.style.removeProperty('--vt-origin-x');
      document.documentElement.style.removeProperty('--vt-origin-y');
      isTransitioningRef.current = false;
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
