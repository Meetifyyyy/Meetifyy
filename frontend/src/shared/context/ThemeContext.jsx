import { createContext, useContext, useState, useEffect } from 'react';
import { flushSync } from 'react-dom';

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handle = (e) => {
      if (!localStorage.getItem('theme_preference_set')) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    };
    mq.addEventListener ? mq.addEventListener('change', handle) : mq.addListener(handle);
    return () =>
      mq.removeEventListener
        ? mq.removeEventListener('change', handle)
        : mq.removeListener(handle);
  }, []);

  const toggleTheme = (coords) => {
    localStorage.setItem('theme_preference_set', 'true');
    const newTheme = theme === 'light' ? 'dark' : 'light';

    const x = typeof coords?.clientX === 'number' ? coords.clientX : window.innerWidth / 2;
    const y = typeof coords?.clientY === 'number' ? coords.clientY : window.innerHeight / 2;

    if (
      !document.startViewTransition ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      document.documentElement.setAttribute('data-theme', newTheme);
      setTheme(newTheme);
      return;
    }

    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    // Set CSS custom properties on documentElement BEFORE starting the view transition
    // so frame 0 of ::view-transition-new(root) is clipped at (x, y) immediately.
    document.documentElement.style.setProperty('--vt-x', `${x}px`);
    document.documentElement.style.setProperty('--vt-y', `${y}px`);
    // Force layout & style recalculation so Chromium applies --vt-x/y before capturing snapshot
    void document.documentElement.offsetWidth;

    document.documentElement.classList.add('theme-transitioning');

    const transition = document.startViewTransition(() => {
      flushSync(() => {
        document.documentElement.setAttribute('data-theme', newTheme);
        setTheme(newTheme);
      });
    });

    transition.ready.then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${endRadius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 650,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
          fill: 'forwards',
          pseudoElement: '::view-transition-new(root)',
        }
      );
    });

    transition.finished.finally(() => {
      document.documentElement.classList.remove('theme-transitioning');
    });
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
