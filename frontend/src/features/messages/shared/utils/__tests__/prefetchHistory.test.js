import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { prefetchChatHistory, resetHistoryPrefetch, routeIdOf, historyKey } from '../prefetchHistory';

/**
 * A chat's history fetched ahead of opening it: the server's page, stored
 * stale so the chat's own query still runs on open, and never over data the
 * chat already has.
 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('prefetchChatHistory', () => {
  let queryClient;
  beforeEach(() => {
    resetHistoryPrefetch();
    queryClient = new QueryClient();
  });

  it('stores the first page under the key the chat reads, marked stale', async () => {
    const getHistory = vi.fn(async () => ({ messages: [{ id: 'm1', text: 'hi' }], nextCursor: 'c1' }));
    prefetchChatHistory(queryClient, 'pub1', { getHistory });
    await flush();
    expect(getHistory).toHaveBeenCalledWith('pub1');
    const data = queryClient.getQueryData(historyKey('pub1'));
    expect(data.pages).toHaveLength(1);
    expect(data.pageParams).toEqual([undefined]);
    expect(data.pages[0].nextCursor).toBe('c1');
    expect(data.pages[0].messages[0]).toMatchObject({ id: 'm1', status: 'sent' });
    // Stale: the chat's own query (outbox and socket merging) still fetches on open.
    expect(queryClient.getQueryState(historyKey('pub1')).dataUpdatedAt).toBe(0);
  });

  it('never fetches a chat that already has history in memory', async () => {
    queryClient.setQueryData(historyKey('pub1'), { pages: [{ messages: [] }], pageParams: [undefined] });
    const getHistory = vi.fn();
    prefetchChatHistory(queryClient, 'pub1', { getHistory });
    await flush();
    expect(getHistory).not.toHaveBeenCalled();
  });

  it('asks once for a chat however often it is pressed', async () => {
    let resolve;
    const getHistory = vi.fn(() => new Promise((r) => { resolve = r; }));
    prefetchChatHistory(queryClient, 'pub1', { getHistory });
    prefetchChatHistory(queryClient, 'pub1', { getHistory });
    await flush();
    expect(getHistory).toHaveBeenCalledTimes(1);
    resolve({ messages: [] });
    await flush();
  });

  it('does not overwrite the answer the opened chat got first', async () => {
    let resolve;
    const getHistory = vi.fn(() => new Promise((r) => { resolve = r; }));
    prefetchChatHistory(queryClient, 'pub1', { getHistory });
    await flush();
    const own = { pages: [{ messages: [{ id: 'own' }] }], pageParams: [undefined] };
    queryClient.setQueryData(historyKey('pub1'), own);
    resolve({ messages: [{ id: 'prefetched' }] });
    await flush();
    expect(queryClient.getQueryData(historyKey('pub1'))).toEqual(own);
  });

  it('skips drafts and unsynced local conversations, and survives a failed request', async () => {
    const getHistory = vi.fn(async () => { throw new Error('offline'); });
    prefetchChatHistory(queryClient, 'draft_u1', { getHistory });
    prefetchChatHistory(queryClient, 'temp_1', { getHistory });
    prefetchChatHistory(queryClient, 'c_temp_1', { getHistory });
    expect(getHistory).not.toHaveBeenCalled();
    prefetchChatHistory(queryClient, 'pub2', { getHistory });
    await flush();
    expect(queryClient.getQueryData(historyKey('pub2'))).toBeUndefined();
  });

  it('keys a conversation by the id its URL carries', () => {
    expect(routeIdOf({ id: 'internal', publicId: 'pub' })).toBe('pub');
    expect(routeIdOf({ id: 'internal' })).toBe('internal');
    expect(routeIdOf(null)).toBe('');
  });
});
