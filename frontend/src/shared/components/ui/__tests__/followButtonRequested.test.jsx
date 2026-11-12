/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Follow / Requested / Following, with the real button, the real mutation and
 * the real serial toggle; only the network is a double.
 *
 * What is pinned: a private account turns Follow into Requested (and never
 * shows Follow in between), tapping Requested withdraws without asking,
 * tapping Following still asks, and the state seeds from a profile's
 * `followRequested`.
 */

const h = vi.hoisted(() => ({
  follow: vi.fn(),
  unfollow: vi.fn(),
  getByUsername: vi.fn(),
  updateCurrentUser: vi.fn(),
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
  },
}));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));
vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: () => {} }));
vi.mock('@shared/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));
vi.mock('@shared/hooks/useSheetDrag', () => ({ useSheetDrag: () => ({ current: null }) }));

import FollowButton from '../FollowButton';
import { toggleRegistry } from '@shared/utils/mutationRegistry';
import { __resetSerialToggles } from '@shared/utils/serialToggle';
import { PROFILE_KEYS } from '@shared/hooks/useProfile';
import { followStateKey } from '@shared/utils/followState';

let qc;
const mount = (ui) => render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);

/** A promise the test settles by hand, to look at the screen while a request is out. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Every label the button has shown, in order, from now on. */
function recordLabels() {
  const labels = [];
  const button = document.querySelector('button');
  const note = () => {
    const text = button?.textContent;
    if (text && labels[labels.length - 1] !== text) labels.push(text);
  };
  note();
  new MutationObserver(note).observe(button, { childList: true, characterData: true, subtree: true });
  return labels;
}

const label = () => document.querySelector('button')?.textContent;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const meProfile = { username: 'me', stats: { following: 5, followers: 2 }, followingList: [] };
const ashaProfile = (extra = {}) => ({
  username: 'asha',
  isFollowing: false,
  stats: { followers: 10 },
  ...extra,
});

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.follow.mockReset();
  h.unfollow.mockReset();
  h.getByUsername.mockReset();
  h.updateCurrentUser.mockReset();
  toggleRegistry.clear('follow:asha');
  __resetSerialToggles();
  qc.setQueryData(PROFILE_KEYS.byUsername('me'), meProfile);
});
afterEach(cleanup);

describe('FollowButton - requesting a private account', () => {
  it('shows Requested at once for a known-private account and keeps it when the server agrees', async () => {
    qc.setQueryData(PROFILE_KEYS.byUsername('asha'), ashaProfile({ isPrivate: true }));
    const request = deferred();
    h.follow.mockReturnValue(request.promise);
    mount(<FollowButton targetUsername="asha" initialFollowing={false} />);
    const labels = recordLabels();

    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    expect(label()).toBe('Requested');

    await act(async () => request.resolve({ success: true, isFollowing: false, requested: true }));
    await flush();

    expect(label()).toBe('Requested');
    expect(labels).toEqual(['Follow', 'Requested']);
    expect(qc.getQueryData(followStateKey('asha'))).toBe('requested');
  });

  it('settles an optimistic Following to Requested without passing through Follow, and undoes the counts', async () => {
    // Privacy unknown to the client: the tap guesses Following.
    qc.setQueryData(PROFILE_KEYS.byUsername('asha'), ashaProfile());
    const request = deferred();
    h.follow.mockReturnValue(request.promise);
    mount(<FollowButton targetUsername="asha" initialFollowing={false} />);
    const labels = recordLabels();

    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    expect(label()).toBe('Following');
    expect(qc.getQueryData(PROFILE_KEYS.byUsername('me')).stats.following).toBe(6);

    await act(async () => request.resolve({ success: true, isFollowing: false, requested: true }));
    await flush();

    expect(labels).toEqual(['Follow', 'Following', 'Requested']);
    const asha = qc.getQueryData(PROFILE_KEYS.byUsername('asha'));
    expect(asha.isFollowing).toBe(false);
    expect(asha.followRequested).toBe(true);
    // A request is not a follow: neither side's count moved.
    expect(asha.stats.followers).toBe(10);
    expect(qc.getQueryData(PROFILE_KEYS.byUsername('me')).stats.following).toBe(5);
  });

  it('a public account still ends on Following', async () => {
    qc.setQueryData(PROFILE_KEYS.byUsername('asha'), ashaProfile());
    h.follow.mockResolvedValue({ success: true, isFollowing: true, requested: false });
    mount(<FollowButton targetUsername="asha" initialFollowing={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    await flush();

    expect(label()).toBe('Following');
    expect(qc.getQueryData(PROFILE_KEYS.byUsername('me')).stats.following).toBe(6);
  });
});

describe('FollowButton - Requested and Following', () => {
  it('withdraws a request on the tap, with no question, and goes back to Follow', async () => {
    qc.setQueryData(PROFILE_KEYS.byUsername('asha'), ashaProfile({ followRequested: true }));
    h.unfollow.mockResolvedValue({ success: true, isFollowing: false, requested: false });
    mount(<FollowButton targetUsername="asha" />);
    await waitFor(() => expect(label()).toBe('Requested'));

    fireEvent.click(screen.getByRole('button', { name: 'Requested' }));

    expect(screen.queryByText('Unfollow @asha?')).toBeNull();
    expect(label()).toBe('Follow');
    await flush();
    expect(h.unfollow).toHaveBeenCalledTimes(1);
    expect(h.follow).not.toHaveBeenCalled();
    expect(label()).toBe('Follow');
    // Withdrawing a request is not an unfollow: the viewer's following count stays.
    expect(qc.getQueryData(PROFILE_KEYS.byUsername('me')).stats.following).toBe(5);
  });

  it('puts Requested back when the withdrawal fails', async () => {
    qc.setQueryData(PROFILE_KEYS.byUsername('asha'), ashaProfile({ followRequested: true }));
    h.unfollow.mockRejectedValue(new Error('network'));
    mount(<FollowButton targetUsername="asha" />);
    await waitFor(() => expect(label()).toBe('Requested'));

    fireEvent.click(screen.getByRole('button', { name: 'Requested' }));
    expect(label()).toBe('Follow');
    await flush();

    expect(label()).toBe('Requested');
  });

  it('still asks before unfollowing someone the viewer follows', async () => {
    qc.setQueryData(PROFILE_KEYS.byUsername('asha'), ashaProfile({ isFollowing: true }));
    mount(<FollowButton targetUsername="asha" />);
    await waitFor(() => expect(label()).toBe('Following'));

    fireEvent.click(screen.getByRole('button', { name: 'Following' }));

    expect(screen.getByText('Unfollow @asha?')).toBeTruthy();
    expect(h.unfollow).not.toHaveBeenCalled();
  });

  it('seeds Requested from the profile when no state was passed in', async () => {
    h.getByUsername.mockResolvedValue(ashaProfile({ followRequested: true }));
    mount(<FollowButton targetUsername="asha" />);

    await waitFor(() => expect(label()).toBe('Requested'));
  });

  it('a list row that only knows isFollowing=false does not take the button off Requested', async () => {
    qc.setQueryData(followStateKey('asha'), 'requested');
    mount(<FollowButton targetUsername="asha" initialFollowing={false} />);
    await flush();

    expect(label()).toBe('Requested');
  });
});
