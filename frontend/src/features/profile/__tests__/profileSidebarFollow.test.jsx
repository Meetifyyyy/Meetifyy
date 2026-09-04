/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The profile right sidebar, end to end from the API payload to the button.
 *
 * Two behaviours are asserted, and they are the ones that were reported:
 *
 *   1. Following a recommended account does NOT remove it from the panel. It
 *      stays where it is and its button becomes "Following". The list is only
 *      re-generated on a fresh fetch.
 *   2. An account the payload says is already followed renders "Following" on
 *      first paint — no profile lookup, no "Follow" flash.
 *
 * The old implementation failed both: it filtered followed accounts (and
 * accounts with a pending follow intent) out of the list, and it read follow
 * state from a payload that never carried it.
 */

const followMock = vi.fn().mockResolvedValue({ success: true, isFollowing: true });
const unfollowMock = vi.fn().mockResolvedValue({ success: true, isFollowing: false });
const getByUsernameMock = vi.fn();
const getRecommendationsMock = vi.fn();

vi.mock('@shared/api/apiClient', () => ({
  apiClient: { get: async () => ({}), post: async () => ({}) },
  usersApi: {
    getRecommendations: (...a) => getRecommendationsMock(...a),
    getByUsername: (...a) => getByUsernameMock(...a),
    follow: (...a) => followMock(...a),
    unfollow: (...a) => unfollowMock(...a),
  },
  getMediaUrl: (v) => v,
}));

const currentUser = { id: 'me', username: 'me', displayName: 'Me', followingList: [] };
const updateCurrentUser = vi.fn();

vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser, updateCurrentUser, isLoggedIn: true }),
}));

// The communities half of the sidebar is exercised by its own test; an empty
// list keeps this one focused on the follow panel.
vi.mock('@shared/hooks/useCommunityRecommendations', () => ({
  useCommunityRecommendations: () => ({
    recommendations: [],
    isLoading: false,
    isError: false,
  }),
}));
vi.mock('@features/communities/hooks/useJoinCommunity', () => ({
  useJoinCommunity: () => ({ mutate: vi.fn(), isLoading: false }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/profile/me' }),
}));

// Renders no text: the real Avatar shows initials, and echoing the display
// name here would make every `getByText(name)` ambiguous.
vi.mock('@shared/components/avatar/Avatar', () => ({
  default: () => <span data-testid="avatar" />,
}));
vi.mock('@shared/components/badges/CollegeRepresentativeBadge', () => ({
  CollegeRepresentativeBadge: () => null,
}));

import ProfileRightSidebar from '../components/ProfileRightSidebar';
import { toggleRegistry } from '@shared/utils/mutationRegistry';

/**
 * The row for one suggested account, found by its @handle and then walked up
 * to the nearest ancestor that owns a button — the card itself.
 */
function rowFor(username) {
  let node = screen.queryByText(`@${username}`);
  while (node && node !== document.body) {
    if (node.querySelector?.('button')) return node;
    node = node.parentElement;
  }
  return null;
}

function buttonFor(username) {
  return rowFor(username)?.querySelector('button') ?? null;
}

function renderSidebar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ProfileRightSidebar embedded />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

/** Let the recommendations query resolve and paint. */
async function settle() {
  await screen.findByText('Ann');
}

/**
 * Real timers throughout, and a wait long enough to clear the 300ms coalescing
 * debounce in useFollowMutation. Faking timers here fought the query client's
 * own scheduling and left the panel unrendered.
 */
async function settleMutation() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 450));
  });
}

describe('ProfileRightSidebar — who to follow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ['ann', 'bob', 'cal'].forEach((u) => toggleRegistry.clear(`follow:${u}`));
    getByUsernameMock.mockResolvedValue({ username: 'x', isFollowing: false });
    getRecommendationsMock.mockResolvedValue([
      { id: '1', username: 'ann', displayName: 'Ann', isFollowing: false },
      { id: '2', username: 'bob', displayName: 'Bob', isFollowing: false },
      { id: '3', username: 'cal', displayName: 'Cal', isFollowing: false },
    ]);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('asks the server for the suggestions instead of deriving them client-side', async () => {
    renderSidebar();
    await settle();

    expect(getRecommendationsMock).toHaveBeenCalledWith(3);
    expect(screen.getByText('Ann')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('Cal')).toBeTruthy();
  });

  it('renders each suggestion with a Follow button and no per-row profile fetch', async () => {
    renderSidebar();
    await settle();

    expect(buttonFor('ann').textContent).toBe('Follow');
    // The payload carries follow state, so the button has nothing to look up.
    // Every row used to issue its own GET /api/users/:username.
    expect(getByUsernameMock).not.toHaveBeenCalled();
  });

  it('KEEPS a followed account in the list and flips its button to Following', async () => {
    renderSidebar();
    await settle();

    await act(async () => {
      fireEvent.click(buttonFor('ann'));
    });

    // The row is still there — this is the behaviour change that was asked
    // for. The old panel filtered on the pending intent and the account
    // vanished on click.
    expect(screen.getByText('Ann')).toBeTruthy();
    expect(buttonFor('ann').textContent).toBe('Following');

    // And the others are untouched.
    expect(buttonFor('bob').textContent).toBe('Follow');
    expect(buttonFor('cal').textContent).toBe('Follow');
  });

  it('does not re-fetch the suggestion list after a follow', async () => {
    renderSidebar();
    await settle();

    expect(getRecommendationsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(buttonFor('ann'));
    });
    // Past the 300ms coalescing debounce, so the request has actually gone.
    await settleMutation();

    expect(followMock).toHaveBeenCalledTimes(1);
    // Rebuilding the list here is what used to make the account disappear.
    expect(getRecommendationsMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Ann')).toBeTruthy();
  });

  it('shows Following on first paint for an account the payload reports as followed', async () => {
    getRecommendationsMock.mockResolvedValue([
      { id: '1', username: 'ann', displayName: 'Ann', isFollowing: true },
    ]);

    renderSidebar();
    await screen.findByText('Ann');

    expect(buttonFor('ann').textContent).toBe('Following');
    expect(getByUsernameMock).not.toHaveBeenCalled();
  });

  it('survives follow → unfollow → follow with one request per settled intent', async () => {
    renderSidebar();
    await settle();

    await act(async () => {
      fireEvent.click(buttonFor('ann'));
    });
    await settleMutation();
    expect(buttonFor('ann').textContent).toBe('Following');

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

    expect(followMock).toHaveBeenCalledTimes(2);
    expect(unfollowMock).toHaveBeenCalledTimes(1);
  });

  it('coalesces a rapid burst of clicks into ONE request matching the final intent', async () => {
    renderSidebar();
    await settle();

    await act(async () => {
      const btn = () => buttonFor('ann');
      fireEvent.click(btn()); // follow
      fireEvent.click(btn()); // unfollow
      fireEvent.click(btn()); // follow
    });
    await settleMutation();

    expect(buttonFor('ann').textContent).toBe('Following');
    expect(followMock).toHaveBeenCalledTimes(1);
    expect(unfollowMock).not.toHaveBeenCalled();
  });
});
