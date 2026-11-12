/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * A private account accepts the viewer's request: the server emits
 * `follow.created`, and the requester's Requested button must become Following
 * through the same shared follow state every button reads.
 */
const store = vi.hoisted(() => ({ socket: null, isConnected: false }));
const idb = vi.hoisted(() => ({ idbSet: vi.fn(async () => {}) }));

vi.mock('../../lib/idb', () => ({
  idbEpoch: () => 3,
  bumpIdbEpoch: () => {},
  idbGet: async () => null,
  idbSet: (...a) => idb.idbSet(...a),
  idbDelete: async () => {},
}));

vi.mock('../../stores/useGlobalSocketStore', () => ({
  useGlobalSocketStore: Object.assign((sel) => sel(store), { getState: () => store }),
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'me', username: 'me' } }) }));
vi.mock('../useMessages', () => ({ useConversations: () => ({ conversations: [] }) }));
vi.mock('../../../features/messages/shared/utils/outboxClient', () => ({ bindOutbox: vi.fn(), noteSocketConnected: vi.fn(), wakeOutbox: vi.fn(async () => {}), outbox: { flush: vi.fn(async () => {}) } }));

const { useGlobalSocketSync } = await import('../useGlobalSocketSync');
const { followStateKey, markFollowGraphChanged } = await import('../../utils/followState');
const { PROFILE_KEYS } = await import('../useProfile');

let handlers;
let qc;

function mount() {
  handlers = {};
  store.socket = {
    connected: true,
    on: vi.fn((event, fn) => { handlers[event] = fn; }),
    off: vi.fn(),
    emit: vi.fn(),
    timeout: () => ({ emit: () => {} }),
  };
  store.isConnected = true;
  qc = new QueryClient();
  renderHook(() => useGlobalSocketSync(), {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
}

const accepted = (followerId = 'me') => ({
  type: 'follow.created',
  data: {
    followerId,
    followingUsername: 'asha',
    followerStats: { followingCount: 4 },
    targetStats: { followersCount: 11 },
  },
});

beforeEach(() => {
  cleanup();
  localStorage.clear();
  mount();
});

describe('follow.created for an accepted request', () => {
  it('turns Requested into Following and clears followRequested on the profile', async () => {
    // The click that sent the request, a moment earlier.
    markFollowGraphChanged('asha');
    qc.setQueryData(followStateKey('asha'), 'requested');
    qc.setQueryData(PROFILE_KEYS.byUsername('asha'), {
      username: 'asha', isFollowing: false, followRequested: true, stats: { followers: 10 },
    });

    // The server's event is generated after the click, so it is provably newer.
    await new Promise((r) => setTimeout(r, 5));
    act(() => handlers.domainEvent(accepted()));

    expect(qc.getQueryData(followStateKey('asha'))).toBe(true);
    const profile = qc.getQueryData(PROFILE_KEYS.byUsername('asha'));
    expect(profile.isFollowing).toBe(true);
    expect(profile.followRequested).toBe(false);
    expect(profile.stats.followers).toBe(11);
  });

  it('re-persists the cached profiles, so a reload does not paint the pre-accept copy', async () => {
    markFollowGraphChanged('asha');
    qc.setQueryData(followStateKey('asha'), 'requested');
    qc.setQueryData(PROFILE_KEYS.byUsername('asha'), {
      username: 'asha', isFollowing: false, followRequested: true, stats: { followers: 10 },
    });
    qc.setQueryData(PROFILE_KEYS.byUsername('me'), { username: 'me', stats: { followers: 1, following: 3 } });
    idb.idbSet.mockClear();

    await new Promise((r) => setTimeout(r, 5));
    act(() => handlers.domainEvent(accepted()));

    const call = (key) => idb.idbSet.mock.calls.find(([store, k]) => store === 'profiles' && k === key);
    expect(call('asha')?.[2]).toMatchObject({ isFollowing: true, followRequested: false, stats: { followers: 11 } });
    expect(call('asha')?.[3]).toBe(3);
    expect(call('me')?.[2].stats.following).toBe(4);
  });

  it('writes nothing for a profile that is not cached', () => {
    idb.idbSet.mockClear();

    act(() => handlers.domainEvent(accepted()));

    expect(idb.idbSet).not.toHaveBeenCalled();
  });

  it('leaves the button alone when it is not showing Requested (an echo of an earlier follow)', () => {
    qc.setQueryData(followStateKey('asha'), false);

    act(() => handlers.domainEvent(accepted()));

    expect(qc.getQueryData(followStateKey('asha'))).toBe(false);
  });

  it('ignores another viewer being accepted', () => {
    qc.setQueryData(followStateKey('asha'), 'requested');

    act(() => handlers.domainEvent(accepted('someone-else')));

    expect(qc.getQueryData(followStateKey('asha'))).toBe('requested');
  });
});
