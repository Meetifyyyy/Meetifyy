/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../ThemeContext';
import { setThemeTransitionDriver } from '@shared/theme/themeTransition';

let ctx;
const Probe = () => { ctx = useTheme(); return null; };

let calls;
let now;

beforeEach(() => {
  calls = [];
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  document.documentElement.setAttribute('data-theme', 'light');
  // Records what was asked for and applies at once.
  setThemeTransitionDriver({ switchTo: (theme, { apply }) => { calls.push(theme); apply(theme); } });
  render(<ThemeProvider><Probe /></ThemeProvider>);
});

afterEach(() => {
  vi.restoreAllMocks();
  setThemeTransitionDriver(null);
  document.documentElement.removeAttribute('data-theme');
});

describe('toggleTheme', () => {
  it('treats presses under 50ms apart as one', () => {
    act(() => ctx.toggleTheme());
    now += 30;
    act(() => ctx.toggleTheme());
    expect(calls).toEqual(['dark']);
    expect(ctx.choice).toBe('dark');
  });

  it('honours presses 50ms or more apart, alternating', () => {
    act(() => ctx.toggleTheme());
    now += 50;
    act(() => ctx.toggleTheme());
    now += 120;
    act(() => ctx.toggleTheme());
    expect(calls).toEqual(['dark', 'light', 'dark']);
    expect(ctx.choice).toBe('dark');
  });
});
