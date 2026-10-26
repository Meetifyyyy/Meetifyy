/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal()), useNavigate: () => navigate }));
vi.mock('@shared/hooks/useUsersMap', () => ({ useUsersMap: () => ({}) }));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'me' } }) }));
vi.mock('@shared/hooks/useCommunityActions', () => ({ useCommunityActions: () => ({ setMemberRole: vi.fn() }) }));
vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: () => {} }));
vi.mock('@shared/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));
vi.mock('@shared/api/apiClient', () => ({ usersApi: {}, communitiesApi: {} }));
vi.mock('@shared/components/avatar/Avatar', () => ({ getProcessedAvatarUrl: (v) => v }));
vi.mock('@shared/components/modals/ReportModal/LazyReportModal', () => ({ default: () => null }));
vi.mock('@shared/components/modals/BlockUserModal', () => ({ default: () => null }));
vi.mock('../../moderation/PromoteModeratorModal', () => ({ default: () => null }));

const { default: CommunityMembersModal } = await import('../CommunityMembersModal');

afterEach(() => {
  cleanup();
  navigate.mockReset();
});

const members = [
  { id: 'u1', name: 'Aarav Krishnamurthy Venkataraman', username: 'aarav', isCampusRep: true, role: 'MEMBER' },
  { id: 'u2', name: 'Diya', username: 'diya', role: 'MODERATOR' },
];

const renderModal = (onClose = vi.fn()) => {
  render(
    <MemoryRouter>
      <CommunityMembersModal members={members} communityId="c1" onClose={onClose} />
    </MemoryRouter>,
  );
  return onClose;
};

describe('<CommunityMembersModal>', () => {
  it('puts the representative badge on the avatar, not in the name line', () => {
    renderModal();
    const nameRow = screen.getByText('Aarav Krishnamurthy Venkataraman').parentElement;
    expect(nameRow.querySelector('[aria-label$="Representative"]')).toBeNull();
    const row = nameRow.closest('button').parentElement;
    expect(row.querySelector('[aria-label$="Representative"]')).toBeTruthy();
    const plainRow = screen.getByText('Diya').closest('button').parentElement;
    expect(plainRow.querySelector('[aria-label$="Representative"]')).toBeNull();
    expect(screen.getByText('Moderator')).toBeTruthy();
  });

  it('opens a member’s profile by username', () => {
    const onClose = renderModal();
    fireEvent.click(screen.getByText('Diya'));
    expect(navigate).toHaveBeenCalledWith('/profile/diya');
    expect(onClose).toHaveBeenCalled();
  });
});
