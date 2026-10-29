/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const getInvitePreview = vi.fn();
const joinGroup = vi.fn();

vi.mock('@shared/utils/MediaCacheManager', () => ({
  mediaCache: { getSyncUrl: (v) => v, getUrl: vi.fn(async (v) => v), invalidate: vi.fn() },
}));
vi.mock('@shared/hooks/useSignedMediaSrc', () => ({
  useSignedMediaSrc: (value) => ({ src: value || '', failed: false, pending: false, attempt: 0, refresh: vi.fn() }),
}));
vi.mock('@shared/api/apiClient', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    groupApi: {
      ...actual.groupApi,
      getInvitePreview: (...a) => getInvitePreview(...a),
      joinGroup: (...a) => joinGroup(...a),
    },
  };
});

import MessageBubble from '../MessageBubble';

/**
 * A group invite card in a chat always offers "View group", an expired one
 * included: what the invite still allows is the preview's to say, from the
 * server. The card no longer asks the server anything, or joins, by itself.
 */
const ME = { id: 'me' };
const HOUR = 60 * 60 * 1000;

const card = (over = {}) => ({
  id: 'msg-7',
  senderId: 'them',
  senderName: 'Asha',
  status: 'sent',
  createdAt: new Date().toISOString(),
  inviteData: { type: 'group_invite', groupId: 'g1', groupName: 'Night Owls' },
  ...over,
});

function mount(msg) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <MessageBubble msg={msg} currentUser={ME} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getInvitePreview.mockReset();
  joinGroup.mockReset();
  getInvitePreview.mockResolvedValue({
    id: 'g1', publicId: 'g1', name: 'Night Owls', memberCount: 4, memberPreview: [],
    joinState: 'INVITE_EXPIRED', invite: { status: 'EXPIRED' },
  });
});
afterEach(cleanup);

describe('group invite card', () => {
  it('says "View group" and asks nothing until it is opened', () => {
    mount(card());
    expect(screen.getByRole('button', { name: 'View group' })).toBeTruthy();
    expect(getInvitePreview).not.toHaveBeenCalled();
    expect(joinGroup).not.toHaveBeenCalled();
  });

  it('says "View group" for an expired invite too, with no expiry notice in the chat', () => {
    mount(card({
      createdAt: new Date(Date.now() - 72 * HOUR).toISOString(),
      inviteData: {
        type: 'group_invite', groupId: 'g1', groupName: 'Night Owls',
        expiresAt: new Date(Date.now() - 24 * HOUR).toISOString(), isExpired: true,
      },
    }));
    expect(screen.getByRole('button', { name: 'View group' }).disabled).toBe(false);
    expect(screen.queryByText(/expired/i)).toBeNull();
  });

  it('opens the group preview for this card, which shows what the invite allows', async () => {
    mount(card());
    fireEvent.click(screen.getByRole('button', { name: 'View group' }));
    expect(await screen.findByRole('dialog', { name: 'Group invite' })).toBeTruthy();
    expect((await screen.findByRole('button', { name: 'Invite link expired' })).disabled).toBe(true);
    expect(getInvitePreview).toHaveBeenCalledWith('g1', { messageId: 'msg-7' });
  });

  it('waits for the send to be confirmed: an optimistic card has no id to check', () => {
    mount(card({ id: 'temp_1', status: 'sending' }));
    expect(screen.getByRole('button', { name: 'View group' }).disabled).toBe(true);
  });
});
