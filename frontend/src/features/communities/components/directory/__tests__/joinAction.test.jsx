/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The join control on Explore.
 *
 * The case that matters: a private community answers a join with a pending
 * request, not a membership. The old list card ran the optimistic join toggle
 * for every community, so a private one flipped to "Joined" and then snapped
 * back. Here it sends a request and settles on "Requested", and the shared
 * cache (including Explore's paged shape) records it.
 */

const joinMock = vi.fn();

vi.mock('@shared/api/apiClient', () => ({
  communitiesApi: {
    join: (...a) => joinMock(...a),
    leave: vi.fn(),
  },
  getMediaUrl: (v) => v,
}));
vi.mock('@shared/lib/idb', () => ({
  idbGet: async () => null,
  idbSet: async () => undefined,
  idbDelete: async () => undefined,
}));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));
vi.mock('@shared/stores/verificationModalStore', () => ({ openVerificationModal: vi.fn() }));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { id: 'me', verificationStatus: 'VERIFIED' }, isLoggedIn: true }),
}));

const { default: JoinAction } = await import('../JoinAction');
const { mapCommunityCache } = await import('../../../hooks/useJoinCommunity');

function renderWith(community, client = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <JoinAction community={community} />
    </QueryClientProvider>,
  );
  return client;
}

describe('JoinAction', () => {
  beforeEach(() => joinMock.mockReset());
  afterEach(cleanup);

  it('sends a request for a private community and settles on "Requested"', async () => {
    joinMock.mockResolvedValue({ success: true, status: 'PENDING', hasPendingRequest: true });
    const community = { id: 'p1', name: 'Quiet Room', isPrivate: true, isJoined: false };
    const client = new QueryClient();
    client.setQueryData(['communities', 'explore', {}], { pages: [[community]], pageParams: [0] });

    renderWith(community, client);
    fireEvent.click(screen.getByRole('button', { name: /request to join quiet room/i }));

    await waitFor(() => expect(screen.getByText('Requested')).toBeTruthy());
    expect(joinMock).toHaveBeenCalledWith('p1');
    const cached = client.getQueryData(['communities', 'explore', {}]).pages[0][0];
    expect(cached.hasPendingRequest).toBe(true);
    expect(cached.isJoined).toBe(false);
  });

  it('shows a pending request from the server without offering it again', () => {
    renderWith({ id: 'p2', name: 'X', isPrivate: true, hasPendingRequest: true });
    expect(screen.getByText('Requested')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows membership and ownership as settled states', () => {
    renderWith({ id: 'a', name: 'A', isJoined: true, userRole: 'MEMBER' });
    expect(screen.getByText('Joined')).toBeTruthy();
    cleanup();
    renderWith({ id: 'b', name: 'B', ownerId: 'me', isJoined: true });
    expect(screen.getByText('Owner')).toBeTruthy();
  });
});

describe('mapCommunityCache', () => {
  const bump = (c) => ({ ...c, n: 1 });

  it('updates plain lists and every page of an infinite query', () => {
    expect(mapCommunityCache([{ id: 'a' }], bump)).toEqual([{ id: 'a', n: 1 }]);
    expect(mapCommunityCache({ pages: [[{ id: 'a' }], [{ id: 'b' }]], pageParams: [0, 30] }, bump)).toEqual({
      pages: [[{ id: 'a', n: 1 }], [{ id: 'b', n: 1 }]],
      pageParams: [0, 30],
    });
  });

  it('leaves anything else untouched', () => {
    const detail = { id: 'a' };
    expect(mapCommunityCache(detail, bump)).toBe(detail);
    expect(mapCommunityCache(undefined, bump)).toBeUndefined();
  });
});
