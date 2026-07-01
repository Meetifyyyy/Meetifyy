import { createContext, useContext, useState, useEffect, useCallback } from 'react';

/**
 * ThemeContext
 *
 * theme: 'light' | 'dark' | 'system'
 *
 * The resolved (actual) mode that gets applied to <html data-theme="..."> is
 * always either 'light' or 'dark'. 'system' follows the OS preference.
 */
const ThemeContext = createContext(null);

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme) {
  if (theme === 'system') return getSystemTheme();
  return theme;
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    return localStorage.getItem('meetify_theme') || 'system';
  });

  // Apply resolved theme to <html> whenever theme changes
  useEffect(() => {
    const resolved = resolveTheme(theme);
    document.documentElement.setAttribute('data-theme', resolved);
    localStorage.setItem('meetify_theme', theme);
  }, [theme]);

  // When theme === 'system', listen for OS preference changes
  useEffect(() => {
    if (theme !== 'system') return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => {
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback((newTheme) => {
    setThemeState(newTheme);
  }, []);

  const resolvedTheme = resolveTheme(theme);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
