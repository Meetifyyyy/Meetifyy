/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { createBrowserRouter, RouterProvider, Outlet, useParams } from 'react-router-dom';
import { SmartBackTracker } from '@shared/hooks/useSmartNavigation';
import { useSettingsBack } from '../pages/useSettingsBack';

/**
 * The Settings header's Back on a phone, against the real router and the real
 * history tracker.
 *
 * It used to loop: a panel opened other than from its own category left the
 * stack as [home, blocked, settings], and from the Settings root Back popped
 * into the panel, whose Back pushed its parent again, forever. These walk the
 * sequences that looped and press Back until Settings is left, asserting that
 * every press lands on a page not visited since and that Settings is always
 * left in a bounded number of presses.
 */

const TREE = { privacy: ['blocked', 'devices'], messaging: ['notifications'] };
const PARENT = Object.fromEntries(
  Object.entries(TREE).flatMap(([cat, panels]) => panels.map((p) => [p, cat])),
);

let goUp = null;

function SettingsProbe({ isLargeScreen = false }) {
  const { panel } = useParams();
  const activeCategory = panel && TREE[panel] ? panel : null;
  const activePanel = panel && PARENT[panel] ? panel : null;
  ({ goUp } = useSettingsBack({
    activePanel,
    activeCategory,
    parentOf: (p) => PARENT[p] || null,
    isLargeScreen,
  }));
  return null;
}

function mount(entries) {
  // The history the user walked, in order. The first entry is the page the
  // app was opened on; the rest are pushes, exactly as links would make them.
  window.history.replaceState(null, '', entries[0]);
  const router = createBrowserRouter([
    {
      element: (<><SmartBackTracker /><Outlet /></>),
      children: [
        { path: '/home', element: null },
        { path: '/settings', element: <SettingsProbe /> },
        { path: '/settings/:panel', element: <SettingsProbe /> },
      ],
    },
  ]);
  render(<RouterProvider router={router} />);
  return router;
}

const settle = () => new Promise((r) => setTimeout(r, 420)); // past goBack's 350ms double-tap guard

async function walk(router, entries) {
  for (const path of entries.slice(1)) {
    await act(async () => { await router.navigate(path); });
    await act(settle);
  }
}

/** Presses Back until Settings is left, returning every page it landed on. */
async function pressBackUntilOut(router, limit = 8) {
  const landed = [];
  for (let i = 0; i < limit; i++) {
    const before = router.state.location.pathname;
    if (!before.startsWith('/settings')) break;
    await act(async () => { goUp(); });
    await act(settle);
    landed.push(router.state.location.pathname);
  }
  return landed;
}

describe('Settings header Back on a phone', () => {
  beforeEach(() => { sessionStorage.clear(); });
  afterEach(() => { cleanup(); goUp = null; });

  it('returns to the page actually visited before, not to a parent it never saw', async () => {
    const router = mount(['/home']);
    await walk(router, ['/home', '/settings', '/settings/messaging', '/settings/blocked']);

    const landed = await pressBackUntilOut(router);

    expect(landed).toEqual(['/settings/messaging', '/settings', '/home']);
  });

  it('cannot loop when a panel was opened straight from outside Settings', async () => {
    // The looping sequence: home → a panel by link, with no category behind it.
    const router = mount(['/home']);
    await walk(router, ['/home', '/settings/blocked']);

    const landed = await pressBackUntilOut(router);

    expect(landed.at(-1)).toBe('/home');
    expect(new Set(landed).size).toBe(landed.length); // no page landed on twice
  });

  it('leaves Settings from a deep link without growing the stack', async () => {
    // Opened directly on a panel: nothing of ours behind, so it walks up the
    // tree by replacing, and each level is seen once.
    const router = mount(['/settings/blocked']);
    const depth = () => window.history.state?.idx;
    const startDepth = depth();

    const landed = await pressBackUntilOut(router);

    expect(landed).toEqual(['/settings/privacy', '/settings', '/home']);
    expect(depth()).toBe(startDepth);
  });

  it('keeps pressing safe: repeated presses always make progress and stop', async () => {
    const router = mount(['/home']);
    await walk(router, [
      '/home', '/settings', '/settings/privacy', '/settings/devices',
      '/settings/messaging', '/settings/notifications', '/settings/blocked',
    ]);

    const landed = await pressBackUntilOut(router, 12);

    expect(landed.at(-1)).toBe('/home');
    expect(landed.length).toBeLessThanOrEqual(7);
    expect(new Set(landed).size).toBe(landed.length);
  }, 20000); // every step waits out goBack's 350ms double-tap guard
});
