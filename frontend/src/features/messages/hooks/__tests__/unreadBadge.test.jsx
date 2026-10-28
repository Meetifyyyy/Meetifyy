/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The message badge counts every unread conversation, not just the page the
 * inbox loaded. Rows in the list count themselves (they update live); the
 * server's summary adds the ones further down, and only while there could be
 * any (the list is a full page).
 */
const api = vi.hoisted(() => ({
  getConversations: vi.fn(),
  getUnreadSummary: vi.fn(),
}));
vi.mock('@shared/api/apiClient', () => ({ messagesApi: api }));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { id: 'me' }, isLoggedIn: true }),
}));

const { useUnreadCounts } = await import('../useUnreadCounts');
const { CONVERSATION_LIST_PAGE } = await import('@shared/hooks/useMessages');
const { UNREAD_SUMMARY_KEY, withUnloadedUnread } = await import('../../shared/utils/unreadSummary');
const { applyReadToConversationList } = await import('../../shared/utils/conversationList');
const { applyOwnConversationPrefs } = await import('../../shared/utils/conversationLiveState');
const { applyOwnMembership } = await import('../../shared/utils/groupMembership');

const rows = (n, over = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({
    id: `pub-${i}`,
    publicId: `pub-${i}`,
    internalId: `int-${i}`,
    type: 'DM',
    isMember: true,
    unreadCount: 0,
    ...over(i),
  }));

// Further down the list: two unread chats the inbox has not loaded, and one
// entry for a row it has (whose own, live count wins).
const SUMMARY = {
  conversations: [
    { id: 'pub-old-dm', internalId: 'int-old-dm', isGroup: false, unread: 4 },
    { id: 'pub-old-group', internalId: 'int-old-group', isGroup: true, unread: 7 },
    { id: 'pub-0', internalId: 'int-0', isGroup: false, unread: 9 },
  ],
};

let qc;
const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.getConversations.mockReset();
  api.getUnreadSummary.mockReset().mockResolvedValue(SUMMARY);
});
afterEach(cleanup);

describe('withUnloadedUnread', () => {
  it('adds the summary only for conversations the list has not loaded, by either id', () => {
    const loaded = [{ id: 'pub-0', internalId: 'int-0' }, { id: 'x', internalId: 'int-old-group' }];
    expect(withUnloadedUnread({ dm: 1, group: 0, total: 1 }, loaded, SUMMARY)).toEqual({ dm: 5, group: 0, total: 5 });
  });

  it('leaves the totals alone without a summary', () => {
    const totals = { dm: 2, group: 1, total: 3 };
    expect(withUnloadedUnread(totals, [], undefined)).toBe(totals);
  });
});

describe('useUnreadCounts', () => {
  it('a list shorter than a page holds everything: no summary is asked for', async () => {
    api.getConversations.mockResolvedValue(rows(3, (i) => ({ unreadCount: i })));
    const { result } = renderHook(() => useUnreadCounts(), { wrapper });
    await waitFor(() => expect(result.current.total).toBe(3));
    expect(api.getUnreadSummary).not.toHaveBeenCalled();
  });

  it('a full page adds the unread chats further down, and the loaded rows count themselves', async () => {
    api.getConversations.mockResolvedValue(rows(CONVERSATION_LIST_PAGE, (i) => (i === 0 ? { unreadCount: 1 } : {})));
    const { result } = renderHook(() => useUnreadCounts(), { wrapper });
    await waitFor(() => expect(result.current).toEqual({ dm: 5, group: 7, total: 12 }));
  });

  it('asks again each time the list is fetched, for rows that dropped out of the page', async () => {
    api.getConversations.mockResolvedValue(rows(CONVERSATION_LIST_PAGE));
    const { result } = renderHook(() => useUnreadCounts(), { wrapper });
    await waitFor(() => expect(result.current.total).toBe(11));
    expect(api.getUnreadSummary).toHaveBeenCalledTimes(1);

    api.getUnreadSummary.mockResolvedValue({ conversations: [] });
    await act(() => qc.invalidateQueries({ queryKey: ['conversations'] }));
    await waitFor(() => expect(result.current.total).toBe(0));
    expect(api.getUnreadSummary).toHaveBeenCalledTimes(2);
  });
});

describe('what takes an unloaded chat off the badge', () => {
  const held = () => qc.getQueryData(UNREAD_SUMMARY_KEY).conversations.map((e) => e.id);
  beforeEach(() => {
    qc.setQueryData(['conversations'], rows(2));
    qc.setQueryData(UNREAD_SUMMARY_KEY, SUMMARY);
  });

  it('reading it, here or on another device', () => {
    applyReadToConversationList(qc, { ids: ['int-old-dm'], readAt: new Date().toISOString() });
    expect(held()).toEqual(['pub-old-group', 'pub-0']);
  });

  it('muting it; unmuting asks the server again', () => {
    applyOwnConversationPrefs(qc, { conversationId: 'pub-old-group', muted: true });
    expect(held()).toEqual(['pub-old-dm', 'pub-0']);
    applyOwnConversationPrefs(qc, { conversationId: 'pub-old-group', muted: false });
    expect(qc.getQueryState(UNREAD_SUMMARY_KEY).isInvalidated).toBe(true);
  });

  it('leaving or being removed from the group', () => {
    applyOwnMembership(qc, { ids: ['pub-old-group'], isMember: false, changedAt: new Date().toISOString() });
    expect(held()).toEqual(['pub-old-dm', 'pub-0']);
  });
});
