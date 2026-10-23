/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * An activity opened with no network: shown when the device has it (its own
 * record, a list card, or the one handed over by the screen it was opened
 * from), a centred offline state with a way back when it has nothing — never
 * "not found", which is a statement about the activity — and actions that need
 * the network refused with the reason.
 */
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const { query, join, bookmark, showToast, goBack } = vi.hoisted(() => ({
  query: { value: {} },
  join: vi.fn(),
  bookmark: vi.fn(),
  showToast: vi.fn(),
  goBack: vi.fn(),
}));

vi.mock('@shared/api/apiClient', () => ({
  activitiesApi: { join, leave: join, bookmark, unbookmark: bookmark, inviteFriends: vi.fn(), cancelCrewActivity: vi.fn() },
  getMediaUrl: (u) => u,
  deriveThumbnailKey: () => null,
}));
vi.mock('@shared/hooks/useCrew', () => ({
  useActivityById: () => query.value,
  useActivityAttendees: () => ({ attendees: [], hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn() }),
}));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'me', username: 'me' } }) }));
vi.mock('@shared/hooks/useSystemBars', () => ({ useSystemBars: () => {} }));
vi.mock('@shared/hooks/useAmbientTint', () => ({ useAmbientTint: () => {} }));
vi.mock('@shared/hooks/useSmartBack', () => ({ useSmartBack: () => goBack }));
vi.mock('@shared/utils/toast', () => ({ showToast }));
vi.mock('../../components/ActivityDiscussion', () => ({ ActivityDiscussion: () => null }));
vi.mock('../../components/modals/ShareActivityModal', () => ({ default: () => null }));
vi.mock('@shared/components/modals/InviteFriendsModal', () => ({ default: () => null }));

const { default: ActivityDetailPage } = await import('../ActivityDetailPage');
const { useSavedActivitiesStore } = await import('@shared/stores/savedActivitiesStore');

const activity = (over = {}) => ({
  id: 'a1',
  title: 'Sunrise hike',
  description: 'Up the hill',
  location: 'North gate',
  creatorId: 'host',
  creator: { id: 'host', displayName: 'Host', username: 'host' },
  maxMembers: 10,
  memberCount: 2,
  members: [],
  isJoined: false,
  startDate: new Date(Date.now() + 86_400_000).toISOString(),
  ...over,
});
const idle = { isLoading: false, isError: false, error: null, refetch: vi.fn(), isAccessDenied: false, accessDeniedCode: null, accessDeniedMessage: null };

const renderPage = (state) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[{ pathname: '/crew/a1', state }]}>
        <Routes>
          <Route path="/crew/:id" element={<ActivityDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  onlineManager.setOnline(false);
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
  join.mockReset();
  bookmark.mockReset();
  showToast.mockReset();
  goBack.mockReset();
  useSavedActivitiesStore.setState({ savedActivities: [] });
});
afterEach(() => {
  onlineManager.setOnline(true);
  cleanup();
  vi.restoreAllMocks();
});

describe('activity opened offline', () => {
  it('with nothing available: a centred offline state and a way back, not "not found" or a skeleton', () => {
    // A paused query: no data, not loading, not an error.
    query.value = { ...idle, data: undefined };
    const { container } = renderPage();

    expect(container.querySelector('[data-offline-screen]')).not.toBeNull();
    expect(screen.getByText("You're offline")).toBeTruthy();
    expect(screen.queryByText(/not found|doesn.t exist/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(goBack).toHaveBeenCalledWith('/crew');
  });

  it('with the activity available (its own copy or a list card): shows it', () => {
    query.value = { ...idle, data: activity() };
    const { container } = renderPage();
    expect(container.querySelector('[data-offline-screen]')).toBeNull();
    expect(screen.getAllByText('Sunrise hike').length).toBeGreaterThan(0);
  });

  it('with only what the opening screen handed over: shows that', () => {
    query.value = { ...idle, data: undefined };
    const { container } = renderPage({ activity: activity() });
    expect(container.querySelector('[data-offline-screen]')).toBeNull();
    expect(screen.getAllByText('Sunrise hike').length).toBeGreaterThan(0);
  });

  it('refuses joining with the offline sentence and makes no request', () => {
    query.value = { ...idle, data: activity() };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /I'm in/ }));
    expect(join).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalled();
    expect(showToast.mock.calls[0][0]).toMatch(/offline/i);
  });

  it('refuses saving it, and does not flip the bookmark', () => {
    query.value = { ...idle, data: activity() };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(bookmark).not.toHaveBeenCalled();
    expect(useSavedActivitiesStore.getState().savedActivities).toEqual([]);
    expect(showToast.mock.calls[0][0]).toMatch(/offline/i);
  });

  it('online, a failed request that never reached the server is a retryable error, not "not found"', () => {
    onlineManager.setOnline(true);
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
    const refetch = vi.fn();
    const error = Object.assign(new TypeError('Failed to fetch'), {});
    query.value = { ...idle, data: undefined, isError: true, error, refetch };
    renderPage();
    expect(screen.queryByText(/not found/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
