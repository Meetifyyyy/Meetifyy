/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * A profile answer that is NEWER than the shared follow entry must be able to
 * correct it, and an OLDER one must never beat a click.
 *
 * The bug: `useProfile` rehydrates the profile from IndexedDB (true `storedAt`)
 * before the network answers. That copy filled the follow entry, `needsLookup`
 * turned false, and the fresh network profile (`followRequested: true`) was
 * never folded in -- after a reload the button said Follow for an account the
 * viewer had already requested.
 *
 * Real button, real mutation, real serial toggle, real followState. The
 * profile "network answer" is a `setQueryData` with a newer `updatedAt`, which
 * is what `useProfile`'s queryFn resolving does to the cache.
 */

const h = vi.hoisted(() => ({
  follow: vi.fn(),
  unfollow: vi.fn(),
  getByUsername: vi.fn(),
  acceptFollowRequest: vi.fn(),
  updateCurrentUser: vi.fn(),
  idbSet: vi.fn(async () => {}),
}));

vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { id: 'me', username: 'me', followingList: [] },
    updateCurrentUser: h.updateCurrentUser,
  }),
}));
vi.mock('@shared/api/apiClient', () => ({
  usersApi: {
    follow: (...a) => h.follow(...a),
    unfollow: (...a) => h.unfollow(...a),
    getByUsername: (...a) => h.getByUsername(...a),
    acceptFollowRequest: (...a) => h.acceptFollowRequest(...a),
  },
}));
vi.mock('@shared/lib/idb', () => ({
  idbEpoch: () => 7,
  bumpIdbEpoch: () => {},
  idbGet: async () => null,
  idbSet: (...a) => h.idbSet(...a),
  idbDelete: async () => {},
}));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));
vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: () => {} }));
vi.mock('@shared/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));
vi.mock('@shared/hooks/useSheetDrag', () => ({ useSheetDrag: () => ({ current: null }) }));

import FollowButton from '../FollowButton';
import { useAnswerFollowRequest } from '@shared/hooks/useFollowRequests';
import { toggleRegistry } from '@shared/utils/mutationRegistry';
import { __resetSerialToggles } from '@shared/utils/serialToggle';
import { PROFILE_KEYS, useProfile } from '@shared/hooks/useProfile';
import { followStateKey } from '@shared/utils/followState';

let qc;
const mount = (ui) => render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);

/** A network answer: resolves a few ms later, so it is stamped after the saved copy was folded. */
const answers = (profile) => () => new Promise((r) => setTimeout(() => r(profile), 10));

const label = () => document.querySelector('button')?.textContent;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const HOUR = 60 * 60 * 1000;

const meProfile = { username: 'me', stats: { following: 5, followers: 2 }, followingList: [] };
const asha = (extra = {}) => ({ username: 'asha', isFollowing: false, stats: { followers: 10 }, ...extra });

/** What `useProfile`'s IndexedDB hydration does: the saved copy, with its own old timestamp. */
const rehydrate = (profile, ageMs = HOUR) =>
  act(async () => {
    qc.setQueryData(PROFILE_KEYS.byUsername('asha'), profile, { updatedAt: Date.now() - ageMs });
  });
/** What `useProfile`'s queryFn resolving does: the network answer, stamped now. */
const networkAnswer = (profile) =>
  act(async () => {
    qc.setQueryData(PROFILE_KEYS.byUsername('asha'), profile);
  });

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.follow.mockReset();
  h.unfollow.mockReset();
  h.getByUsername.mockReset();
  h.acceptFollowRequest.mockReset();
  h.updateCurrentUser.mockReset();
  h.idbSet.mockClear();
  toggleRegistry.clear('follow:asha');
  __resetSerialToggles();
  qc.setQueryData(PROFILE_KEYS.byUsername('me'), meProfile);
});
afterEach(cleanup);

describe('FollowButton - a newer profile answer corrects the entry', () => {
  it('stale rehydrated copy (not requested) then the network profile (requested) ends on Requested', async () => {
    // No caller-supplied state: the button looks the profile up itself.
    await rehydrate(asha({ followRequested: false }));
    h.getByUsername.mockImplementation(answers(asha({ followRequested: true })));
    mount(<FollowButton targetUsername="asha" />);

    await waitFor(() => expect(h.getByUsername).toHaveBeenCalled());
    await flush();

    expect(label()).toBe('Requested');
    expect(qc.getQueryData(followStateKey('asha'))).toBe('requested');
  });

  it('the same, when another hook (useProfile) fetches and the button only reads the cache', async () => {
    // A caller supplied the answer, so the button's own lookup is disabled.
    mount(<FollowButton targetUsername="asha" initialFollowing={false} />);
    await rehydrate(asha({ followRequested: false }));
    await flush();
    expect(label()).toBe('Follow');

    await networkAnswer(asha({ followRequested: true }));
    await flush();

    expect(label()).toBe('Requested');
  });

  it('stale rehydrated isFollowing:false then the network isFollowing:true ends on Following', async () => {
    mount(<FollowButton targetUsername="asha" initialFollowing={false} />);
    await rehydrate(asha({ isFollowing: false }));
    await flush();
    expect(label()).toBe('Follow');

    await networkAnswer(asha({ isFollowing: true }));
    await flush();

    expect(label()).toBe('Following');
  });

  it('a request accepted while the viewer was away: stale Requested, network Following', async () => {
    h.getByUsername.mockImplementation(answers(asha({ isFollowing: true })));
    await rehydrate(asha({ followRequested: true }));
    mount(<FollowButton targetUsername="asha" />);
    await waitFor(() => expect(h.getByUsername).toHaveBeenCalled());
    await flush();

    expect(label()).toBe('Following');
  });

  it('the network answer that says the request is gone takes the button off Requested', async () => {
    h.getByUsername.mockImplementation(answers(asha({ followRequested: false })));
    await rehydrate(asha({ followRequested: true }));
    mount(<FollowButton targetUsername="asha" />);
    await waitFor(() => expect(h.getByUsername).toHaveBeenCalled());
    await flush();

    expect(label()).toBe('Follow');
  });
});

describe('FollowButton - an older profile never beats the viewer\'s click', () => {
  it('Follow -> Requested, then an OLDER rehydrated profile saying not-following: stays Requested', async () => {
    qc.setQueryData(PROFILE_KEYS.byUsername('asha'), asha({ isPrivate: true }));
    h.follow.mockResolvedValue({ success: true, isFollowing: false, requested: true });
    mount(<FollowButton targetUsername="asha" initialFollowing={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    await flush();
    expect(label()).toBe('Requested');

    // Opening the profile route rehydrates the copy saved before the tap.
    await rehydrate(asha({ isFollowing: false, followRequested: false }));
    await flush();

    expect(label()).toBe('Requested');
    expect(qc.getQueryData(followStateKey('asha'))).toBe('requested');
  });

  it('Follow -> Following, then an OLDER rehydrated profile saying not-following: stays Following', async () => {
    qc.setQueryData(PROFILE_KEYS.byUsername('asha'), asha());
    h.follow.mockResolvedValue({ success: true, isFollowing: true, requested: false });
    mount(<FollowButton targetUsername="asha" />);
    await waitFor(() => expect(label()).toBe('Follow'));

    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    await flush();
    expect(label()).toBe('Following');

    await rehydrate(asha({ isFollowing: false }));
    await flush();

    expect(label()).toBe('Following');
  });

  it('a profile that was fetched AFTER the click does correct it', async () => {
    qc.setQueryData(PROFILE_KEYS.byUsername('asha'), asha({ isPrivate: true }));
    h.follow.mockResolvedValue({ success: true, isFollowing: false, requested: true });
    mount(<FollowButton targetUsername="asha" initialFollowing={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    await flush();
    expect(label()).toBe('Requested');

    // The account accepted in the meantime; a later fetch says so.
    await networkAnswer(asha({ isFollowing: true }));
    await flush();

    expect(label()).toBe('Following');
  });
});

describe('the saved profile copy follows the tap', () => {
  it('re-persists the target profile after a request', async () => {
    qc.setQueryData(PROFILE_KEYS.byUsername('asha'), asha({ isPrivate: true }));
    h.follow.mockResolvedValue({ success: true, isFollowing: false, requested: true });
    mount(<FollowButton targetUsername="asha" initialFollowing={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    await flush();

    const saved = h.idbSet.mock.calls.find(([store, key]) => store === 'profiles' && key === 'asha');
    expect(saved).toBeTruthy();
    expect(saved[2]).toMatchObject({ username: 'asha', isFollowing: false, followRequested: true });
    // The clear-generation travels with it, so a logout in between drops the write.
    expect(saved[3]).toBe(7);
  });

  it('persists the viewer\'s own profile too when a follow moves their following count', async () => {
    qc.setQueryData(PROFILE_KEYS.byUsername('asha'), asha());
    h.follow.mockResolvedValue({ success: true, isFollowing: true, requested: false });
    mount(<FollowButton targetUsername="asha" initialFollowing={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    await flush();

    const mine = h.idbSet.mock.calls.find(([store, key]) => store === 'profiles' && key === 'me');
    expect(mine?.[2].stats.following).toBe(6);
    const theirs = h.idbSet.mock.calls.find(([store, key]) => store === 'profiles' && key === 'asha');
    expect(theirs?.[2].isFollowing).toBe(true);
  });

  it('writes nothing for a profile that is not cached', async () => {
    h.follow.mockResolvedValue({ success: true, isFollowing: true, requested: false });
    qc.removeQueries({ queryKey: PROFILE_KEYS.byUsername('me') });
    mount(<FollowButton targetUsername="asha" initialFollowing={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    await flush();

    expect(h.idbSet).not.toHaveBeenCalled();
  });

  it('accepting a request re-persists the viewer\'s own profile with the new follower count', async () => {
    h.acceptFollowRequest.mockResolvedValue({ success: true, followersCount: 3 });
    const { result } = renderHook(() => useAnswerFollowRequest(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });

    await act(async () => {
      result.current.accept.mutate('user-9');
    });
    await flush();

    const mine = h.idbSet.mock.calls.find(([store, key]) => store === 'profiles' && key === 'me');
    expect(mine?.[2].stats.followers).toBe(3);
  });
});

/**
 * A profile that is being fetched while the viewer taps. The fetch is the real
 * `useProfile` queryFn (so it stamps `_requestedAt` itself) and the button
 * reads the result from the cache, as it does on the profile page.
 */
function ProfileWithButton() {
  useProfile('asha');
  return <FollowButton targetUsername="asha" initialFollowing={false} />;
}
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe('FollowButton - a request STARTED before the click never overrides it', () => {
  it('fetch starts, the viewer taps and the request settles, the earlier fetch resolves not-following: stays Requested', async () => {
    let finishEarlierFetch;
    h.getByUsername.mockImplementationOnce(
      () => new Promise((resolve) => { finishEarlierFetch = () => resolve(asha({ isFollowing: false })); }),
    );
    h.follow.mockResolvedValue({ success: true, isFollowing: false, requested: true });
    mount(<ProfileWithButton />);
    await waitFor(() => expect(h.getByUsername).toHaveBeenCalledTimes(1));
    await wait(10);

    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    await wait(30);
    expect(label()).toBe('Requested');

    // The body was generated before the tap but arrives after the write settled.
    await act(async () => { finishEarlierFetch(); });
    await wait(30);

    expect(label()).toBe('Requested');
    expect(qc.getQueryData(followStateKey('asha'))).toBe('requested');
    // The stamp is what told them apart, and it is saved with the copy.
    const saved = h.idbSet.mock.calls.filter(([store, key]) => store === 'profiles' && key === 'asha');
    expect(saved.some(([, , data]) => typeof data._requestedAt === 'number')).toBe(true);
  });

  it('a fetch that starts AFTER the click is accepted', async () => {
    h.getByUsername.mockResolvedValueOnce(asha({ isFollowing: false, isPrivate: true }));
    h.follow.mockResolvedValue({ success: true, isFollowing: false, requested: true });
    mount(<ProfileWithButton />);
    await waitFor(() => expect(h.getByUsername).toHaveBeenCalledTimes(1));
    await wait(10);

    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    await wait(30);
    expect(label()).toBe('Requested');

    // The account accepted in the meantime; a profile requested after the tap says so.
    h.getByUsername.mockResolvedValueOnce(asha({ isFollowing: true }));
    await act(async () => { await qc.refetchQueries({ queryKey: PROFILE_KEYS.byUsername('asha') }); });
    await wait(30);

    expect(label()).toBe('Following');
  });
});
