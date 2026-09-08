/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The right panel is `display: none` below 1100px — but it was still mounted,
 * and its children fetch. Recent Activity pulls the notification feed; Online
 * Friends, Upcoming Events and the people list each run a query of their own.
 * Every phone opening /home or /search made four requests for a panel it could
 * not see.
 *
 * Hiding in CSS and mounting in JS is the kind of disagreement nothing reports:
 * the page looks right and the network tab is the only place it shows.
 */
vi.mock('@shared/hooks/useNotifications', () => ({
  useNotifications: () => ({ notifications: [], isLoading: false }),
  useUnreadNotificationCount: () => 0,
}));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'u1' } }) }));
vi.mock('@shared/hooks/useUsersMap', () => ({ useUsersMap: () => ({}) }));
vi.mock('@shared/hooks/useCrew', () => ({ useCrewActivities: () => [] }));
vi.mock('@shared/api/apiClient', () => ({
  usersApi: {}, activitiesApi: {}, getMediaUrl: (x) => x,
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [], isLoading: false }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));

/** Drives matchMedia so the component sees a given viewport width. */
function setViewport({ narrow, available = true }) {
  if (!available) {
    delete window.matchMedia;
    return;
  }
  window.matchMedia = (query) => ({
    matches: query === '(max-width: 1100px)' ? narrow : !narrow,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
}

const { default: RightPanel } = await import('@layout/RightPanel');

const CHILD = <div data-testid="panel-child">Recent Activity</div>;

describe('RightPanel', () => {
  afterEach(() => { cleanup(); setViewport({ narrow: false }); });

  it('renders nothing at the width the stylesheet hides it', () => {
    setViewport({ narrow: true });
    const { queryByTestId, container } = render(<RightPanel>{CHILD}</RightPanel>);
    // Not merely hidden — absent, so the children never mount and never fetch.
    expect(queryByTestId('panel-child')).toBeNull();
    expect(container.querySelector('aside')).toBeNull();
  });

  it('renders normally above that width', () => {
    setViewport({ narrow: false });
    const { queryByTestId, container } = render(<RightPanel>{CHILD}</RightPanel>);
    expect(queryByTestId('panel-child')).not.toBeNull();
    expect(container.querySelector('aside')).not.toBeNull();
  });

  it('renders when matchMedia cannot be consulted', () => {
    // The gate may only ever remove work the CSS was already hiding. Unknown
    // must mean "show", never "hide".
    setViewport({ available: false });
    const { queryByTestId } = render(<RightPanel>{CHILD}</RightPanel>);
    expect(queryByTestId('panel-child')).not.toBeNull();
    window.matchMedia = undefined;
  });

  it('gates on exactly the breakpoint the stylesheet uses', () => {
    // A gate on a nearby breakpoint leaves a band of widths where JS removed
    // what CSS would have shown, and the panel silently disappears there.
    const css = readFileSync(resolve('src/layout/RightPanel.module.css'), 'utf8');
    const jsx = readFileSync(resolve('src/layout/RightPanel.jsx'), 'utf8');

    const cssBreakpoint = css.match(/@media\s*\(([^)]*max-width:\s*\d+px)\)\s*\{\s*\.rightPanel\s*\{\s*display:\s*none/);
    expect(cssBreakpoint).not.toBeNull();
    expect(jsx).toContain(`useMediaQuery('(${cssBreakpoint[1].trim()})')`);
  });
});
