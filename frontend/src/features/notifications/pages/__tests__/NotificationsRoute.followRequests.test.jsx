/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

/**
 * Notifications: the Follow requests row, and where the two new types lead.
 * The virtualised list is replaced by a plain one; its rows are not under test.
 */
const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  notifications: [],
  requests: { requests: [], total: 0 },
}));

vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => h.navigate }));
vi.mock('@shared/hooks/useNotifications', () => ({
  useNotifications: () => ({
    notifications: h.notifications,
    unreadCount: 0,
    markAsRead: vi.fn(),
    markAllRead: vi.fn(),
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
    isFresh: false,
  }),
}));
vi.mock('@shared/hooks/useFollowRequests', () => ({
  FOLLOW_REQUESTS_KEY: ['followRequests'],
  useFollowRequests: () => h.requests,
}));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'me', username: 'me' } }) }));
vi.mock('@shared/api/apiClient', () => ({ activitiesApi: { getPendingInvitations: async () => [] } }));
vi.mock('@shared/hooks/useUsersMap', () => ({ useUsersMap: () => ({}) }));
vi.mock('@shared/hooks/useSystemBars', () => ({ useSystemBars: () => {} }));
vi.mock('@shared/lib/networkStatus', () => ({ useOnlineStatus: () => true, isOnline: () => true }));
vi.mock('@shared/push/PushOptInCard', () => ({ default: () => null }));
vi.mock('@shared/components/PullToRefresh', () => ({ default: ({ children }) => <>{children}</> }));
vi.mock('@layout/PageHeader', () => ({ default: () => <h1>Notifications</h1> }));
vi.mock('@shared/components/avatar/Avatar', () => ({ default: () => <span /> }));
vi.mock('@features/instant-match/context/InstantMatchContext', () => ({ requestOpenInstantMatchChat: vi.fn() }));
vi.mock('../../components/NotificationList', () => ({
  default: ({ groupedNotifications, onNotifClick }) => (
    <ul>
      {groupedNotifications.flatMap((g) => g.items).map((n) => (
        <li key={n.id}><button onClick={() => onNotifClick(n)}>{`open ${n.id}`}</button></li>
      ))}
    </ul>
  ),
}));

import NotificationsRoute from '../NotificationsRoute';

const now = new Date().toISOString();
const notif = (id, type, extra = {}) => ({
  id, type, createdAt: now, readAt: now, actor: { id: 'u1', username: 'asha', displayName: 'Asha' }, ...extra,
});

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><NotificationsRoute /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.navigate.mockReset();
  h.notifications = [];
  h.requests = { requests: [], total: 0 };
});
afterEach(cleanup);

describe('Notifications - follow requests', () => {
  it('has no requests row when there are no requests', () => {
    mount();
    expect(screen.queryByText('Follow requests')).toBeNull();
  });

  it('shows the row when there are requests, and it opens the requests page', () => {
    h.requests = {
      requests: [{ user: { id: 'u1', username: 'asha', displayName: 'Asha', avatar: null } }],
      total: 3,
    };
    mount();

    expect(screen.getByText('3 requests')).toBeTruthy();
    fireEvent.click(screen.getByText('Follow requests'));
    expect(h.navigate).toHaveBeenCalledWith('/notifications/follow-requests', expect.any(Object));
  });

  it('a FOLLOW_REQUEST notification opens the requests page', () => {
    h.notifications = [notif('n1', 'FOLLOW_REQUEST')];
    mount();

    fireEvent.click(screen.getByText('open n1'));

    expect(h.navigate).toHaveBeenCalledWith('/notifications/follow-requests', expect.any(Object));
  });

  it('a FOLLOW_ACCEPTED notification opens the accepter\'s profile', () => {
    h.notifications = [notif('n2', 'FOLLOW_ACCEPTED')];
    mount();

    fireEvent.click(screen.getByText('open n2'));

    expect(h.navigate).toHaveBeenCalledWith('/profile/asha', expect.any(Object));
  });
});
