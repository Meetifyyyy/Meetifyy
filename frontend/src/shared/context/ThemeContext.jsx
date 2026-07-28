import { createContext, useContext, useState, useEffect, useRef } from 'react';

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
  });

  const isTransitioningRef = useRef(false);

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
    if (isTransitioningRef.current) return;

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

    isTransitioningRef.current = true;
    document.documentElement.classList.add('theme-transitioning');

    try {
      const transition = document.startViewTransition(() => {
        document.documentElement.setAttribute('data-theme', newTheme);
        setTheme(newTheme);
      });

      transition.ready
        .then(() => {
          const clipPathFrames = newTheme === 'dark'
            ? ['inset(0 0 100% 0)', 'inset(0 0 0% 0)']
            : ['inset(100% 0 0 0)', 'inset(0% 0 0 0)'];

          document.documentElement.animate(
            {
              clipPath: clipPathFrames,
            },
            {
              duration: 600,
              easing: 'cubic-bezier(0.25, 1, 0.35, 1)',
              fill: 'forwards',
              pseudoElement: '::view-transition-new(root)',
            }
          );
        })
        .catch(() => {});

      transition.finished
        .catch(() => {})
        .finally(() => {
          document.documentElement.classList.remove('theme-transitioning');
          isTransitioningRef.current = false;
        });
    } catch (err) {
      document.documentElement.classList.remove('theme-transitioning');
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

