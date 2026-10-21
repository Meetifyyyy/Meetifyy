/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ getDiscussion: vi.fn(), sendDiscussionMessage: vi.fn() }));
vi.mock('@shared/api/apiClient', () => ({ activitiesApi: api }));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'me' } }) }));
vi.mock('@shared/stores/useGlobalSocketStore', () => ({
  useGlobalSocketStore: (select) => select({ socket: null }),
}));

import { useActivityDiscussion } from '../useActivityDiscussion';

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
