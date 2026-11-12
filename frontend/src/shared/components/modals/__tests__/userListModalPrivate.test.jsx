/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * A private account hands a non-follower an empty list (a bare array, no
 * flag), so the modal explains the emptiness from the profile it was given.
 */
const h = vi.hoisted(() => ({ getFollowers: vi.fn() }));

vi.mock('@shared/api/apiClient', () => ({
  usersApi: {
    getFollowers: (...a) => h.getFollowers(...a),
    getFollowing: (...a) => h.getFollowers(...a),
    getByUsername: vi.fn(),
  },
  getMediaUrl: (v) => v,
}));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { id: 'me', username: 'me' }, updateCurrentUser: vi.fn() }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@shared/components/badges/CollegeRepresentativeBadge', () => ({ CollegeRepresentativeBadge: () => null }));
vi.mock('../../avatar/Avatar', () => ({ default: () => <span /> }));
vi.mock('@shared/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));

import UserListModal from '../UserListModal';

beforeEach(() => {
  h.getFollowers.mockReset();
  h.getFollowers.mockResolvedValue([]);
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(cleanup);

function renderModal({ profileUser, profileUsername = 'asha', type = 'followers' }) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UserListModal type={type} profileUsername={profileUsername} profileUser={profileUser} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe('Followers / Following of a private account', () => {
  it('says the account is private to a non-follower', async () => {
    renderModal({ profileUser: { username: 'asha', isPrivate: true, isFollowing: false } });

    expect(await screen.findByText('This account is private')).toBeTruthy();
    expect(screen.queryByText('No followers yet')).toBeNull();
  });

  it('says it to a pending requester too, on either tab', async () => {
    renderModal({
      type: 'following',
      profileUser: { username: 'asha', settings: { privateProfile: true }, isFollowing: false, followRequested: true },
    });

    expect(await screen.findByText('This account is private')).toBeTruthy();
    expect(screen.queryByText('No following yet')).toBeNull();
  });

  it('keeps the plain empty state for a follower of a private account', async () => {
    renderModal({ profileUser: { username: 'asha', isPrivate: true, isFollowing: true } });

    expect(await screen.findByText('No followers yet')).toBeTruthy();
  });

  it('keeps the plain empty state for a public account', async () => {
    renderModal({ profileUser: { username: 'asha', isPrivate: false, isFollowing: false } });

    expect(await screen.findByText('No followers yet')).toBeTruthy();
  });

  it('keeps the plain empty state on the viewer\'s own private profile', async () => {
    renderModal({ profileUsername: 'me', profileUser: { username: 'me', isPrivate: true, isFollowing: false } });

    expect(await screen.findByText('No followers yet')).toBeTruthy();
  });
});
