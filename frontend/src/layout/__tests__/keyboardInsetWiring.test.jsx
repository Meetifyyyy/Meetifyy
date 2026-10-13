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
 * It has to live at least as long as whatever renders the nav. It is mounted
 * once at the app root (App.jsx), which encloses every layout - including the
 * sign-in and onboarding screens, which need the keyboard state too. These pin the wiring
 * rather than the pixels — jsdom has no visualViewport and no layout, and the
 * pixel behaviour was measured in a real browser instead.
 */
const read = (p) => readFileSync(resolve(p), 'utf8');

describe('keyboard inset wiring', () => {
  const app = read('src/App.jsx');

  it('is mounted at the app root, which encloses the layout with the BottomNav', () => {
    expect(app).toMatch(/import \{ useKeyboardInset \}/);
    expect(app).toMatch(/^\s*useKeyboardInset\(\);/m);
    // The root renders the router, and with it DashboardLayoutWrapper (the nav).
    expect(app).toMatch(/<RouterProvider/);
    expect(read('src/layout/DashboardLayoutWrapper.jsx')).toMatch(/<BottomNav/);
  });

  it('is mounted exactly once across the app', () => {
    // The hook zeroes the variables in its cleanup, so a second copy unmounting
    // would blank them underneath the one still running.
    const files = [
      'src/App.jsx',
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
    // The website translates by the published shift; nothing overrides it.
    expect(css).toMatch(/transform:\s*translateY\(var\(--kb-layout-shift,\s*0px\)\)/);
    expect(css).not.toMatch(/--nav-kb-shift/);
  });

  it('lets the keyboard overlay the nav in the installed app instead of pinning it', () => {
    const css = read('src/mobile/mobile.css');
    // The Android WebView no longer resizes for the keyboard, so nothing has to
    // hold the nav or the Instant Match button against a shrinking viewport.
    expect(css).not.toMatch(/--kb-viewport-shrink/);
    expect(css).not.toMatch(/--nav-kb-shift/);
    // The contract every keyboard consumer relies on.
    expect(css).toMatch(/--kb-easing:\s*cubic-bezier\(0\.2,\s*0,\s*0,\s*1\)/);
    expect(css).toMatch(/--kb-duration:\s*0ms/);
    expect(css).toMatch(/scroll-padding-bottom:\s*var\(--kb-inset,\s*0px\)/);
  });
});
