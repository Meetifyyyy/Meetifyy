/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * Who is offered the discussion composer. The page decides from the viewer's
 * role and the activity's lifecycle; the panel itself is stubbed here.
 */
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const { query, me } = vi.hoisted(() => ({
  query: { value: {} },
  me: { value: { id: 'me', username: 'me', displayName: 'Me' } },
}));

vi.mock('@shared/api/apiClient', () => ({
  activitiesApi: {
    join: vi.fn(),
    decline: vi.fn(),
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
vi.mock('@shared/hooks/useSmartBack', () => ({ useSmartBack: () => vi.fn() }));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));
vi.mock('@shared/lib/idb', () => ({ idbDelete: vi.fn() }));
vi.mock('../../components/ActivityDiscussion', () => ({
  ActivityDiscussion: ({ canPost, closedNote }) => (
    <div data-testid="discussion" data-can-post={String(canPost)}>{closedNote}</div>
  ),
}));
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
  memberCount: 1,
  members: [{ userId: 'host', status: 'MEMBER', user: person('host') }],
  notGoing: [],
  notGoingCount: 0,
  isJoined: false,
  isNotGoing: false,
  myStatus: null,
  canJoin: true,
  startDate: new Date(Date.now() + 86_400_000).toISOString(),
  ...over,
});
const idle = { isLoading: false, isError: false, error: null, refetch: vi.fn(), isAccessDenied: false, accessDeniedCode: null, accessDeniedMessage: null };

const renderPage = async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/crew/a1']}>
        <Routes>
          <Route path="/crew/:id" element={<ActivityDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.findByTestId('discussion');
};

beforeEach(() => {
  onlineManager.setOnline(true);
  me.value = { id: 'me', username: 'me', displayName: 'Me' };
  // Reports the discussion slot as on screen at once, so the panel mounts.
  globalThis.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; }
    observe() { this.cb([{ isIntersecting: true }]); }
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  };
});
afterEach(cleanup);

describe('discussion composer', () => {
  it('is withheld from someone who has not joined, with the join line', async () => {
    query.value = { ...idle, data: activity() };
    const panel = await renderPage();
    expect(panel.getAttribute('data-can-post')).toBe('false');
    expect(panel.textContent).toBe('Join this activity to take part in the discussion.');
  });

  it('is withheld from someone who declined', async () => {
    query.value = { ...idle, data: activity({ isNotGoing: true, myStatus: 'DECLINED' }) };
    const panel = await renderPage();
    expect(panel.getAttribute('data-can-post')).toBe('false');
  });

  it('is offered to a member (an accepted invitee is one)', async () => {
    query.value = { ...idle, data: activity({ isJoined: true, myStatus: 'MEMBER' }) };
    const panel = await renderPage();
    expect(panel.getAttribute('data-can-post')).toBe('true');
  });

  it('is offered to the host', async () => {
    me.value = person('host');
    query.value = { ...idle, data: activity() };
    const panel = await renderPage();
    expect(panel.getAttribute('data-can-post')).toBe('true');
  });

  it('closes with the ended line once the activity is over, even for the host', async () => {
    me.value = person('host');
    query.value = { ...idle, data: activity({ status: 'ENDED' }) };
    const panel = await renderPage();
    expect(panel.getAttribute('data-can-post')).toBe('false');
    expect(panel.textContent).toBe('This activity has ended.');
  });

  it('closes with the cancelled line for a member of a cancelled activity', async () => {
    query.value = { ...idle, data: activity({ isJoined: true, myStatus: 'MEMBER', status: 'CANCELLED' }) };
    const panel = await renderPage();
    await waitFor(() => expect(panel.getAttribute('data-can-post')).toBe('false'));
    expect(panel.textContent).toBe('This activity was cancelled.');
  });
});
