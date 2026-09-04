/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Discover Communities, held to the same rule as "Who to follow": the item the
 * viewer acted on stays visible and immediately shows its new state, and the
 * LIST only changes on a fresh fetch.
 *
 * The failure modes covered here are the ones that class of bug produces:
 *
 *   - the panel is ranked by member count, and joining increments it, so
 *     re-deriving the slice on every render let a join re-sort the panel and
 *     swap out the card the viewer had just pressed;
 *   - invalidating the list with an active refetch did the same thing from the
 *     other direction, rebuilding it as soon as the request settled;
 *   - the list is mirrored into IndexedDB for first paint, and nothing dropped
 *     that mirror on a join, so a reload could restore the pre-join rows.
 *
 * `useCommunities` is deliberately NOT mocked. The optimistic join writes
 * through the real query cache, and a stubbed hook that ignored the cache
 * would hide exactly the propagation this panel depends on.
 */

const joinMock = vi.fn().mockResolvedValue({ success: true, isJoined: true });
const leaveMock = vi.fn().mockResolvedValue({ success: true, isJoined: false });
const idbDeleteMock = vi.fn().mockResolvedValue(undefined);
const getAllMock = vi.fn();

vi.mock('@shared/api/apiClient', () => ({
  apiClient: { get: async () => ({}), post: async () => ({}) },
  usersApi: { getRecommendations: async () => [], getByUsername: async () => ({}) },
  communitiesApi: {
    getAll: (...a) => getAllMock(...a),
    getCampusCommunities: async () => [],
    join: (...a) => joinMock(...a),
    leave: (...a) => leaveMock(...a),
  },
  getMediaUrl: (v) => v,
}));

vi.mock('@shared/lib/idb', () => ({
  idbGet: async () => null,
  idbSet: async () => undefined,
  idbDelete: (...a) => idbDeleteMock(...a),
}));

let currentUser = {
  id: 'me',
  username: 'me',
  verificationStatus: 'VERIFIED',
  followingList: [],
};

vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser, updateCurrentUser: vi.fn(), isLoggedIn: true }),
}));

vi.mock('@shared/hooks/useFollowSuggestions', () => ({
  useFollowSuggestions: () => ({ suggestions: [], isLoading: false, isError: false }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/profile/me' }),
}));

import ProfileRightSidebar from '../components/ProfileRightSidebar';
import { toggleRegistry } from '@shared/utils/mutationRegistry';
import { COMMUNITY_KEYS } from '@shared/hooks/useCommunities';

let communities = [];

function cardFor(name) {
  let node = screen.queryByText(name);
  while (node && node !== document.body) {
    if (node.querySelector?.('button, span[aria-label]')) return node;
    node = node.parentElement;
  }
  return null;
}

function actionFor(name) {
  const card = cardFor(name);
  return card?.querySelector('button') ?? card?.querySelector('span[aria-label]') ?? null;
}

/** The panel's card names, in the order they are rendered. */
function renderedNames() {
  return Array.from(document.querySelectorAll('h3'))
    .filter((h) => h.textContent === 'Discover Communities')
    .flatMap((h) =>
      Array.from(h.parentElement.children)
        .slice(1)
        .map((card) => card.querySelector('[class*="personName"]')?.textContent),
    );
}

async function renderSidebar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ProfileRightSidebar embedded />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(renderedNames().length).toBeGreaterThan(0));
  return { queryClient, ...utils };
}

async function settleMutation() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 450));
  });
}

/**
 * The join/leave debounce and its module-level timers are shared across every
 * component instance, so a test that clicks and returns without settling
 * leaves a request to fire during the NEXT test. Every test that clicks ends
 * by draining them.
 */
async function drainPendingToggles() {
  await settleMutation();
}

/**
 * An optimistic `setQueryData` reaches a mounted `useQuery` observer through
 * React Query's notify manager, which batches — so the re-render lands a tick
 * after the click, not inside it.
 */
async function expectAction(name, label) {
  await waitFor(() => expect(actionFor(name)?.textContent).toBe(label));
}

describe('ProfileRightSidebar — Discover Communities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = { id: 'me', username: 'me', verificationStatus: 'VERIFIED', followingList: [] };
    communities = [
      { id: 'c1', name: 'Chess Club', memberCount: 30, isJoined: false, userRole: null },
      { id: 'c2', name: 'Robotics', memberCount: 20, isJoined: false, userRole: null },
      { id: 'c3', name: 'Debate', memberCount: 10, isJoined: false, userRole: null },
    ];
    ['c1', 'c2', 'c3'].forEach((id) => toggleRegistry.clear(`joinCommunity:${id}`));
    getAllMock.mockImplementation(async () => communities);
  });

  afterEach(cleanup);

  it('shows the most popular communities with a Join button', async () => {
    await renderSidebar();

    expect(renderedNames()).toEqual(['Chess Club', 'Robotics', 'Debate']);
    expect(actionFor('Robotics').textContent).toBe('Join');
  });

  it('KEEPS a joined community in the list and flips its button to Joined', async () => {
    await renderSidebar();

    await act(async () => {
      fireEvent.click(actionFor('Debate'));
    });

    expect(screen.getByText('Debate')).toBeTruthy();
    await expectAction('Debate', 'Joined');
    expect(renderedNames()).toEqual(['Chess Club', 'Robotics', 'Debate']);
    await drainPendingToggles();
  });

  it('does not reorder the panel when a join changes the member count', async () => {
    communities = [
      { id: 'c1', name: 'Chess Club', memberCount: 12, isJoined: false, userRole: null },
      { id: 'c2', name: 'Robotics', memberCount: 11, isJoined: false, userRole: null },
      { id: 'c3', name: 'Debate', memberCount: 10, isJoined: false, userRole: null },
    ];
    const { queryClient } = await renderSidebar();

    await act(async () => {
      fireEvent.click(actionFor('Debate'));
    });

    // And then the list itself reports a much larger count for it, as a
    // refetch would after enough joins. Ranking is decided once per mount, so
    // this must not promote Debate past the others.
    await act(async () => {
      queryClient.setQueryData(COMMUNITY_KEYS.all, (old) =>
        old.map((c) => (c.id === 'c3' ? { ...c, memberCount: 999, isJoined: true } : c)),
      );
    });

    expect(renderedNames()).toEqual(['Chess Club', 'Robotics', 'Debate']);
    await drainPendingToggles();
  });

  it('does not refetch the whole list after a join', async () => {
    await renderSidebar();
    expect(getAllMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(actionFor('Robotics'));
    });
    await settleMutation();

    expect(joinMock).toHaveBeenCalledTimes(1);
    // Marked stale for the next mount, not rebuilt underneath the viewer.
    expect(getAllMock).toHaveBeenCalledTimes(1);
    await expectAction('Robotics', 'Joined');
  });

  it('drops the IndexedDB list mirror after a join, so a reload cannot restore the pre-join rows', async () => {
    await renderSidebar();

    await act(async () => {
      fireEvent.click(actionFor('Robotics'));
    });
    await settleMutation();

    expect(joinMock).toHaveBeenCalledWith('c2', expect.anything());
    expect(idbDeleteMock).toHaveBeenCalledWith('communities', 'all');
    expect(idbDeleteMock).toHaveBeenCalledWith('communities', 'campus');
  });

  it('coalesces a rapid join/leave/join burst into one request for the final intent', async () => {
    await renderSidebar();

    await act(async () => {
      fireEvent.click(actionFor('Robotics')); // join
      fireEvent.click(actionFor('Robotics')); // leave
      fireEvent.click(actionFor('Robotics')); // join
    });
    await settleMutation();

    await expectAction('Robotics', 'Joined');
    expect(joinMock).toHaveBeenCalledTimes(1);
    expect(leaveMock).not.toHaveBeenCalled();
  });

  it('renders an already-joined community as Joined from the payload', async () => {
    communities = [
      { id: 'c1', name: 'Chess Club', memberCount: 30, isJoined: true, userRole: 'MEMBER' },
    ];
    await renderSidebar();

    expect(actionFor('Chess Club').textContent).toBe('Joined');
  });

  it('gives the owner a static chip rather than a button the server would refuse', async () => {
    communities = [
      { id: 'c1', name: 'Chess Club', memberCount: 30, ownerId: 'me', userRole: 'OWNER' },
    ];
    await renderSidebar();

    expect(actionFor('Chess Club').textContent).toBe('Owner');
    expect(cardFor('Chess Club').querySelector('button')).toBeNull();
  });
});
