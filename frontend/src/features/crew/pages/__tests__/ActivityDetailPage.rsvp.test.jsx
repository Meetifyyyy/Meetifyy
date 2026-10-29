/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * "I'm in" / "I'm out" and the Attendees card's "Going" / "Not going" split.
 */
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const { query, api, me, goBack } = vi.hoisted(() => ({
  query: { value: {} },
  api: {
    join: vi.fn(() => Promise.resolve({ success: true })),
    decline: vi.fn(() => Promise.resolve({ success: true, lostAccess: false })),
  },
  me: { value: { id: 'me', username: 'me', displayName: 'Me' } },
  goBack: vi.fn(),
}));

vi.mock('@shared/api/apiClient', () => ({
  activitiesApi: {
    join: api.join,
    decline: api.decline,
    leave: vi.fn(),
    getAttendees: vi.fn(() => Promise.resolve({ attendees: [], nextCursor: null })),
    inviteFriends: vi.fn(),
    cancelCrewActivity: vi.fn(),
  },
  getMediaUrl: (u) => u,
  deriveThumbnailKey: () => null,
}));
vi.mock('@shared/hooks/useCrew', () => ({
  useActivityById: () => query.value,
  useActivityAttendees: () => ({ attendees: [], hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn() }),
}));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: me.value }) }));
vi.mock('@shared/hooks/useSystemBars', () => ({ useSystemBars: () => {} }));
vi.mock('@shared/hooks/useAmbientTint', () => ({ useAmbientTint: () => {} }));
vi.mock('@shared/hooks/useSmartBack', () => ({ useSmartBack: () => goBack }));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));
vi.mock('@shared/lib/idb', () => ({ idbDelete: vi.fn() }));
vi.mock('../../components/ActivityDiscussion', () => ({ ActivityDiscussion: () => null }));
vi.mock('../../components/modals/ShareActivityModal', () => ({ default: () => null }));
vi.mock('@shared/components/modals/InviteFriendsModal', () => ({ default: () => null }));

const { default: ActivityDetailPage } = await import('../ActivityDetailPage');

const person = (id) => ({ id, username: id, displayName: `Person ${id}` });
const activity = (over = {}) => ({
  id: 'a1',
  title: 'Sunrise hike',
  location: 'North gate',
  creatorId: 'host',
  creator: person('host'),
  maxMembers: 10,
  memberCount: 2,
  members: [
    { userId: 'host', status: 'MEMBER', user: person('host') },
    { userId: 'ava', status: 'MEMBER', user: person('ava') },
  ],
  notGoing: [{ userId: 'ben', status: 'DECLINED', user: person('ben') }],
  notGoingCount: 1,
  isJoined: false,
  isNotGoing: false,
  myStatus: null,
  canJoin: true,
  startDate: new Date(Date.now() + 86_400_000).toISOString(),
  ...over,
});
const idle = { isLoading: false, isError: false, error: null, refetch: vi.fn(), isAccessDenied: false, accessDeniedCode: null, accessDeniedMessage: null };

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/crew/a1']}>
        <Routes>
          <Route path="/crew/:id" element={<ActivityDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  onlineManager.setOnline(true);
  me.value = { id: 'me', username: 'me', displayName: 'Me' };
  api.join.mockClear();
  api.decline.mockClear();
  goBack.mockClear();
});
afterEach(() => {
  cleanup();
});

describe('Attendees card', () => {
  it('splits people into Going (host first) and Not going', () => {
    query.value = { ...idle, data: activity() };
    renderPage();

    const going = screen.getAllByRole('region', { name: 'Going (2)' })[0];
    const names = within(going).getAllByText(/^Person /).map((n) => n.textContent);
    expect(names).toEqual(['Person host', 'Person ava']);
    expect(within(going).getByText('@host (Host)')).toBeTruthy();

    const notGoing = screen.getAllByRole('region', { name: 'Not going (1)' })[0];
    expect(within(notGoing).getByText('Person ben')).toBeTruthy();
    expect(within(notGoing).queryByText('Person ava')).toBeNull();
  });

  it('still renders against a server that sends no "Not going" fields', () => {
    const { notGoing: _a, notGoingCount: _b, ...older } = activity();
    query.value = { ...idle, data: older };
    renderPage();
    expect(screen.getAllByRole('region', { name: 'Going (2)' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('region', { name: 'Not going (0)' }).length).toBeGreaterThan(0);
  });
});

describe("I'm in / I'm out", () => {
  it('offers both to a viewer who has not answered', () => {
    query.value = { ...idle, data: activity() };
    renderPage();
    expect(screen.getByRole('button', { name: /I'm in/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: /I'm out/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('shows a member as in, and I\'m out sends the decline', async () => {
    query.value = {
      ...idle,
      data: activity({ isJoined: true, myStatus: 'MEMBER', members: [...activity().members, { userId: 'me', status: 'MEMBER', user: me.value }], memberCount: 3 }),
    };
    renderPage();
    expect(screen.getByRole('button', { name: /I'm in/ }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /I'm out/ }));
    await waitFor(() => expect(api.decline).toHaveBeenCalledWith('a1'));
    expect(api.join).not.toHaveBeenCalled();
  });

  it('shows a decliner as out, and I\'m in goes back through join', async () => {
    query.value = { ...idle, data: activity({ isNotGoing: true, myStatus: 'DECLINED' }) };
    renderPage();
    expect(screen.getByRole('button', { name: /I'm out/ }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /I'm in/ }));
    await waitFor(() => expect(api.join).toHaveBeenCalledWith('a1'));
  });

  it('disables both while the answer is in flight', async () => {
    let finish;
    api.decline.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    query.value = { ...idle, data: activity() };
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /I'm out/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /I'm in/ }).disabled).toBe(true));
    expect(screen.getByRole('button', { name: /I'm out/ }).disabled).toBe(true);
    finish({ success: true, lostAccess: false });
    await waitFor(() => expect(screen.getByRole('button', { name: /I'm out/ }).disabled).toBe(false));
  });

  it('is not shown to the host', () => {
    me.value = person('host');
    query.value = { ...idle, data: activity() };
    renderPage();
    expect(screen.queryByRole('button', { name: /I'm in/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /I'm out/ })).toBeNull();
  });

  it('asks first when saying no would cost access to a private activity', async () => {
    query.value = { ...idle, data: activity({ visibility: 'PRIVATE', isInvited: true, notGoingRemovesAccess: true }) };
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /I'm out/ }));
    expect(api.decline).not.toHaveBeenCalled();
    expect(screen.getByText('Not going?')).toBeTruthy();
  });
});
