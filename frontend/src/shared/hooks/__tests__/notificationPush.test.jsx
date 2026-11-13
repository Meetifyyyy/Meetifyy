/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query';

/**
 * A pushed notification is written into the loaded lists rather than
 * refetching every page of every list (FEP-3), and the unread count the server
 * pushes is applied rather than refetched (FEP-2).
 */
vi.mock('@shared/api/apiClient', () => ({ notificationsApi: {} }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ currentUser: null }) }));

const {
  insertPushedNotification,
  applyPushedUnreadCount,
  markNotificationListsStale,
} = await import('../useNotifications');

const MAIN = ['notifications'];
const INVITES = ['notifications', { type: 'ACTIVITY_INVITE' }];
const COUNT = ['notifications', 'unreadCount'];

const row = (id, type = 'COMMENT', extra = {}) => ({
  id,
  type,
  actorId: 'a1',
  actor: { id: 'a1', username: 'asha' },
  createdAt: '2026-11-13T10:00:00.000Z',
  ...extra,
});
const feed = (...pages) => ({
  pages: pages.map((ids, i) => ({ data: ids.map((id) => row(id)), nextCursor: i < pages.length - 1 ? ids.at(-1) : undefined })),
  pageParams: pages.map((_, i) => (i === 0 ? undefined : pages[i - 1].at(-1))),
});
const ids = (qc, key) => qc.getQueryData(key)?.pages.map((p) => p.data.map((n) => n.id));

let qc;
let fetches;
let unsubscribe;
beforeEach(() => {
  unsubscribe?.();
  qc = new QueryClient();
  fetches = vi.fn(async () => ({ data: [], nextCursor: undefined }));
  qc.setQueryData(MAIN, feed(['m1', 'm2'], ['m3']));
  qc.setQueryData(INVITES, feed(['i1']));
  qc.setQueryData(COUNT, { count: 4 });
  // Mounted, as on screen: an invalidation of either list would refetch it
  // and call `fetches`.
  const subs = [MAIN, INVITES].map((queryKey) =>
    new InfiniteQueryObserver(qc, {
      queryKey,
      queryFn: fetches,
      initialPageParam: undefined,
      getNextPageParam: (last) => last?.nextCursor,
      staleTime: Infinity,
    }).subscribe(() => {}),
  );
  unsubscribe = () => subs.forEach((u) => u());
});

describe('insertPushedNotification', () => {
  it('puts a new row at the top of the lists it belongs in, and fetches nothing', () => {
    expect(insertPushedNotification(qc, row('new', 'COMMENT'))).toBe(true);
    expect(ids(qc, MAIN)).toEqual([['new', 'm1', 'm2'], ['m3']]);
    // Not an invite: the invites tab is untouched.
    expect(ids(qc, INVITES)).toEqual([['i1']]);
    expect(fetches).not.toHaveBeenCalled();
    expect(qc.getQueryData(COUNT)).toEqual({ count: 4 });
  });

  it('puts an invite in both the main list and the invites tab', () => {
    expect(insertPushedNotification(qc, row('inv', 'ACTIVITY_INVITE'))).toBe(true);
    expect(ids(qc, MAIN)[0][0]).toBe('inv');
    expect(ids(qc, INVITES)).toEqual([['inv', 'i1']]);
  });

  it('declines a row that arrives without its actor (an aggregated like)', () => {
    const bare = row('like', 'LIKE', { actor: undefined });
    expect(insertPushedNotification(qc, bare)).toBe(false);
    expect(ids(qc, MAIN)).toEqual([['m1', 'm2'], ['m3']]);
  });

  it('declines a row already listed, so its move cannot break a page cursor', () => {
    expect(insertPushedNotification(qc, row('m3'))).toBe(false);
    expect(ids(qc, MAIN)).toEqual([['m1', 'm2'], ['m3']]);
  });

  it('accepts an actor-less system row, and ignores a message', () => {
    expect(insertPushedNotification(qc, row('sys', 'SYSTEM', { actorId: null, actor: null }))).toBe(true);
    expect(ids(qc, MAIN)[0][0]).toBe('sys');
    expect(insertPushedNotification(qc, row('msg', 'MESSAGE'))).toBe(true);
    expect(ids(qc, MAIN)[0]).not.toContain('msg');
  });

  it('leaves a list that is not loaded alone', () => {
    qc.removeQueries({ queryKey: INVITES, exact: true });
    expect(insertPushedNotification(qc, row('inv2', 'ACTIVITY_INVITE'))).toBe(true);
    expect(qc.getQueryData(INVITES)).toBeUndefined();
  });
});

describe('applyPushedUnreadCount', () => {
  it('writes the pushed count', () => {
    applyPushedUnreadCount(qc, { count: 7 });
    expect(qc.getQueryData(COUNT)).toEqual({ count: 7 });
  });

  it.each([[undefined], [{}], [{ count: '3' }], [{ count: -1 }], [{ count: NaN }]])(
    'ignores %j',
    (payload) => {
      applyPushedUnreadCount(qc, payload);
      expect(qc.getQueryData(COUNT)).toEqual({ count: 4 });
    },
  );
});

describe('markNotificationListsStale', () => {
  it('marks the lists out of date without fetching them, and leaves the count', () => {
    markNotificationListsStale(qc);
    expect(qc.getQueryState(MAIN)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(INVITES)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(COUNT)?.isInvalidated).toBe(false);
    expect(fetches).not.toHaveBeenCalled();
  });
});
