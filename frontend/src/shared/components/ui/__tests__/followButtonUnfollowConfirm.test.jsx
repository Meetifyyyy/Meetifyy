/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({ follow: vi.fn(), unfollow: vi.fn(), state: true }));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: { username: 'me' } }) }));
vi.mock('@shared/hooks/useFollowMutation', () => ({ useFollowMutation: () => ({ follow: h.follow, unfollow: h.unfollow }) }));
vi.mock('@shared/hooks/useFollowState', () => ({ useFollowState: () => h.state }));
vi.mock('@shared/api/apiClient', () => ({ usersApi: { getByUsername: vi.fn() } }));
vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: () => {} }));
vi.mock('@shared/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));
vi.mock('@shared/hooks/useSheetDrag', () => ({ useSheetDrag: () => ({ current: null }) }));

import FollowButton from '../FollowButton';
import { toggleRegistry } from '@shared/utils/mutationRegistry';

const mount = (ui) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 320)); });

beforeEach(() => {
  h.follow.mockReset();
  h.unfollow.mockReset();
  h.state = true;
  toggleRegistry.clear('follow:asha');
});
afterEach(cleanup);

describe('FollowButton - unfollowing asks first', () => {
  it('asks, naming the account, instead of unfollowing on the tap', () => {
    mount(<FollowButton targetUsername="asha" initialFollowing />);
    fireEvent.click(screen.getByRole('button', { name: 'Following' }));

    expect(screen.getByText('Unfollow @asha?')).toBeTruthy();
    expect(document.body.textContent).toMatch(/no longer appear in your feed/i);
    expect(h.unfollow).not.toHaveBeenCalled();
  });

  it('unfollows only once confirmed', async () => {
    mount(<FollowButton targetUsername="asha" initialFollowing />);
    fireEvent.click(screen.getByRole('button', { name: 'Following' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unfollow' }));
    await settle();

    expect(h.unfollow).toHaveBeenCalledTimes(1);
    expect(h.follow).not.toHaveBeenCalled();
  });

  it('cancelling does nothing, and leaves no pending intent behind', async () => {
    mount(<FollowButton targetUsername="asha" initialFollowing />);
    fireEvent.click(screen.getByRole('button', { name: 'Following' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await settle();

    expect(h.unfollow).not.toHaveBeenCalled();
    expect(screen.queryByText('Unfollow @asha?')).toBeNull();
    expect(screen.getByRole('button', { name: 'Following' })).toBeTruthy(); // still shown as followed
  });

  it('following never asks', () => {
    h.state = false;
    mount(<FollowButton targetUsername="asha" initialFollowing={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));

    expect(screen.queryByText(/Unfollow/)).toBeNull();
    expect(h.follow).toHaveBeenCalledTimes(1);
  });

  it('a tap inside the sheet does not reach the card the button sits in', () => {
    const onCardClick = vi.fn();
    mount(
      <div onClick={onCardClick}>
        <FollowButton targetUsername="asha" initialFollowing />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Following' }));
    expect(onCardClick).not.toHaveBeenCalled(); // the button already stops it

    fireEvent.click(screen.getByText('Unfollow @asha?'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCardClick).not.toHaveBeenCalled();
  });
});
