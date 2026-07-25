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

  const toggleTheme = () => {
    localStorage.setItem('theme_preference_set', 'true');
    const newTheme = theme === 'light' ? 'dark' : 'light';

    if (
      !document.startViewTransition ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      document.documentElement.setAttribute('data-theme', newTheme);
      setTheme(newTheme);
      return;
    }

    document.documentElement.classList.add('theme-transitioning');

    const transition = document.startViewTransition(() => {
      flushSync(() => {
        document.documentElement.setAttribute('data-theme', newTheme);
        setTheme(newTheme);
      });
    });

    transition.ready.then(() => {
      const clipPathFrames = newTheme === 'dark'
        ? ['inset(0 0 100% 0)', 'inset(0 0 0% 0)']
        : ['inset(100% 0 0 0)', 'inset(0% 0 0 0)'];

      document.documentElement.animate(
        {
          clipPath: clipPathFrames,
        },
        {
          duration: 1200,
          easing: 'cubic-bezier(0.25, 1, 0.35, 1)',
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
