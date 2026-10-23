/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryObserver, hashKey } from '@tanstack/react-query';

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
  idbDelete: async (store, key) => {
    disk.delete(`${store}/${key}`);
  },
}));

const { installQuerySnapshots, SNAPSHOTS, DETAIL_SNAPSHOTS } = await import('../querySnapshots');

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

const signInToCollege = (id, collegeId) => {
  localStorage.setItem('loggedIn', 'true');
  localStorage.setItem('currentUser', JSON.stringify({ id, campusAffiliation: { active: true, collegeId } }));
};
const CAMPUS_KEYS = [
  ['users', 'campus', 50],
  ['communities', 'campus'],
  ['campus-events', 'scope', 'upcoming'],
  ['activities', 'campus', { limit: 4 }],
];

describe('campus snapshots', () => {
  it('registers every query the Campus page renders from', () => {
    for (const queryKey of CAMPUS_KEYS) {
      expect(SNAPSHOTS.some((s) => hashKey(s.queryKey) === hashKey(queryKey) && s.campus === true)).toBe(true);
    }
  });

  it('saves them trimmed, scoped to the account and its college', async () => {
    signInToCollege('u1', 'c1');
    installQuerySnapshots(qc);
    await qc.fetchQuery({ queryKey: ['users', 'campus', 50], queryFn: async () => Array.from({ length: 80 }, (_, i) => ({ id: `s${i}` })) });
    await qc.fetchInfiniteQuery({
      queryKey: ['campus-events', 'scope', 'upcoming'],
      queryFn: async () => ({ items: ['e'] }),
      initialPageParam: undefined,
      pages: 1,
    });
    await flush();
    const users = disk.get('queries/u1:["users","campus",50]');
    expect(users.data).toHaveLength(50);
    expect(users.scope).toBe('c1');
    expect(users.userId).toBe('u1');
    expect(disk.get('queries/u1:["campus-events","scope","upcoming"]').data.pages).toHaveLength(1);
  });

  it('keeps only page one of the events and activities', async () => {
    signInToCollege('u1', 'c1');
    installQuerySnapshots(qc);
    await qc.fetchInfiniteQuery({
      queryKey: ['activities', 'campus', { limit: 4 }],
      queryFn: async ({ pageParam }) => ({ items: [pageParam ?? 'a'], nextCursor: 'n' }),
      initialPageParam: undefined,
      getNextPageParam: (l) => l.nextCursor,
      pages: 2,
    });
    await flush();
    const saved = disk.get('queries/u1:["activities","campus",{"limit":4}]');
    expect(saved.data.pages).toHaveLength(1);
  });

  it('restores the saved Campus content when the account is still in that college', async () => {
    signInToCollege('u1', 'c1');
    disk.set('queries/u1:["communities","campus"]', { v: 1, userId: 'u1', scope: 'c1', savedAt: Date.now() - 1000, data: [{ id: 'k1' }] });
    installQuerySnapshots(qc);
    const observer = new QueryObserver(qc, { queryKey: ['communities', 'campus'], queryFn: () => new Promise(() => {}), enabled: false });
    const unsubscribe = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(qc.getQueryData(['communities', 'campus'])).toEqual([{ id: 'k1' }]);
    unsubscribe();
  });

  it('never restores another college’s lists, or any once the affiliation is gone', async () => {
    disk.set('queries/u1:["communities","campus"]', { v: 1, userId: 'u1', scope: 'c1', savedAt: Date.now(), data: [{ id: 'k1' }] });
    for (const setUp of [() => signInToCollege('u1', 'c2'), () => signIn('u1')]) {
      qc.clear();
      localStorage.clear();
      setUp();
      installQuerySnapshots(qc);
      const observer = new QueryObserver(qc, { queryKey: ['communities', 'campus'], queryFn: () => new Promise(() => {}) });
      const unsubscribe = observer.subscribe(() => {});
      await vi.advanceTimersByTimeAsync(0);
      expect(qc.getQueryData(['communities', 'campus'])).toBeUndefined();
      unsubscribe();
    }
  });

  it('does not save Campus content for an account without a college', async () => {
    signIn('u1');
    installQuerySnapshots(qc);
    await qc.fetchQuery({ queryKey: ['communities', 'campus'], queryFn: async () => [{ id: 'k1' }] });
    await flush();
    expect(disk.size).toBe(0);
  });
});

describe('detail snapshots', () => {
  it('keeps a community and an activity once opened, and restores them for a later offline open', async () => {
    signIn('u1');
    installQuerySnapshots(qc);
    await qc.fetchQuery({ queryKey: ['community', 'c9'], queryFn: async () => ({ id: 'c9', name: 'Chess' }) });
    await qc.fetchQuery({ queryKey: ['activity', 'a9'], queryFn: async () => ({ id: 'a9', title: 'Hike' }) });
    await flush();
    expect(disk.get('queries/u1:["community","c9"]').data.name).toBe('Chess');
    expect(disk.get('queries/u1:["activity","a9"]').data.title).toBe('Hike');

    qc.clear(); // a new process
    installQuerySnapshots(qc);
    const observer = new QueryObserver(qc, { queryKey: ['activity', 'a9'], queryFn: () => new Promise(() => {}) });
    const unsubscribe = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(qc.getQueryData(['activity', 'a9'])).toEqual({ id: 'a9', title: 'Hike' });
    expect(qc.getQueryState(['activity', 'a9']).isInvalidated).toBe(true);
    unsubscribe();
  });

  it('keeps only the most recent few of each kind', async () => {
    signIn('u1');
    installQuerySnapshots(qc);
    const max = DETAIL_SNAPSHOTS.find((d) => d.root === 'community').max;
    for (let i = 0; i < max + 3; i += 1) {
      await qc.fetchQuery({ queryKey: ['community', `c${i}`], queryFn: async () => ({ id: `c${i}` }) });
      await flush();
    }
    const kept = [...disk.keys()].filter((k) => k.startsWith('queries/u1:["community",'));
    expect(kept).toHaveLength(max);
    expect(disk.has('queries/u1:["community","c0"]')).toBe(false);
    expect(disk.has(`queries/u1:["community","c${max + 2}"]`)).toBe(true);
  });

  it('deletes the saved copy when the server then refuses it', async () => {
    signIn('u1');
    installQuerySnapshots(qc);
    await qc.fetchQuery({ queryKey: ['activity', 'a1'], queryFn: async () => ({ id: 'a1' }) });
    await flush();
    expect(disk.has('queries/u1:["activity","a1"]')).toBe(true);
    await qc.fetchQuery({
      queryKey: ['activity', 'a1'],
      queryFn: async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); },
      staleTime: 0,
    }).catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(disk.has('queries/u1:["activity","a1"]')).toBe(false);
  });

  it('does not restore another account’s opened community', async () => {
    signIn('u2');
    disk.set('queries/u1:["community","c9"]', { v: 1, userId: 'u1', savedAt: Date.now(), data: { id: 'c9' } });
    installQuerySnapshots(qc);
    const observer = new QueryObserver(qc, { queryKey: ['community', 'c9'], queryFn: () => new Promise(() => {}) });
    const unsubscribe = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(qc.getQueryData(['community', 'c9'])).toBeUndefined();
    unsubscribe();
  });
});
