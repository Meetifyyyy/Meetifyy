/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

/**
 * The group preview: what a chat's invite card, an invite link and a
 * group's address all open.
 *
 * - Its button is the server's answer (`joinState`), and an expired invite
 *   reads "Invite link expired" whatever the group's "Who can join" says.
 * - It names the invite it came through on every request, so the server
 *   can check it (a chat card by its message id, a link by its code).
 * - Joining is behind the live-selfie check: an unverified account gets the
 *   verification prompt and no request; a server 403 opens the same prompt.
 * - One tap is one request, and a failure shows a way to try again.
 */

const joinGroup = vi.fn();
const getInvitePreview = vi.fn();
const getInviteLinkPreview = vi.fn();
const openVerificationModal = vi.fn();
const showToast = vi.fn();
let currentUser = { id: 'me', verificationStatus: 'VERIFIED' };

vi.mock('@shared/api/apiClient', () => ({
  groupApi: {
    joinGroup: (...a) => joinGroup(...a),
    getInvitePreview: (...a) => getInvitePreview(...a),
    getInviteLinkPreview: (...a) => getInviteLinkPreview(...a),
  },
  getMediaUrl: (v) => v,
  deriveThumbnailKey: (v) => v,
}));
vi.mock('@shared/hooks/useMessages', () => ({
  MESSAGE_KEYS: { conversations: ['conversations'], history: (id) => ['history', id] },
}));
vi.mock('@shared/utils/toast', () => ({ showToast: (...a) => showToast(...a) }));
vi.mock('@shared/stores/verificationModalStore', () => ({
  openVerificationModal: (...a) => openVerificationModal(...a),
}));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser, isLoggedIn: true }),
}));

const { default: GroupPreview } = await import('../GroupPreview');
const { default: GroupInvitePanel } = await import('../GroupInvitePanel');

const group = (over = {}) => ({
  id: 'g1',
  publicId: 'g1',
  internalId: 'internal-g1',
  name: 'Night Owls',
  avatarKey: null,
  memberCount: 3,
  memberPreview: [
    { id: 'u1', username: 'ana', displayName: 'Ana', avatar: null },
    { id: 'u2', username: 'bo', displayName: 'Bo', avatar: null },
  ],
  whoCanJoin: 'ANYONE',
  joinState: 'CAN_JOIN',
  retryAt: null,
  invite: { status: 'VALID', expiresAt: null },
  ...over,
});

// The hook's own retry (twice, for a network failure) runs without its delay.
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });

function renderPreview(props = { groupId: 'g1', messageId: 'm1' }) {
  return render(
    <QueryClientProvider client={client()}>
      <MemoryRouter>
        <GroupPreview {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const button = (name) => screen.findByRole('button', { name });

describe('group preview', () => {
  beforeEach(() => {
    joinGroup.mockReset();
    getInvitePreview.mockReset();
    getInviteLinkPreview.mockReset();
    openVerificationModal.mockReset();
    showToast.mockReset();
    currentUser = { id: 'me', verificationStatus: 'VERIFIED' };
    getInvitePreview.mockResolvedValue(group());
  });
  afterEach(cleanup);

  it('shows the group, its member count and its members, and asks about this card', async () => {
    renderPreview();
    expect(await screen.findByRole('heading', { name: 'Night Owls' })).toBeTruthy();
    expect(screen.getByText('3 members')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(getInvitePreview).toHaveBeenCalledWith('g1', { messageId: 'm1' });
  });

  it.each([
    ['CAN_JOIN', 'Join group', true],
    ['APPROVAL_REQUIRED', 'Request to join', true],
    ['REQUESTED', 'Request pending', false],
    ['REJECTED', 'Request declined', false],
    ['INVITE_EXPIRED', 'Invite link expired', false],
    ['INVITE_REVOKED', 'Invite link no longer valid', false],
    ['CLOSED', 'Group ended', false],
    ['MEMBER', 'Open group', true],
  ])('%s reads "%s"', async (joinState, label, enabled) => {
    getInvitePreview.mockResolvedValue(group({ joinState }));
    renderPreview();
    const btn = await button(label);
    expect(btn.disabled).toBe(!enabled);
  });

  it.each(['ANYONE', 'APPROVAL'])(
    'an expired invite offers no action, whatever "Who can join" is (%s)',
    async (whoCanJoin) => {
      getInvitePreview.mockResolvedValue(group({ whoCanJoin, joinState: 'INVITE_EXPIRED' }));
      renderPreview();
      expect((await button('Invite link expired')).disabled).toBe(true);
      expect(screen.queryByRole('button', { name: /join/i })).toBeNull();
      // The group is still shown.
      expect(screen.getByRole('heading', { name: 'Night Owls' })).toBeTruthy();
    },
  );

  it('a declined request says when they may ask again', async () => {
    getInvitePreview.mockResolvedValue(group({
      joinState: 'REJECTED',
      retryAt: new Date(Date.now() + 5 * 60 * 60 * 1000 - 1000).toISOString(),
    }));
    renderPreview();
    expect(await screen.findByText('You can ask to join again in 5 hours.')).toBeTruthy();
  });

  it('joins through the card it was opened from, once however often it is tapped', async () => {
    let finish;
    joinGroup.mockImplementation(() => new Promise((r) => { finish = r; }));
    renderPreview();
    const join = await button('Join group');
    fireEvent.click(join);
    fireEvent.click(join);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Joining…' }).disabled).toBe(true));
    expect(joinGroup).toHaveBeenCalledTimes(1);
    expect(joinGroup).toHaveBeenCalledWith('g1', { messageId: 'm1' });
    finish({ status: 'JOINED', publicId: 'g1' });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Joined Night Owls', 'success'));
  });

  it('a request flips the button to "Request pending" at once', async () => {
    // The refetch after the request never answers: what shows is the patch.
    getInvitePreview
      .mockResolvedValueOnce(group({ whoCanJoin: 'APPROVAL', joinState: 'APPROVAL_REQUIRED' }))
      .mockReturnValue(new Promise(() => {}));
    joinGroup.mockResolvedValue({ status: 'PENDING', publicId: 'g1', newRequest: true });
    renderPreview();
    fireEvent.click(await button('Request to join'));
    expect((await button('Request pending')).disabled).toBe(true);
    expect(showToast).toHaveBeenCalledWith('Request sent', 'success');
  });

  it('a refusal says why and refetches the truth', async () => {
    joinGroup.mockRejectedValue(Object.assign(new Error('This invite link has expired.'), { status: 403, code: 'INVITE_EXPIRED' }));
    renderPreview();
    fireEvent.click(await button('Join group'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(
      'This invite link has expired. Ask a member for a new one.', 'error',
    ));
    await waitFor(() => expect(getInvitePreview).toHaveBeenCalledTimes(2));
  });

  it('a group that is gone has its own state, with no group data', async () => {
    getInvitePreview.mockRejectedValue(Object.assign(new Error('GROUP_NOT_FOUND'), { status: 404 }));
    renderPreview({ groupId: 'g1', messageId: 'm1', snapshot: { name: 'Night Owls' } });
    expect(await screen.findByRole('heading', { name: 'This group isn’t available' })).toBeTruthy();
    expect(screen.queryByText('Night Owls')).toBeNull();
  });

  it('no connection offers a retry, which asks again', async () => {
    // The first load and its two retries fail; the retry the person asks for works.
    getInvitePreview
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockRejectedValueOnce(new Error('Failed to fetch'));
    renderPreview();
    fireEvent.click(await button('Try again'));
    expect(await screen.findByRole('heading', { name: 'Night Owls' })).toBeTruthy();
  });

  it('an invite link is read by its code alone', async () => {
    getInviteLinkPreview.mockResolvedValue(group());
    renderPreview({ code: 'Abc123Def456' });
    expect(await screen.findByRole('heading', { name: 'Night Owls' })).toBeTruthy();
    expect(getInviteLinkPreview).toHaveBeenCalledWith('Abc123Def456');
    joinGroup.mockResolvedValue({ status: 'JOINED', publicId: 'g1' });
    fireEvent.click(screen.getByRole('button', { name: 'Join group' }));
    await waitFor(() => expect(joinGroup).toHaveBeenCalledWith('g1', { code: 'Abc123Def456' }));
  });

  it('a link that is not valid says so', async () => {
    getInviteLinkPreview.mockRejectedValue(Object.assign(new Error('x'), { status: 404, code: 'INVITE_INVALID' }));
    renderPreview({ code: 'nope' });
    expect(await screen.findByRole('heading', { name: 'This invite link isn’t valid' })).toBeTruthy();
  });

  it("the card's name shows while the preview loads", () => {
    getInvitePreview.mockReturnValue(new Promise(() => {}));
    renderPreview({ groupId: 'g1', messageId: 'm1', snapshot: { name: 'Night Owls' } });
    expect(screen.getByRole('heading', { name: 'Night Owls' })).toBeTruthy();
    expect(screen.getByRole('button').disabled).toBe(true);
  });

  it("a group's address names no invite", async () => {
    getInvitePreview.mockResolvedValue(group({ joinState: 'INVITE_EXPIRED', memberPreview: [] }));
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter>
          <GroupInvitePanel groupId="g1" onBack={() => {}} showChatOnMobile />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect((await button('Invite link expired')).disabled).toBe(true);
    expect(getInvitePreview).toHaveBeenCalledWith('g1', {});
  });

  describe('live-selfie gate', () => {
    it('opens the verification prompt instead of joining for an unverified account', async () => {
      currentUser = { id: 'me', verificationStatus: 'UNVERIFIED' };
      renderPreview();
      fireEvent.click(await button('Join group'));

      expect(openVerificationModal).toHaveBeenCalledWith(expect.stringMatching(/live selfie/i));
      expect(joinGroup).not.toHaveBeenCalled();
      expect(showToast).not.toHaveBeenCalled();
    });

    it('gates a pending review the same way', async () => {
      currentUser = { id: 'me', verificationStatus: 'PENDING' };
      renderPreview();
      fireEvent.click(await button('Join group'));
      expect(openVerificationModal).toHaveBeenCalled();
      expect(joinGroup).not.toHaveBeenCalled();
    });

    it('opens the prompt when the server refuses with the selfie 403', async () => {
      joinGroup.mockRejectedValue(
        Object.assign(new Error('Account verification is required to perform this action.'), { status: 403 }),
      );
      renderPreview();
      fireEvent.click(await button('Join group'));

      await waitFor(() => expect(openVerificationModal).toHaveBeenCalled());
      expect(showToast).not.toHaveBeenCalledWith(expect.anything(), 'error');
    });
  });
});
