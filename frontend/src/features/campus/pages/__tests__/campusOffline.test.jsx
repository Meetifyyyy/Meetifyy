/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Campus opened with no network: what the device holds is shown; when it holds
 * none of the page's lists the whole page is one offline state, centred in the
 * visible screen (the OfflineScreen wrapper), not a hub of "nothing yet"
 * sections and not an offline message stuck at the top.
 */
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const h = vi.hoisted(() => ({
  affiliation: { value: {} },
  users: { value: [] },
  communities: { value: [] },
  events: { value: [] },
  activities: { value: [] },
}));

vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { id: 'me', username: 'me' }, collegeName: 'GLA University' }),
}));
vi.mock('@shared/hooks/useCampusAffiliation', () => ({ useCampusAffiliation: () => h.affiliation.value }));
vi.mock('@shared/hooks/useProfile', () => ({
  useCampusUsers: () => ({ campusUsers: h.users.value, isLoading: false }),
}));
vi.mock('@shared/hooks/useCommunities', () => ({
  useCampusCommunities: () => ({ campusCommunities: h.communities.value, isLoading: false }),
}));
vi.mock('@shared/hooks/useCampusEvents', () => ({
  useCampusEvents: () => ({
    events: h.events.value, isLoading: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(),
  }),
  useDeleteCampusEvent: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@shared/hooks/useCrew', () => ({
  useActivities: () => ({ activities: h.activities.value, isLoading: false }),
}));
vi.mock('@shared/utils/mapActivity', () => ({ mapActivity: (a) => a }));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));
vi.mock('@shared/components/avatar/Avatar', () => ({ default: () => <span /> }));
vi.mock('@shared/components/badges/CollegeRepresentativeBadge', () => ({ CollegeRepresentativeBadge: () => null }));
vi.mock('@features/campus-events/components/CampusEventSection', () => ({ default: () => <div data-testid="events" /> }));
vi.mock('@features/crew/components/cards/CrewCard', () => ({ default: ({ activity }) => <div>{activity.title}</div> }));
vi.mock('@features/crew/components/cards/CrewCardSkeleton', () => ({ default: () => null }));
vi.mock('@features/communities/components/directory/CommunityRow', () => ({ default: ({ community }) => <div>{community.name}</div> }));
vi.mock('../../components/affiliation/CampusJoinFlow', () => ({ default: () => <div data-testid="join-flow" /> }));

const { default: CampusPage } = await import('../CampusPage');

const ACTIVE = { isActive: true, isLoading: false, affiliation: { collegeName: 'GLA University' }, pending: null, isPendingLoading: false };
let onLine;
const renderPage = () => render(<MemoryRouter><CampusPage /></MemoryRouter>);

beforeEach(() => {
  onLine = false;
  vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => onLine);
  h.affiliation.value = ACTIVE;
  h.users.value = [];
  h.communities.value = [];
  h.events.value = [];
  h.activities.value = [];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Campus offline', () => {
  it('with none of its lists on the device: one centred offline state, no empty sections', () => {
    const { container } = renderPage();
    const screenWrap = container.querySelector('[data-offline-screen]');
    expect(screenWrap).not.toBeNull();
    // The only thing in the page, so centring the wrapper centres the state.
    expect(container.querySelector('main').children).toHaveLength(1);
    expect(screenWrap.textContent).toContain("You're offline");
    expect(screen.queryByText('No suggestions available.')).toBeNull();
    expect(screen.queryByText('campus events')).toBeNull();
    expect(screen.queryByText(/saved|stored|on this device/i)).toBeNull();
  });

  it('with saved communities: shows the page from them, no offline screen', () => {
    h.communities.value = [{ id: 'k1', name: 'Chess Club' }];
    const { container } = renderPage();
    expect(container.querySelector('[data-offline-screen]')).toBeNull();
    expect(screen.getByText('Chess Club')).toBeTruthy();
    expect(screen.getByText('campus events')).toBeTruthy();
  });

  it('with only saved activities: still the page', () => {
    h.activities.value = [{ id: 'a1', title: 'Sunrise hike' }];
    const { container } = renderPage();
    expect(container.querySelector('[data-offline-screen]')).toBeNull();
    expect(screen.getByText('Sunrise hike')).toBeTruthy();
  });

  it('while the college is still being confirmed offline: the same centred offline state', () => {
    h.affiliation.value = { ...ACTIVE, isActive: false, isLoading: true };
    const { container } = renderPage();
    expect(container.querySelector('[data-offline-screen]')).not.toBeNull();
  });

  it('online and empty it is the ordinary page, not the offline state', () => {
    onLine = true;
    const { container } = renderPage();
    expect(container.querySelector('[data-offline-screen]')).toBeNull();
    expect(screen.getByText('campus events')).toBeTruthy();
  });
});
