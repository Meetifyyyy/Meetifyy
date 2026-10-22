/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';

/**
 * The main tabs open on what the user last saw, for that user only.
 *
 * Messages, Notifications and the communities list used to show a skeleton on
 * every launch until the network answered. These pin the rules that make a
 * restored list safe: it belongs to one account, it never overrides a fresher
 * network answer, and it is always revalidated.
 */
const disk = vi.hoisted(() => new Map());
const epoch = vi.hoisted(() => ({ value: 0 }));
vi.mock('@shared/lib/idb', () => ({
  idbEpoch: () => epoch.value,
  idbGet: async (store, key) => (disk.has(`${store}/${key}`) ? { value: disk.get(`${store}/${key}`) } : null),
  idbSet: async (store, key, value) => {
    disk.set(`${store}/${key}`, value);
  },
}));

const { installQuerySnapshots } = await import('../querySnapshots');

const signIn = (id) => {
  localStorage.setItem('loggedIn', 'true');
  localStorage.setItem('currentUser', JSON.stringify({ id }));
};
const flush = async () => {
  await vi.advanceTimersByTimeAsync(20_000);
};
const conversations = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i}` }));

let qc;
beforeEach(() => {
  vi.useFakeTimers();
  disk.clear();
  epoch.value = 0;
  localStorage.clear();
  delete window.requestIdleCallback; // jsdom: the timeout path
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  qc.clear();
  vi.useRealTimers();
});

describe('main-tab snapshots', () => {
  it('saves the first page after a real fetch, trimmed and scoped to the account', async () => {
    signIn('u1');
    installQuerySnapshots(qc);
    await qc.fetchQuery({ queryKey: ['conversations'], queryFn: async () => conversations(50) });
    await flush();
    const saved = disk.get('queries/u1:["conversations"]');
    expect(saved.userId).toBe('u1');
    expect(saved.data).toHaveLength(30);
  });

  it('keeps only page one of the notifications list', async () => {
    signIn('u1');
    installQuerySnapshots(qc);
    await qc.fetchInfiniteQuery({
      queryKey: ['notifications'],
      queryFn: async ({ pageParam }) => ({ data: [pageParam ?? 'first'], nextCursor: 'n2' }),
      initialPageParam: undefined,
      getNextPageParam: (last) => last.nextCursor,
      pages: 2,
    });
    await flush();
    const saved = disk.get('queries/u1:["notifications"]');
    expect(saved.data.pages).toHaveLength(1);
    expect(saved.data.pages[0].data).toEqual(['first']);
  });

  it('restores into an empty query when a screen asks, as stale data', async () => {
    signIn('u1');
    disk.set('queries/u1:["conversations"]', { v: 1, userId: 'u1', savedAt: Date.now() - 1000, data: conversations(3) });
    installQuerySnapshots(qc);
    let resolveNetwork;
    const observer = new QueryObserver(qc, {
      queryKey: ['conversations'],
      queryFn: () => new Promise((r) => { resolveNetwork = r; }),
      staleTime: 60_000,
    });
    const unsubscribe = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(qc.getQueryData(['conversations'])).toHaveLength(3);
    // Still revalidated: the network answer replaces it.
    resolveNetwork(conversations(5));
    await vi.advanceTimersByTimeAsync(0);
    expect(qc.getQueryData(['conversations'])).toHaveLength(5);
    unsubscribe();
  });

  it('never restores another account’s snapshot', async () => {
    signIn('u2');
    disk.set('queries/u1:["conversations"]', { v: 1, userId: 'u1', savedAt: Date.now(), data: conversations(3) });
    installQuerySnapshots(qc);
    const observer = new QueryObserver(qc, { queryKey: ['conversations'], queryFn: () => new Promise(() => {}) });
    const unsubscribe = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(qc.getQueryData(['conversations'])).toBeUndefined();
    unsubscribe();
  });

  it('lets a network answer that arrived first win over the disk', async () => {
    signIn('u1');
    disk.set('queries/u1:["conversations"]', { v: 1, userId: 'u1', savedAt: Date.now(), data: conversations(3) });
    installQuerySnapshots(qc);
    const observer = new QueryObserver(qc, { queryKey: ['conversations'], queryFn: async () => conversations(7) });
    const unsubscribe = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(qc.getQueryData(['conversations'])).toHaveLength(7);
    unsubscribe();
  });

  it('marks a restored unread count for refetch despite its Infinity staleTime', async () => {
    signIn('u1');
    disk.set('queries/u1:["notifications","unreadCount"]', { v: 1, userId: 'u1', savedAt: Date.now(), data: { count: 4 } });
    installQuerySnapshots(qc);
    const observer = new QueryObserver(qc, {
      queryKey: ['notifications', 'unreadCount'],
      queryFn: () => new Promise(() => {}),
      staleTime: Infinity,
      enabled: false,
    });
    const unsubscribe = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(qc.getQueryData(['notifications', 'unreadCount'])).toEqual({ count: 4 });
    expect(qc.getQueryState(['notifications', 'unreadCount']).isInvalidated).toBe(true);
    unsubscribe();
  });

  it('ignores snapshots that are too old or from another version', async () => {
    signIn('u1');
    disk.set('queries/u1:["conversations"]', { v: 1, userId: 'u1', savedAt: Date.now() - 4 * 86_400_000, data: conversations(3) });
    disk.set('queries/u1:["communities","mine"]', { v: 0, userId: 'u1', savedAt: Date.now(), data: [{ id: 'x' }] });
    installQuerySnapshots(qc);
    const a = new QueryObserver(qc, { queryKey: ['conversations'], queryFn: () => new Promise(() => {}) });
    const b = new QueryObserver(qc, { queryKey: ['communities', 'mine'], queryFn: () => new Promise(() => {}) });
    const ua = a.subscribe(() => {});
    const ub = b.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(qc.getQueryData(['conversations'])).toBeUndefined();
    expect(qc.getQueryData(['communities', 'mine'])).toBeUndefined();
    ua();
    ub();
  });

  it('ends on the latest list when refetches land inside the write window', async () => {
    signIn('u1');
    installQuerySnapshots(qc);
    await qc.fetchQuery({ queryKey: ['conversations'], queryFn: async () => conversations(1) });
    await flush();
    await qc.fetchQuery({ queryKey: ['conversations'], queryFn: async () => conversations(2), staleTime: 0 });
    await qc.fetchQuery({ queryKey: ['conversations'], queryFn: async () => conversations(3), staleTime: 0 });
    await flush();
    expect(disk.get('queries/u1:["conversations"]').data).toHaveLength(3);
  });

  it('touches nothing it was not told to keep', async () => {
    signIn('u1');
    installQuerySnapshots(qc);
    await qc.fetchQuery({ queryKey: ['search', 'cats'], queryFn: async () => [1] });
    await flush();
    expect(disk.size).toBe(0);
  });

  it('restores synchronously from the read-ahead, with no empty frame', async () => {
    signIn('u1');
    disk.set('queries/u1:["conversations"]', { v: 1, userId: 'u1', savedAt: Date.now() - 1000, data: conversations(3) });
    installQuerySnapshots(qc);
    await vi.advanceTimersByTimeAsync(0); // the read-ahead lands
    const observer = new QueryObserver(qc, { queryKey: ['conversations'], queryFn: () => new Promise(() => {}) });
    const unsubscribe = observer.subscribe(() => {});
    // No await: already there for the first render.
    expect(qc.getQueryData(['conversations'])).toHaveLength(3);
    expect(qc.getQueryState(['conversations']).isInvalidated).toBe(true);
    unsubscribe();
  });

  it('drops the read-ahead after a sign-out', async () => {
    signIn('u1');
    disk.set('queries/u1:["conversations"]', { v: 1, userId: 'u1', savedAt: Date.now(), data: conversations(3) });
    installQuerySnapshots(qc);
    await vi.advanceTimersByTimeAsync(0);
    epoch.value += 1;
    disk.clear(); // idbClearAll
    signIn('u2');
    const observer = new QueryObserver(qc, { queryKey: ['conversations'], queryFn: () => new Promise(() => {}) });
    const unsubscribe = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(qc.getQueryData(['conversations'])).toBeUndefined();
    unsubscribe();
  });

  it('does not let the previous account’s write window hold back the next account', async () => {
    signIn('u1');
    installQuerySnapshots(qc);
    await qc.fetchQuery({ queryKey: ['conversations'], queryFn: async () => conversations(1) });
    await flush();
    expect(disk.has('queries/u1:["conversations"]')).toBe(true);
    // Sign-out and a new account inside the 15s window.
    epoch.value += 1;
    qc.clear();
    signIn('u2');
    await qc.fetchQuery({ queryKey: ['conversations'], queryFn: async () => conversations(2) });
    await vi.advanceTimersByTimeAsync(1_000); // well inside A's window
    expect(disk.get('queries/u2:["conversations"]').data).toHaveLength(2);
  });
});
