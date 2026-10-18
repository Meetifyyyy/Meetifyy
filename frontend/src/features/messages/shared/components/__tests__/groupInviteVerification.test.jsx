/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

/**
 * Joining a group chat from an invite link is behind the live-selfie check.
 * An unverified account gets the verification prompt and no join request;
 * a verified one joins as before; a server 403 opens the same prompt.
 */

const joinGroup = vi.fn();
const getInvitePreview = vi.fn();
const openVerificationModal = vi.fn();
const showToast = vi.fn();
let currentUser = { id: 'me', verificationStatus: 'UNVERIFIED' };

vi.mock('@shared/api/apiClient', () => ({
  groupApi: {
    joinGroup: (...a) => joinGroup(...a),
    getInvitePreview: (...a) => getInvitePreview(...a),
  },
  getMediaUrl: (v) => v,
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

const { default: GroupInvitePanel } = await import('../GroupInvitePanel');

function renderPanel() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <GroupInvitePanel groupId="g1" onBack={() => {}} showChatOnMobile />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('group invite join: live-selfie gate', () => {
  beforeEach(() => {
    joinGroup.mockReset();
    openVerificationModal.mockReset();
    showToast.mockReset();
    getInvitePreview.mockResolvedValue({
      id: 'g1', name: 'Night Owls', memberCount: 3, joinState: 'CAN_JOIN',
    });
  });
  afterEach(cleanup);

  it('opens the verification prompt instead of joining for an unverified account', async () => {
    currentUser = { id: 'me', verificationStatus: 'UNVERIFIED' };
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Join Group' }));

    expect(openVerificationModal).toHaveBeenCalledWith(expect.stringMatching(/live selfie/i));
    expect(joinGroup).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('gates a pending review the same way', async () => {
    currentUser = { id: 'me', verificationStatus: 'PENDING' };
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Join Group' }));
    expect(openVerificationModal).toHaveBeenCalled();
    expect(joinGroup).not.toHaveBeenCalled();
  });

  it('joins for a verified account', async () => {
    currentUser = { id: 'me', verificationStatus: 'VERIFIED' };
    joinGroup.mockResolvedValue({ status: 'JOINED', publicId: 'g1' });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Join Group' }));

    await waitFor(() => expect(joinGroup).toHaveBeenCalledWith('g1'));
    expect(openVerificationModal).not.toHaveBeenCalled();
  });

  it('opens the prompt when the server refuses with the selfie 403', async () => {
    currentUser = { id: 'me', verificationStatus: 'VERIFIED' };
    joinGroup.mockRejectedValue(
      Object.assign(new Error('Account verification is required to perform this action.'), { status: 403 }),
    );
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Join Group' }));

    await waitFor(() => expect(openVerificationModal).toHaveBeenCalled());
    expect(showToast).not.toHaveBeenCalledWith(expect.anything(), 'error');
  });
});
