/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The reaction request queue, live totals and the reopen catch-up, below the
 * page: what reaches the network for a burst of taps, and how events and the
 * sync answer land in the cache.
 */
const api = vi.hoisted(() => ({ react: vi.fn(), unreact: vi.fn(), sync: vi.fn() }));
vi.mock('@shared/api/apiClient', () => ({ confessionsApi: api }));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ isLoggedIn: true, currentUser: { id: 'me' } }) }));
vi.mock('@shared/hooks/useCampusAffiliation', () => ({
  useHasCampusAccess: () => true,
  useCampusDeniedHandler: () => () => {},
}));

const {
  CONFESSION_KEYS,
  applyLiveReactions,
  applySync,
  useConfessionReactions,
  useConfessionsLive,
} = await import('../useConfessions');
const { useGlobalSocketStore } = await import('@shared/stores/useGlobalSocketStore');

const counts = (over = {}) => ({ love: 0, funny: 0, sad: 0, surprised: 0, relatable: 0, ...over });
const C = (id, over = {}) => ({
  id,
  handle: 'quiet.fern',
  content: 'something',
  createdAt: '2026-10-20T10:00:00.000Z',
  isMine: false,
  reactions: counts({ love: 2 }),
  reactionCount: 2,
  myReaction: null,
  relateCount: 2,
  relatedByMe: false,
  ...over,
});
const feedOf = (qc) => qc.getQueryData(CONFESSION_KEYS.feed).pages.flatMap((p) => p.confessions);

let qc;
const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
const seed = (confessions) => qc.setQueryData(CONFESSION_KEYS.feed, {
  pages: [{ confessions, nextCursor: null }],
  pageParams: [undefined],
});

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  Object.values(api).forEach((fn) => fn.mockReset());
});
afterEach(() => {
  cleanup();
  useGlobalSocketStore.setState({ socket: null, isConnected: false });
});

describe('reaction requests', () => {
  it('folds a burst of taps into one request for where they ended', async () => {
    seed([C('c1')]);
    api.react.mockImplementation((_id, r) => Promise.resolve({ reactions: counts({ love: 3 }), reactionCount: 3, myReaction: r }));
    const { result } = renderHook(() => useConfessionReactions(), { wrapper });
    act(() => {
      result.current('c1', 'sad');
      result.current('c1', 'surprised');
      result.current('c1', 'love');
    });
    expect(feedOf(qc)[0].myReaction).toBe('love'); // the screen, at once
    await waitFor(() => expect(api.react).toHaveBeenCalledTimes(1));
    expect(api.react).toHaveBeenCalledWith('c1', 'love');
    expect(api.unreact).not.toHaveBeenCalled();
  });

  it('sends nothing when the taps end where the server already is', async () => {
    seed([C('c1')]);
    const { result } = renderHook(() => useConfessionReactions(), { wrapper });
    act(() => {
      result.current('c1', 'love');
      result.current('c1', null);
    });
    await new Promise((r) => { setTimeout(r, 400); });
    expect(api.react).not.toHaveBeenCalled();
    expect(api.unreact).not.toHaveBeenCalled();
    expect(feedOf(qc)[0]).toMatchObject({ myReaction: null, reactionCount: 2 });
  });
});

describe('applyLiveReactions', () => {
  it('takes everyone’s totals and keeps your own choice', () => {
    seed([C('c1', { myReaction: 'love', relatedByMe: true })]);
    applyLiveReactions(qc, { confessionId: 'c1', reactions: counts({ love: 2, sad: 4 }), reactionCount: 6, at: 10 });
    expect(feedOf(qc)[0]).toMatchObject({ reactionCount: 6, relateCount: 6, myReaction: 'love', reactions: { sad: 4 } });
  });

  it('never lets an older update overwrite a newer one', () => {
    seed([C('c-order')]);
    applyLiveReactions(qc, { confessionId: 'c-order', reactions: counts({ love: 5 }), reactionCount: 5, at: 200 });
    applyLiveReactions(qc, { confessionId: 'c-order', reactions: counts({ love: 3 }), reactionCount: 3, at: 100 });
    expect(feedOf(qc)[0].reactionCount).toBe(5);
  });

  it('drops your choice when the totals say it is gone (taken back on another device)', () => {
    seed([C('c-gone', { myReaction: 'sad', relatedByMe: true, reactions: counts({ love: 2, sad: 1 }), reactionCount: 3 })]);
    applyLiveReactions(qc, { confessionId: 'c-gone', reactions: counts({ love: 2 }), reactionCount: 2, at: 5 });
    expect(feedOf(qc)[0]).toMatchObject({ myReaction: null, relatedByMe: false, reactionCount: 2 });
  });

  it('leaves alone a confession your own request is about to settle', async () => {
    seed([C('c-busy')]);
    let finish;
    api.react.mockImplementation(() => new Promise((r) => { finish = r; }));
    const { result } = renderHook(() => useConfessionReactions(), { wrapper });
    act(() => result.current('c-busy', 'sad'));
    applyLiveReactions(qc, { confessionId: 'c-busy', reactions: counts({ love: 9 }), reactionCount: 9, at: 1 });
    expect(feedOf(qc)[0]).toMatchObject({ myReaction: 'sad', reactionCount: 3 });
    await waitFor(() => expect(api.react).toHaveBeenCalled());
    await act(async () => finish({ reactions: counts({ love: 9, sad: 1 }), reactionCount: 10, myReaction: 'sad' }));
    expect(feedOf(qc)[0]).toMatchObject({ myReaction: 'sad', reactionCount: 10 });
  });
});

describe('applySync', () => {
  it('puts new confessions on top, refreshes totals and drops what is gone', () => {
    seed([C('a'), C('b'), C('c')]);
    applySync(qc, {
      newer: [C('n1'), C('a')], // an id already held is not added twice
      hasMoreNewer: false,
      states: { a: { reactions: counts({ funny: 1 }), reactionCount: 1, myReaction: 'funny', relateCount: 1, relatedByMe: true } },
      gone: ['b'],
    });
    const feed = feedOf(qc);
    expect(feed.map((c) => c.id)).toEqual(['n1', 'a', 'c']);
    expect(feed[1]).toMatchObject({ reactionCount: 1, myReaction: 'funny' });
  });
});

describe('useConfessionsLive', () => {
  const fakeSocket = () => {
    const handlers = {};
    return {
      emit: vi.fn(),
      on: vi.fn((name, fn) => { handlers[name] = fn; }),
      off: vi.fn((name) => { delete handlers[name]; }),
      fire: (name, payload) => handlers[name]?.(payload),
    };
  };

  it('joins the room, applies its events, and leaves on unmount', () => {
    seed([C('c-live')]);
    const socket = fakeSocket();
    useGlobalSocketStore.setState({ socket, isConnected: true });
    const { unmount } = renderHook(() => useConfessionsLive(), { wrapper });
    expect(socket.emit).toHaveBeenCalledWith('confessions:join');
    act(() => socket.fire('domainEvent', {
      type: 'confession.reactions',
      data: { confessionId: 'c-live', reactions: counts({ love: 7 }), reactionCount: 7, at: 1 },
    }));
    expect(feedOf(qc)[0].reactionCount).toBe(7);
    unmount();
    expect(socket.emit).toHaveBeenLastCalledWith('confessions:leave');
    expect(socket.off).toHaveBeenCalledWith('domainEvent', expect.any(Function));
  });

  it('asks once what changed when it opens on a feed fetched earlier', async () => {
    seed([C('top', { createdAt: '2026-10-21T08:00:00.000Z' }), C('older')]);
    api.sync.mockResolvedValue({ newer: [C('fresh')], hasMoreNewer: false, states: {}, gone: [] });
    await new Promise((r) => { setTimeout(r, 5); }); // the cache predates the mount
    renderHook(() => useConfessionsLive(), { wrapper });
    await waitFor(() => expect(api.sync).toHaveBeenCalledTimes(1));
    expect(api.sync).toHaveBeenCalledWith({ after: '2026-10-21T08:00:00.000Z|top', ids: ['top', 'older'] });
    await waitFor(() => expect(feedOf(qc).map((c) => c.id)).toEqual(['fresh', 'top', 'older']));
  });
});
