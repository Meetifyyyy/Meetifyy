/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { createBrowserRouter, RouterProvider, Outlet, useParams, useSearchParams } from 'react-router-dom';
import { SmartBackTracker } from '@shared/hooks/useSmartNavigation';
import {
  useSettingsBack,
  settingsParentPath,
  resetSettingsTrail,
} from '../pages/useSettingsBack';

/**
 * Settings Back returns to where the user came from inside Settings, on both
 * layouts, and otherwise to the logical parent: a Help sub-view's hub, a
 * panel's category, or the root. Against the real router and history tracker.
 */

const TREE = { privacy: ['blocked', 'devices'] };
const LEAVES = ['help', 'visibility'];
const PARENT = Object.fromEntries(
  Object.entries(TREE).flatMap(([cat, panels]) => panels.map((p) => [p, cat])),
);
const parentOf = (p) => PARENT[p] || null;

let goUp = null;

function SettingsProbe({ isLargeScreen }) {
  const { panel } = useParams();
  const [params] = useSearchParams();
  const activeCategory = panel && TREE[panel] ? panel : null;
  const activePanel = panel && (PARENT[panel] || LEAVES.includes(panel)) ? panel : null;
  const subView = activePanel === 'help' ? params.get('view') : null;
  ({ goUp } = useSettingsBack({ activePanel, activeCategory, subView, parentOf, isLargeScreen }));
  return null;
}

function mount(entries, { isLargeScreen }) {
  window.history.replaceState(null, '', entries[0]);
  const router = createBrowserRouter([
    {
      element: (<><SmartBackTracker /><Outlet /></>),
      children: [
        { path: '/home', element: null },
        { path: '/settings', element: <SettingsProbe isLargeScreen={isLargeScreen} /> },
        { path: '/settings/:panel', element: <SettingsProbe isLargeScreen={isLargeScreen} /> },
      ],
    },
  ]);
  render(<RouterProvider router={router} />);
  return router;
}

const settle = () => new Promise((r) => setTimeout(r, 420)); // past goBack's 350ms double-tap guard
const here = (router) => `${router.state.location.pathname}${router.state.location.search}`;

async function walk(router, entries) {
  for (const path of entries.slice(1)) {
    await act(async () => { await router.navigate(path); });
    await act(settle);
  }
}

async function pressBackUntilOut(router, limit = 8) {
  const landed = [];
  for (let i = 0; i < limit; i++) {
    if (!router.state.location.pathname.startsWith('/settings')) break;
    await act(async () => { goUp(); });
    await act(settle);
    landed.push(here(router));
  }
  return landed;
}

describe('settingsParentPath', () => {
  it('puts a Help sub-view under the hub, a leaf under the root, a panel under its category', () => {
    expect(settingsParentPath({ activePanel: 'help', activeCategory: null, subView: 'safety', parentOf })).toBe('/settings/help');
    expect(settingsParentPath({ activePanel: 'help', activeCategory: null, parentOf })).toBe('/settings');
    expect(settingsParentPath({ activePanel: 'visibility', activeCategory: null, parentOf })).toBe('/settings');
    expect(settingsParentPath({ activePanel: 'blocked', activeCategory: null, parentOf })).toBe('/settings/privacy');
    expect(settingsParentPath({ activePanel: null, activeCategory: 'privacy', parentOf })).toBe('/settings');
    expect(settingsParentPath({ activePanel: null, activeCategory: null, parentOf })).toBeNull();
  });
});

for (const isLargeScreen of [false, true]) {
  const layout = isLargeScreen ? 'desktop split' : 'phone';

  describe(`Settings Back on the ${layout}`, () => {
    beforeEach(() => { sessionStorage.clear(); resetSettingsTrail(); });
    afterEach(() => { cleanup(); goUp = null; });

    it('steps out of the Safety centre to Help, not to the root', async () => {
      const router = mount(['/home'], { isLargeScreen });
      await walk(router, ['/home', '/settings', '/settings/help', '/settings/help?view=safety']);

      const landed = await pressBackUntilOut(router);

      expect(landed).toEqual(['/settings/help', '/settings', '/home']);
    });

    it('returns to Help after following a FAQ link to another setting', async () => {
      const router = mount(['/home'], { isLargeScreen });
      await walk(router, ['/home', '/settings', '/settings/help', '/settings/visibility']);

      await act(async () => { goUp(); });
      await act(settle);

      expect(here(router)).toBe('/settings/help');
    });

    it('returns to the panel it was opened from in another category', async () => {
      const router = mount(['/home'], { isLargeScreen });
      await walk(router, ['/home', '/settings', '/settings/visibility', '/settings/blocked']);

      await act(async () => { goUp(); });
      await act(settle);

      expect(here(router)).toBe('/settings/visibility');
    });

    it('goes up to Help from a sub-view opened by a deep link, without growing the stack', async () => {
      const router = mount(['/settings/help?view=requests'], { isLargeScreen });
      const startDepth = window.history.state?.idx;

      const landed = await pressBackUntilOut(router);

      expect(landed).toEqual(['/settings/help', '/settings', '/home']);
      expect(window.history.state?.idx).toBe(startDepth);
    });
  });
}

describe('Settings Back on the desktop split, arriving from outside Settings', () => {
  beforeEach(() => { sessionStorage.clear(); resetSettingsTrail(); });
  afterEach(() => { cleanup(); goUp = null; });

  it('moves up the tree, because the tree is on screen beside the panel', async () => {
    const router = mount(['/home'], { isLargeScreen: true });
    await walk(router, ['/home', '/settings/blocked']);

    const landed = await pressBackUntilOut(router);

    expect(landed[0]).toBe('/settings/privacy');
    expect(landed.at(-1)).toBe('/home');
    expect(new Set(landed).size).toBe(landed.length);
  });
});
