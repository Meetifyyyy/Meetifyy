/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Reading and dismissing notifications used to invalidate `['notifications']`
 * on success, which refetches every loaded page of every feed AND the unread
 * count — and `['notifications']` prefix-matches all three. Opening the page
 * marks everything read automatically, so simply arriving re-downloaded the
 * list that had just been rendered.
 *
 * The new state is known locally in all three cases, so it is written into the
 * cache and nothing is refetched unless the request fails.
 */
const api = {
  getAll: vi.fn(),
  getUnreadCount: vi.fn(),
  markAsRead: vi.fn(),
  markAllAsRead: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@shared/api/apiClient', () => ({ notificationsApi: api }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'u1' } }) }));

const { useNotifications, useUnreadNotificationCount } = await import('../useNotifications');

const LIST_KEY = ['notifications'];
const COUNT_KEY = ['notifications', 'unreadCount'];

const row = (id, read = false) => ({ id, read, readAt: read ? '2026-01-01' : null, type: 'FOLLOW' });

let queryClient;
const wrapper = ({ children }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const seed = () => {
  queryClient.setQueryData(LIST_KEY, {
    pages: [{ data: [row('n1'), row('n2'), row('n3', true)], nextCursor: null }],
    pageParams: [undefined],
  });
  queryClient.setQueryData(COUNT_KEY, { count: 2 });
};

const rows = () => queryClient.getQueryData(LIST_KEY)?.pages.flatMap((p) => p.data) ?? [];
const count = () => queryClient.getQueryData(COUNT_KEY)?.count;

describe('notification cache updates', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.getAll.mockResolvedValue({ data: [], nextCursor: null });
    api.getUnreadCount.mockResolvedValue({ count: 2 });
    api.markAsRead.mockResolvedValue({});
    api.markAllAsRead.mockResolvedValue({});
    api.delete.mockResolvedValue({});
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    seed();
  });
  afterEach(() => queryClient.clear());

  it('marks one read in place, without refetching the list', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useNotifications(), { wrapper });

    await act(async () => { result.current.markAsRead('n1'); });
    await waitFor(() => expect(api.markAsRead).toHaveBeenCalledWith('n1'));

    expect(rows().find((n) => n.id === 'n1').read).toBe(true);
    // Untouched rows keep their identity, so memoised consumers do not re-render.
    expect(rows().find((n) => n.id === 'n2').read).toBe(false);
    expect(count()).toBe(1);
    expect(invalidate).not.toHaveBeenCalled();
    // Not even the initial load: the cache was already warm and inside its
    // staleTime, which is exactly the state a user arriving on this page is in.
    expect(api.getAll).not.toHaveBeenCalled();
  });

  it('does not double-decrement when a read notification is marked again', async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await act(async () => { result.current.markAsRead('n3'); }); // already read
    await waitFor(() => expect(api.markAsRead).toHaveBeenCalled());
    expect(count()).toBe(2);
  });

  it('marks all read and zeroes the count without refetching', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useNotifications(), { wrapper });

    await act(async () => { result.current.markAllRead(); });
    await waitFor(() => expect(api.markAllAsRead).toHaveBeenCalled());

    expect(rows().every((n) => n.read)).toBe(true);
    expect(count()).toBe(0);
    expect(invalidate).not.toHaveBeenCalled();
    // This is the mutation that fires automatically on opening the page, so it
    // is the one that used to re-download the list the user was already reading.
    expect(api.getAll).not.toHaveBeenCalled();
  });

  it('removes a dismissed notification and adjusts the count', async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await act(async () => { result.current.dismissNotification('n1'); });
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('n1'));

    expect(rows().map((n) => n.id)).toEqual(['n2', 'n3']);
    expect(count()).toBe(1);
  });

  it('does not decrement the count for an already-read dismissal', async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await act(async () => { result.current.dismissNotification('n3'); });
    await waitFor(() => expect(api.delete).toHaveBeenCalled());
    expect(count()).toBe(2);
  });

  it('rolls back and resyncs when the server refuses', async () => {
    api.markAllAsRead.mockRejectedValue(new Error('nope'));
    // The resync refetch answers with the server's real state, which still has n1
    // unread — the mutation never took effect.
    api.getAll.mockResolvedValue({
      data: [row('n1'), row('n2'), row('n3', true)],
      nextCursor: null,
    });
    api.getUnreadCount.mockResolvedValue({ count: 2 });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useNotifications(), { wrapper });

    await act(async () => { result.current.markAllRead(); });
    await waitFor(() => expect(invalidate).toHaveBeenCalled());

    // The optimistic write is undone, so the list never sits there claiming
    // something the server did not do — with or without the refetch landing.
    await waitFor(() => expect(rows().find((n) => n.id === 'n1')?.read).toBe(false));
    expect(count()).toBe(2);
  });

  it('keeps the unread count out of the list updates', async () => {
    // `['notifications']` prefix-matches the count entry. Treating it as a feed
    // would run the page-mapping function over `{ count }` and corrupt it.
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await act(async () => { result.current.markAllRead(); });
    await waitFor(() => expect(api.markAllAsRead).toHaveBeenCalled());
    expect(queryClient.getQueryData(COUNT_KEY)).toEqual({ count: 0 });
  });

  it('returns a stable object and array while nothing changes', async () => {
    // Both were rebuilt on every render, so every consumer re-rendered on every
    // render of its own parent — and the grouping memo on the notifications
    // page, which keys off `notifications`, could never hit.
    const { result, rerender } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    expect(result.current.notifications).toBe(first.notifications);
    expect(result.current.markAllRead).toBe(first.markAllRead);
  });
});

describe('the bell', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.getAll.mockResolvedValue({ data: [], nextCursor: null });
    api.getUnreadCount.mockResolvedValue({ count: 7 });
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => queryClient.clear());

  it('reads the count without fetching the notification feed', async () => {
    // The bell is in the header on every route. Through the full hook it also
    // mounted the infinite feed query, so every page in the app fetched page
    // one of the notification list to render a number.
    const { result } = renderHook(() => useUnreadNotificationCount(), { wrapper });
    await waitFor(() => expect(result.current).toBe(7));

    expect(api.getUnreadCount).toHaveBeenCalledTimes(1);
    expect(api.getAll).not.toHaveBeenCalled();
  });
});
