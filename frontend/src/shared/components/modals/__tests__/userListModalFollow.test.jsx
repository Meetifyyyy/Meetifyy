/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The Followers / Following modal, and what an unfollow does to it.
 *
 * The modal never removed anyone itself — it renders whatever the infinite
 * query holds. Two things removed the row out from under it:
 *
 *   1. `useFollowMutation` invalidated ['following', me] with an ACTIVE
 *      refetch when the request settled. The server then correctly no longer
 *      returned the unfollowed account, so it vanished. An infinite query
 *      refetches every loaded page at once, so on a long list the whole thing
 *      was rebuilt and the scroll position moved with it.
 *   2. The socket echo of the viewer's own follow event did the same thing
 *      from `useGlobalSocketSync`, but only when it landed after the toggle
 *      registry had released its pending intent — which is what made the
 *      disappearance look intermittent.
 *
 * Both are now marked stale rather than refetched: the row stays, its button
 * changes, and the list is regenerated the next time the modal is opened.
 */

const getFollowingMock = vi.fn();
const getFollowersMock = vi.fn();
const followMock = vi.fn();
const unfollowMock = vi.fn();
const getByUsernameMock = vi.fn();

vi.mock('@shared/api/apiClient', () => ({
  apiClient: { get: async () => ({}), post: async () => ({}) },
  usersApi: {
    getFollowers: (...a) => getFollowersMock(...a),
    getFollowing: (...a) => getFollowingMock(...a),
    follow: (...a) => followMock(...a),
    unfollow: (...a) => unfollowMock(...a),
    getByUsername: (...a) => getByUsernameMock(...a),
  },
  getMediaUrl: (v) => v,
}));

const currentUser = { id: 'me', username: 'me', displayName: 'Me', followingList: [] };
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser, updateCurrentUser: vi.fn(), isLoggedIn: true }),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

vi.mock('@shared/components/badges/CollegeRepresentativeBadge', () => ({
  CollegeRepresentativeBadge: () => null,
}));
// Renders no text: the real Avatar shows initials, and echoing the display
// name would make every getByText(name) ambiguous.
vi.mock('../../avatar/Avatar', () => ({ default: () => <span data-testid="avatar" /> }));

import UserListModal from '../UserListModal';
import { toggleRegistry } from '@shared/utils/mutationRegistry';

const ROWS = [
  { id: 'u1', username: 'ann', displayName: 'Ann', isFollowing: true },
  { id: 'u2', username: 'bob', displayName: 'Bob', isFollowing: true },
  { id: 'u3', username: 'cal', displayName: 'Cal', isFollowing: true },
];

/**
 * The row element itself, matched on its own class rather than "the nearest
 * ancestor that contains a button" — a row with no button (the viewer's own)
 * would otherwise walk up to the list container and pick up a neighbour's.
 */
function rowFor(username) {
  const handle = screen.queryByText(`@${username}`);
  return handle?.closest('[class*="userItem"]') ?? null;
}

const buttonFor = (username) => rowFor(username)?.querySelector('button') ?? null;

/** Every rendered @handle, in order. */
const renderedHandles = () =>
  Array.from(document.querySelectorAll('[class*="userUsername"]')).map(
    (n) => n.textContent,
  );

function renderModal({ type = 'following', queryClient } = {}) {
  const qc =
    queryClient ??
    new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <UserListModal type={type} profileUsername="me" onClose={() => {}} />
    </QueryClientProvider>,
  );
  return { queryClient: qc, ...utils };
}

/** Past the 300ms coalescing debounce, so the request has actually gone. */
async function settleMutation() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 450));
  });
}

describe('UserListModal — unfollowing from the list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ['ann', 'bob', 'cal'].forEach((u) => toggleRegistry.clear(`follow:${u}`));

    // jsdom has no IntersectionObserver; the modal uses one for infinite scroll.
    globalThis.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

    followMock.mockResolvedValue({ success: true, isFollowing: true });
    unfollowMock.mockResolvedValue({ success: true, isFollowing: false });
    getByUsernameMock.mockResolvedValue({ username: 'x', isFollowing: false });
    // Modelled on the real endpoint: once an account is unfollowed the server
    // stops returning it from the viewer's Following list. That is what makes
    // these tests meaningful — the row has to survive on screen even though a
    // refetch would legitimately drop it.
    getFollowingMock.mockImplementation(async () => {
      const gone = unfollowMock.mock.calls.map((c) => c[0]);
      return ROWS.filter((u) => !gone.includes(u.username));
    });
    getFollowersMock.mockResolvedValue(ROWS);
  });

  afterEach(cleanup);

  it('KEEPS the row in the Following list and only flips its button', async () => {
    renderModal({ type: 'following' });
    await screen.findByText('@ann');
    expect(buttonFor('ann').textContent).toBe('Following');

    await act(async () => {
      fireEvent.click(buttonFor('ann'));
    });

    expect(screen.getByText('@ann')).toBeTruthy();
    await waitFor(() => expect(buttonFor('ann')?.textContent).toBe('Follow'));
    await settleMutation();

    // Still there after the request settles, which is when the refetch used
    // to fire and take it away.
    expect(screen.getByText('@ann')).toBeTruthy();
    expect(buttonFor('ann').textContent).toBe('Follow');
    expect(unfollowMock).toHaveBeenCalledTimes(1);
  });

  it('leaves the list order and length untouched, so nothing shifts', async () => {
    renderModal({ type: 'following' });
    await screen.findByText('@ann');
    const before = renderedHandles();

    await act(async () => {
      fireEvent.click(buttonFor('bob'));
    });
    await settleMutation();

    expect(renderedHandles()).toEqual(before);
    expect(renderedHandles()).toEqual(['@ann', '@bob', '@cal']);
  });

  it('does not refetch the list', async () => {
    renderModal({ type: 'following' });
    await screen.findByText('@ann');
    expect(getFollowingMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(buttonFor('ann'));
    });
    await settleMutation();

    // An active refetch here is what rebuilt every loaded page and moved the
    // scroll position.
    expect(getFollowingMock).toHaveBeenCalledTimes(1);
  });

  it('writes the new state into the cached rows, so reopening does not show Following again', async () => {
    const { queryClient, unmount } = renderModal({ type: 'following' });
    await screen.findByText('@ann');

    await act(async () => {
      fireEvent.click(buttonFor('ann'));
    });
    await settleMutation();

    const cached = queryClient.getQueryData(['following', 'me']);
    const row = cached.pages.flat().find((u) => u.username === 'ann');
    // The row and the shared follow-state entry have to agree: FollowButton
    // seeds that entry from this value.
    expect(row.isFollowing).toBe(false);

    unmount();
  });

  it('regenerates the list on the next open, dropping the unfollowed account', async () => {
    const { queryClient, unmount } = renderModal({ type: 'following' });
    await screen.findByText('@ann');

    await act(async () => {
      fireEvent.click(buttonFor('ann'));
    });
    await settleMutation();
    unmount();

    // What the server would now answer.
    getFollowingMock.mockResolvedValue(ROWS.filter((u) => u.username !== 'ann'));

    renderModal({ type: 'following', queryClient });
    await waitFor(() => expect(getFollowingMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('@ann')).toBeNull());

    // The list was marked stale, not left fresh — this is where membership is
    // allowed to change.
    expect(renderedHandles()).toEqual(['@bob', '@cal']);
  });

  it('keeps the row and rolls the button back when the request fails', async () => {
    unfollowMock.mockRejectedValue(new Error('network down'));
    renderModal({ type: 'following' });
    await screen.findByText('@ann');

    await act(async () => {
      fireEvent.click(buttonFor('ann'));
    });
    await settleMutation();

    // The row must never disappear on an error path either.
    expect(screen.getByText('@ann')).toBeTruthy();
    await waitFor(() => expect(buttonFor('ann')?.textContent).toBe('Following'));
    expect(renderedHandles()).toEqual(['@ann', '@bob', '@cal']);
  });

  it('behaves the same in the Followers list', async () => {
    renderModal({ type: 'followers' });
    await screen.findByText('@ann');
    expect(getFollowersMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(buttonFor('ann'));
    });
    await settleMutation();

    expect(screen.getByText('@ann')).toBeTruthy();
    expect(buttonFor('ann').textContent).toBe('Follow');
    expect(getFollowersMock).toHaveBeenCalledTimes(1);
    expect(renderedHandles()).toEqual(['@ann', '@bob', '@cal']);
  });

  it('supports unfollow then follow again on the same row', async () => {
    renderModal({ type: 'following' });
    await screen.findByText('@ann');

    await act(async () => {
      fireEvent.click(buttonFor('ann'));
    });
    await settleMutation();
    expect(buttonFor('ann').textContent).toBe('Follow');

    await act(async () => {
      fireEvent.click(buttonFor('ann'));
    });
    await settleMutation();

    expect(buttonFor('ann').textContent).toBe('Following');
    expect(unfollowMock).toHaveBeenCalledTimes(1);
    expect(followMock).toHaveBeenCalledTimes(1);
    expect(renderedHandles()).toEqual(['@ann', '@bob', '@cal']);
  });

  it('does not show a follow button for the viewer themselves', async () => {
    getFollowingMock.mockResolvedValue([
      { id: 'me', username: 'me', displayName: 'Me', isFollowing: false },
      ...ROWS,
    ]);
    renderModal({ type: 'following' });
    await screen.findByText('@me');

    expect(buttonFor('me')).toBeNull();
  });
});
