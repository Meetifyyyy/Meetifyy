/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({ following: vi.fn(), chats: vi.fn(), statuses: vi.fn() }));
vi.mock('@shared/api/apiClient', () => ({
  usersApi: { getFollowing: mocks.following },
  messagesApi: { getConversations: mocks.chats },
  activitiesApi: { getInvitationStatuses: mocks.statuses },
}));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { id: 'self', username: 'me' } }),
}));
vi.mock('@shared/components/avatar/ShareModalAvatar', () => ({ default: () => <span />, isGroupTarget: () => false }));

import InviteFriendsModal from '../InviteFriendsModal';

const person = (id) => ({ id, displayName: `Name ${id}`, username: id });
const dm = (id) => ({ id: `dm-${id}`, type: 'DM', isGroup: false, canSendMessages: true, targetUser: person(id) });
const group = { id: 'grp', type: 'GROUP', isGroup: true, name: 'Group', canSendMessages: true, targetUser: null };

function mount(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <InviteFriendsModal activityId="activity" onClose={onClose} onSendInvites={vi.fn().mockResolvedValue({})} {...props} />
    </QueryClientProvider>,
  );
  return { onClose };
}

beforeEach(() => {
  mocks.following.mockReset().mockResolvedValue([person('joined'), person('friend')]);
  mocks.chats.mockReset().mockResolvedValue([dm('friend'), dm('chat-only'), group]);
  mocks.statuses.mockReset().mockResolvedValue({
    joined: { status: 'MEMBER' },
    waiting: { status: 'PENDING' },
  });
});
afterEach(cleanup);

const option = (name) => screen.findByRole('option', { name: new RegExp(name) });

it('lists people the viewer follows and people they chat with, once each, never a group', async () => {
  mount();
  await option('Name friend');
  expect(screen.getAllByRole('option', { name: /Name friend/ })).toHaveLength(1);
  expect(screen.getByRole('option', { name: /Name chat-only/ })).toBeTruthy();
  expect(screen.getByRole('option', { name: /Name joined/ })).toBeTruthy();
  expect(screen.getAllByRole('option')).toHaveLength(3);
  // Asks the server for the eligible subset of both lists.
  expect(mocks.following).toHaveBeenCalledWith('me', 50, 0, true, '');
  expect(mocks.chats).toHaveBeenCalledWith(50, 0, true, '');
});

it('shows people already in the activity but will not let them be picked', async () => {
  const onSendInvites = vi.fn().mockResolvedValue({});
  mount({ onSendInvites });
  const joined = await option('Name joined');
  await waitFor(() => expect(joined.disabled).toBe(true));
  expect(joined.textContent).toContain('Joined');
  fireEvent.click(joined);
  expect(joined.getAttribute('aria-selected')).toBe('false');
  expect(screen.queryByRole('button', { name: /^Invite/ })).toBeNull();
});

it('invites exactly the picked people, then closes', async () => {
  const onSendInvites = vi.fn().mockResolvedValue({});
  const { onClose } = mount({ onSendInvites });
  fireEvent.click(await option('Name chat-only'));
  fireEvent.click(await option('Name friend'));
  fireEvent.click(screen.getByRole('button', { name: 'Invite 2' }));
  await waitFor(() => expect(onSendInvites).toHaveBeenCalledWith(['chat-only', 'friend']));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it('has no social-app buttons and no copy-link', async () => {
  mount();
  await option('Name friend');
  expect(screen.queryByText(/copy link|whatsapp|instagram|story/i)).toBeNull();
  expect(screen.queryByRole('button', { name: /copy/i })).toBeNull();
});

it('keeps the sheet open with the selection when sending fails', async () => {
  const { onClose } = mount({ onSendInvites: vi.fn().mockRejectedValue(new Error('offline')) });
  fireEvent.click(await option('Name friend'));
  fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn.t send/);
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('option', { name: /Name friend/ }).getAttribute('aria-selected')).toBe('true');
});

it('does not ask for invitation status when the activity does not exist yet', async () => {
  mount({ activityId: undefined });
  const friend = await option('Name friend');
  expect(mocks.statuses).not.toHaveBeenCalled();
  // Everyone can be picked straight away: nobody is in it yet but the host.
  expect(friend.disabled).toBe(false);
  expect((await option('Name joined')).disabled).toBe(false);
});

it('pages past the first 50 on "Show more"', async () => {
  mocks.statuses.mockResolvedValue({});
  mocks.chats.mockResolvedValue([]);
  mocks.following.mockImplementation(async (_u, _limit, offset) =>
    offset === 0 ? Array.from({ length: 50 }, (_, i) => person(`f${i}`)) : [person('last')]);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
  await option('Name last');
  expect(mocks.following).toHaveBeenCalledWith('me', 50, 50, true, '');
  // The exhausted chat list is not asked again.
  expect(mocks.chats).toHaveBeenCalledTimes(1);
});
