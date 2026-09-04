/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The community list is mirrored into IndexedDB so it can paint before the
 * network answers. The mirror carries per-viewer membership (`isJoined`,
 * `userRole`), which means a stale mirror does not just show old member counts
 * — it shows a community the viewer has joined as "Join".
 *
 * `setQueryData` stamps what it writes as fetched NOW, and the query's
 * five-minute `staleTime` then saw a fresh entry and skipped the revalidating
 * fetch entirely. Backdating the seed makes it stale on arrival: it still
 * paints instantly, and the fetch still runs.
 *
 * The path that makes this reachable is the cold page load. The hydration
 * effect has an empty dependency list, so it runs whether or not the query is
 * enabled — and the query is gated on `isLoggedIn`, which is false until the
 * auth session resolves. So the order on a real reload is:
 *
 *   mount (disabled, no fetch) -> mirror seeds the cache -> session resolves
 *   -> query enables, finds "fresh" data, asks for nothing.
 *
 * Five minutes of a community the viewer joined last session reading "Join".
 * These tests reproduce that order rather than the convenient one, because in
 * the convenient order — enabled from the first render — the fetch is already
 * in flight before the mirror lands and the bug cannot appear.
 */

const getAllMock = vi.fn();
const idbGetMock = vi.fn();

vi.mock('@shared/api/apiClient', () => ({
  apiClient: { get: async () => ({}), post: async () => ({}) },
  communitiesApi: {
    getAll: (...a) => getAllMock(...a),
    getCampusCommunities: async () => [],
  },
  getMediaUrl: (v) => v,
}));

vi.mock('@shared/lib/idb', () => ({
  idbGet: (...a) => idbGetMock(...a),
  idbSet: async () => undefined,
  idbDelete: async () => undefined,
}));

let isLoggedIn = false;
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { id: 'me', username: 'me' }, isLoggedIn }),
}));

import { useCommunities, COMMUNITY_KEYS } from '../useCommunities';

const STALE_MIRROR = [{ id: 'c1', name: 'Chess Club', memberCount: 30, isJoined: false }];
const FRESH_SERVER = [{ id: 'c1', name: 'Chess Club', memberCount: 31, isJoined: true }];

let seen = [];
function Probe() {
  const { communities } = useCommunities();
  seen.push(communities);
  return null;
}

function renderProbe() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>,
  );
  /** The auth session resolving, which is what enables the query. */
  const signIn = async () => {
    isLoggedIn = true;
    await act(async () => {
      utils.rerender(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
  };
  return { queryClient, signIn };
}

describe('useCommunities — IndexedDB hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seen = [];
    isLoggedIn = false;
    getAllMock.mockResolvedValue(FRESH_SERVER);
    idbGetMock.mockResolvedValue({ value: STALE_MIRROR });
  });

  afterEach(cleanup);

  it('paints the mirror before the session resolves, without fetching', async () => {
    const { queryClient } = renderProbe();

    await waitFor(() =>
      expect(queryClient.getQueryData(COMMUNITY_KEYS.all)).toEqual(STALE_MIRROR),
    );
    expect(getAllMock).not.toHaveBeenCalled();
  });

  it('revalidates once the session resolves, even though the mirror already filled the cache', async () => {
    const { queryClient, signIn } = renderProbe();

    await waitFor(() =>
      expect(queryClient.getQueryData(COMMUNITY_KEYS.all)).toEqual(STALE_MIRROR),
    );

    await signIn();

    // Without the backdated seed the query counts as fresh here and this
    // request is never made — the pre-join rows simply stand.
    await waitFor(() => expect(getAllMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(queryClient.getQueryData(COMMUNITY_KEYS.all)).toEqual(FRESH_SERVER),
    );

    // The end state is the server's, not the mirror's: a community joined in a
    // previous session reads as joined again after the reload.
    const latest = seen[seen.length - 1];
    expect(latest[0].isJoined).toBe(true);
    expect(latest[0].memberCount).toBe(31);
  });

  it('does not overwrite a network response that landed first', async () => {
    // The mirror read resolves after the fetch. The newer data must win.
    let releaseIdb;
    idbGetMock.mockReturnValue(new Promise((r) => { releaseIdb = r; }));
    isLoggedIn = true;

    const { queryClient } = renderProbe();
    await waitFor(() =>
      expect(queryClient.getQueryData(COMMUNITY_KEYS.all)).toEqual(FRESH_SERVER),
    );

    releaseIdb({ value: STALE_MIRROR });
    await new Promise((r) => setTimeout(r, 0));

    expect(queryClient.getQueryData(COMMUNITY_KEYS.all)).toEqual(FRESH_SERVER);
  });
});
