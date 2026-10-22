/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ getDiscussion: vi.fn(), sendDiscussionMessage: vi.fn() }));
vi.mock('@shared/api/apiClient', () => ({ activitiesApi: api }));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'me' } }) }));
vi.mock('@shared/stores/useGlobalSocketStore', async () => {
  const { create } = await import('zustand');
  return { useGlobalSocketStore: create(() => ({ socket: null, isConnected: false })) };
});

import { useGlobalSocketStore } from '@shared/stores/useGlobalSocketStore';
import { useActivityDiscussion } from '../useActivityDiscussion';

/** Enough of a socket.io client: listeners, emits, and a `connected` flag. */
const fakeSocket = () => {
  const handlers = new Map();
  return {
    connected: true,
    emit: vi.fn(),
    on: (event, fn) => handlers.set(event, [...(handlers.get(event) || []), fn]),
    off: (event, fn) => handlers.set(event, (handlers.get(event) || []).filter((h) => h !== fn)),
    fire: (event, payload) => (handlers.get(event) || []).forEach((h) => h(payload)),
  };
};

const msg = (id, minute) => ({
  id,
  userId: 'u',
  text: id,
  createdAt: new Date(Date.UTC(2026, 0, 1, 12, minute)).toISOString(),
});

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
};

afterEach(() => {
  cleanup();
  useGlobalSocketStore.setState({ socket: null, isConnected: false });
  api.getDiscussion.mockReset();
  api.sendDiscussionMessage.mockReset();
});

it('asks for one page at a time and orders a sent message after the history', async () => {
  api.getDiscussion.mockResolvedValue({ messages: [msg('a', 1), msg('b', 2)], nextCursor: 'a', hasMore: true });
  api.sendDiscussionMessage.mockResolvedValue(msg('c', 3));
  const { wrapper } = setup();
  const { result } = renderHook(() => useActivityDiscussion('act'), { wrapper });

  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(api.getDiscussion).toHaveBeenCalledTimes(1);
  expect(api.getDiscussion).toHaveBeenCalledWith('act', { before: undefined, limit: 20 });
  expect(result.current.hasMore).toBe(true);

  await act(() => result.current.sendMessage('c'));
  expect(result.current.messages.map((m) => m.id)).toEqual(['a', 'b', 'c']);
});

it('shows a message once when the server copy also arrives in history', async () => {
  api.getDiscussion.mockResolvedValue({ messages: [msg('a', 1), msg('c', 3)], nextCursor: null, hasMore: false });
  api.sendDiscussionMessage.mockResolvedValue(msg('c', 3));
  const { wrapper } = setup();
  const { result } = renderHook(() => useActivityDiscussion('act'), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));

  await act(() => result.current.sendMessage('c'));
  expect(result.current.messages.map((m) => m.id)).toEqual(['a', 'c']);
});

it('keeps only the newest page cached after leaving, so a reopen costs one request', async () => {
  api.getDiscussion
    .mockResolvedValueOnce({ messages: [msg('c', 3)], nextCursor: 'c', hasMore: true })
    .mockResolvedValueOnce({ messages: [msg('a', 1)], nextCursor: null, hasMore: false });
  const { client, wrapper } = setup();
  const { result, unmount } = renderHook(() => useActivityDiscussion('act'), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  await act(() => result.current.loadMore());
  expect(client.getQueryData(['activity-discussion', 'act']).pages).toHaveLength(2);

  unmount();
  const cached = client.getQueryData(['activity-discussion', 'act']);
  expect(cached.pages).toHaveLength(1);
  expect(cached.pageParams).toHaveLength(1);
  expect(cached.pages[0].messages[0].id).toBe('c');
});

it('rejoins the room after a reconnect and fetches what was missed while down', async () => {
  const socket = fakeSocket();
  useGlobalSocketStore.setState({ socket, isConnected: true });
  api.getDiscussion.mockResolvedValueOnce({ messages: [msg('a', 1)], nextCursor: null, hasMore: false });
  const { wrapper } = setup();
  const { result } = renderHook(() => useActivityDiscussion('act'), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));

  const joins = () => socket.emit.mock.calls.filter(([e]) => e === 'activity:join');
  expect(joins()).toHaveLength(1);
  expect(joins()[0][1]).toEqual({ activityId: 'act' });

  act(() => socket.fire('activity_discussion:new', { ...msg('b', 2), activityId: 'act' }));
  expect(result.current.messages.map((m) => m.id)).toEqual(['a', 'b']);

  // Drop: the server forgets the room. Nothing is emitted into a dead socket.
  socket.connected = false;
  act(() => useGlobalSocketStore.setState({ isConnected: false }));
  expect(socket.emit.mock.calls.filter(([e]) => e === 'activity:leave')).toHaveLength(0);

  // 'c' was posted while the socket was down; the refetch brings it in, and
  // 'b' (already live) is not shown twice.
  api.getDiscussion.mockResolvedValueOnce({
    messages: [msg('a', 1), msg('b', 2), msg('c', 3)],
    nextCursor: null,
    hasMore: false,
  });
  socket.connected = true;
  act(() => useGlobalSocketStore.setState({ isConnected: true }));

  expect(joins()).toHaveLength(2);
  await waitFor(() => expect(result.current.messages.map((m) => m.id)).toEqual(['a', 'b', 'c']));
  expect(api.getDiscussion).toHaveBeenCalledTimes(2);

  // Still listening after the reconnect.
  act(() => socket.fire('activity_discussion:new', { ...msg('d', 4), activityId: 'act' }));
  expect(result.current.messages.map((m) => m.id)).toEqual(['a', 'b', 'c', 'd']);
});

it('does not refetch on the first join, and leaves the room on unmount', async () => {
  const socket = fakeSocket();
  useGlobalSocketStore.setState({ socket, isConnected: true });
  api.getDiscussion.mockResolvedValue({ messages: [msg('a', 1)], nextCursor: null, hasMore: false });
  const { wrapper } = setup();
  const { result, unmount } = renderHook(() => useActivityDiscussion('act'), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(api.getDiscussion).toHaveBeenCalledTimes(1);

  unmount();
  expect(socket.emit).toHaveBeenLastCalledWith('activity:leave', { activityId: 'act' });
});
