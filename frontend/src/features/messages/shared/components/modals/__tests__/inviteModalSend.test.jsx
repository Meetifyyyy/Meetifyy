/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Sending invites from the group's Invite sheet: pick people, one button, one
 * request per person whether or not there is a chat with them yet.
 *
 * It used to look the chat up in the cached list and send into it, so a
 * person with no chat yet got a client-side "draft" id the server could not
 * resolve and the invite failed. Two requests for everyone else.
 */
const sendGroupInvite = vi.fn();
const startDM = vi.fn();
const sendMessage = vi.fn();
const getConnections = vi.fn();

vi.mock('@shared/api/apiClient', () => ({
  usersApi: { getConnections: (...a) => getConnections(...a) },
  groupApi: { getDetails: async () => ({ memberDetails: [] }) },
  dmApi: {
    sendGroupInvite: (...a) => sendGroupInvite(...a),
    startDM: (...a) => startDM(...a),
    sendMessage: (...a) => sendMessage(...a),
  },
}));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { id: 'me', username: 'me' }, isLoggedIn: true }),
}));
vi.mock('@shared/components/avatar/ShareModalAvatar', () => ({ default: () => <span /> }));

const { default: InviteModal } = await import('../InviteModal');

const GROUP = { id: 'g1', name: 'Weekend Hike', ownerId: 'me', members: [{ id: 'me' }] };

const renderModal = (group = GROUP) => {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <InviteModal isOpen onClose={onClose} group={group} />
    </QueryClientProvider>,
  );
  return { onClose };
};

const pick = async (name) => fireEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
const inviteButton = (name = /^Invite/) => screen.getByRole('button', { name });
const err = (fields) => Object.assign(new Error(fields.message || 'x'), fields);

beforeEach(() => {
  getConnections.mockResolvedValue([
    { id: 'u2', username: 'ana', displayName: 'Ana' },
    { id: 'u3', username: 'ben', displayName: 'Ben' },
  ]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Invite sheet: sending', () => {
  it('sends one request per picked person, with ids only, and marks each invited', async () => {
    sendGroupInvite.mockResolvedValue({ id: 'msg-1' });
    renderModal();
    await pick('Ana');
    await pick('Ben');
    fireEvent.click(inviteButton('Invite 2'));
    await screen.findByRole('button', { name: 'Invited' });
    expect(sendGroupInvite).toHaveBeenCalledTimes(2);
    const [arg] = sendGroupInvite.mock.calls[0];
    expect(arg).toEqual({ targetUserId: 'u2', groupId: 'g1', clientId: expect.stringMatching(/^inv_.+_u2$/) });
    expect(screen.getAllByText('Invited')).toHaveLength(3); // two people and the button
    expect(startDM).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('closes itself once everyone is invited', async () => {
    sendGroupInvite.mockResolvedValue({ id: 'msg-1' });
    const { onClose } = renderModal();
    await pick('Ana');
    fireEvent.click(inviteButton('Invite'));
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('a second tap while the first is out sends nothing more', async () => {
    let finish;
    sendGroupInvite.mockReturnValue(new Promise((r) => { finish = r; }));
    renderModal();
    await pick('Ana');
    const button = inviteButton('Invite');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(sendGroupInvite).toHaveBeenCalledTimes(1);
    finish({ id: 'msg-1' });
    await screen.findByRole('button', { name: 'Invited' });
  });

  it('someone who joined meanwhile reads "In group", not a failure', async () => {
    sendGroupInvite.mockRejectedValue(err({ status: 409, code: 'ALREADY_MEMBER' }));
    renderModal();
    await pick('Ana');
    fireEvent.click(inviteButton('Invite'));
    await screen.findByText('In group');
    expect(screen.queryByText('Not sent')).toBeNull();
  });

  it('a server without the invite route still delivers: chat found or created there, then sent, same id', async () => {
    sendGroupInvite.mockRejectedValue(err({ status: 404, message: 'Cannot POST /api/dm/invite' }));
    startDM.mockResolvedValue({ id: 'dm-1', publicId: 'dm-1' });
    sendMessage.mockResolvedValue({ id: 'msg-1' });
    renderModal();
    await pick('Ana');
    fireEvent.click(inviteButton('Invite'));
    await screen.findByRole('button', { name: 'Invited' });
    expect(startDM).toHaveBeenCalledWith('u2');
    const [convId, payload] = sendMessage.mock.calls[0];
    expect(convId).toBe('dm-1');
    expect(payload.clientId).toBe(sendGroupInvite.mock.calls[0][0].clientId);
    expect(payload.inviteData).toMatchObject({ type: 'group_invite', groupId: 'g1' });
  });

  it('a group that no longer exists is not mistaken for an old server', async () => {
    sendGroupInvite.mockRejectedValue(err({ status: 404, message: 'GROUP_NOT_FOUND' }));
    renderModal();
    await pick('Ana');
    fireEvent.click(inviteButton('Invite'));
    await screen.findByText('This group no longer exists.');
    expect(startDM).not.toHaveBeenCalled();
  });

  it('a failure is marked on the person, and the retry sends only them, under the same id', async () => {
    sendGroupInvite.mockImplementation(({ targetUserId }) =>
      targetUserId === 'u3' && sendGroupInvite.mock.calls.length <= 2
        ? Promise.reject(err({ status: 500 }))
        : Promise.resolve({ id: 'msg' }),
    );
    renderModal();
    await pick('Ana');
    await pick('Ben');
    fireEvent.click(inviteButton('Invite 2'));
    await screen.findByText('Not sent');
    fireEvent.click(inviteButton('Retry 1 invite'));
    await screen.findByRole('button', { name: 'Invited' });
    expect(sendGroupInvite).toHaveBeenCalledTimes(3);
    const ben = sendGroupInvite.mock.calls.filter(([a]) => a.targetUserId === 'u3');
    expect(ben[1][0].clientId).toBe(ben[0][0].clientId);
  });

  it.each([
    [err({ status: 403, code: 'NOT_A_MEMBER' }), 'You’re no longer in this group.'],
    [err({ status: 403, message: 'GROUP_CLOSED' }), 'This group has ended.'],
  ])('a refusal no retry can change stops the sheet and says why', async (refusal, text) => {
    sendGroupInvite.mockRejectedValue(refusal);
    renderModal();
    await pick('Ana');
    fireEvent.click(inviteButton('Invite'));
    await screen.findByText(text);
    expect(screen.queryByRole('button', { name: /Retry|Invite/ })).toBeNull();
    expect(screen.getByRole('option', { name: /Ana/ }).disabled).toBe(true);
  });

  it('a later opening is a new batch: a fresh id per person', async () => {
    sendGroupInvite.mockResolvedValue({ id: 'msg' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (isOpen) => (
      <QueryClientProvider client={client}>
        <InviteModal isOpen={isOpen} onClose={vi.fn()} group={GROUP} />
      </QueryClientProvider>
    );
    const { rerender } = render(tree(true));
    await pick('Ana');
    fireEvent.click(inviteButton('Invite'));
    await screen.findByRole('button', { name: 'Invited' });
    rerender(tree(false));
    rerender(tree(true));
    await pick('Ana');
    fireEvent.click(inviteButton('Invite'));
    await waitFor(() => expect(sendGroupInvite).toHaveBeenCalledTimes(2));
    expect(sendGroupInvite.mock.calls[1][0].clientId).not.toBe(sendGroupInvite.mock.calls[0][0].clientId);
  });
});

describe('Invite sheet: the group link', () => {
  it('with nobody picked, offers the group link', async () => {
    renderModal();
    await screen.findByRole('option', { name: /Ana/ });
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });

  it('the link row gives way to the Invite button once someone is picked', async () => {
    renderModal();
    await pick('Ana');
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
    expect(inviteButton('Invite')).toBeTruthy();
  });
});
