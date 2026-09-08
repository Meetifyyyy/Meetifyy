/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Where the keyboard hook is mounted.
 *
 * `.bottomNav` translates itself down by `--kb-layout-shift` so it stays on the
 * physical bottom edge when the keyboard opens. On Android the keyboard shrinks
 * the LAYOUT viewport, so `bottom: 0` starts meaning "the top of the keyboard"
 * — without that translate the nav is lifted up and parked on top of it.
 *
 * The variable is published by `useKeyboardInset`, which was called from
 * MessagesRoute. So it existed only while /messages was open, and everywhere
 * else the transform fell back to `0px`. Measured at 375x812 with a 400px
 * shrink: the nav's bottom edge sat 400px above the physical bottom, directly
 * over the comment composer on the post view.
 *
 * It has to be mounted by whatever renders the nav, so these pin the wiring
 * rather than the pixels — jsdom has no visualViewport and no layout, and the
 * pixel behaviour was measured in a real browser instead.
 */
const read = (p) => readFileSync(resolve(p), 'utf8');

describe('keyboard inset wiring', () => {
  const layout = read('src/layout/DashboardLayoutWrapper.jsx');

  it('is mounted by the layout that renders the BottomNav', () => {
    expect(layout).toMatch(/import \{ useKeyboardInset \}/);
    expect(layout).toMatch(/^\s*useKeyboardInset\(\);/m);
    // Same file must own the nav, or the variable and its consumer can drift
    // onto different mount lifetimes again.
    expect(layout).toMatch(/<BottomNav/);
  });

  it('is mounted exactly once across the app', () => {
    // The hook zeroes the variables in its cleanup, so a second copy unmounting
    // would blank them underneath the one still running.
    const files = [
      'src/layout/DashboardLayoutWrapper.jsx',
      'src/features/messages/pages/MessagesRoute.jsx',
    ];
    const calls = files.reduce(
      (n, f) => n + (read(f).match(/^\s*useKeyboardInset\(\);/gm) || []).length,
      0,
    );
    expect(calls).toBe(1);
  });

  it('keeps the nav translating by the published shift', () => {
    const css = read('src/layout/BottomNav.module.css');
    expect(css).toMatch(/transform:\s*translateY\(var\(--kb-layout-shift,\s*0px\)\)/);
  });
});
