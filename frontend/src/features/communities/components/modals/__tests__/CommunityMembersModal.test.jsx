/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal()), useNavigate: () => navigate }));
vi.mock('@shared/hooks/useUsersMap', () => ({ useUsersMap: () => ({}) }));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'me' } }) }));
vi.mock('@shared/hooks/useCommunityActions', () => ({ useCommunityActions: () => ({ setMemberRole: vi.fn() }) }));
// Holds the handler the modal gives Back, so a test can press it.
const overlayBack = vi.hoisted(() => ({ onClose: null }));
vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: (_open, onClose) => { overlayBack.onClose = onClose; } }));
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
  vi.useRealTimers();
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

  it('filters by name or @username and says when nothing matches', () => {
    renderModal();
    const search = screen.getByRole('searchbox', { name: 'Search members' });

    fireEvent.change(search, { target: { value: '  DIY' } });
    expect(screen.getByText('Diya')).toBeTruthy();
    expect(screen.queryByText('Aarav Krishnamurthy Venkataraman')).toBeNull();

    fireEvent.change(search, { target: { value: '@aarav' } });
    expect(screen.getByText('Aarav Krishnamurthy Venkataraman')).toBeTruthy();
    expect(screen.queryByText('Diya')).toBeNull();

    fireEvent.change(search, { target: { value: 'zz' } });
    expect(screen.getByText('No matches')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText('Diya')).toBeTruthy();
    expect(screen.getByText('Aarav Krishnamurthy Venkataraman')).toBeTruthy();
  });

  it('Escape clears a search before it closes the dialog', () => {
    vi.useFakeTimers();
    const onClose = renderModal();
    const search = screen.getByRole('searchbox', { name: 'Search members' });
    fireEvent.change(search, { target: { value: 'diya' } });

    fireEvent.keyDown(search, { key: 'Escape' });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(search.value).toBe('');
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(search, { key: 'Escape' });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Each way out plays the exit animation first, then closes exactly once,
  // however many times it is asked while the animation runs.
  const closeRoutes = {
    'the X': () => fireEvent.click(screen.getByRole('button', { name: 'Close' })),
    'a tap on the empty area': () => {
      const backdrop = screen.getByRole('dialog').parentElement;
      fireEvent.pointerDown(backdrop);
      fireEvent.click(backdrop);
    },
    'Back': () => act(() => { overlayBack.onClose(); }),
  };

  Object.entries(closeRoutes).forEach(([route, press]) => {
    it(`closes after the exit animation on ${route}`, () => {
      vi.useFakeTimers();
      const onClose = renderModal();

      press();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog').parentElement.className).toMatch(/closing/);

      press();
      act(() => { vi.advanceTimersByTime(1000); });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('does not close when a press inside the sheet ends on the backdrop', () => {
    vi.useFakeTimers();
    const onClose = renderModal();
    const backdrop = screen.getByRole('dialog').parentElement;

    fireEvent.pointerDown(screen.getByText('Diya'));
    fireEvent.click(backdrop);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onClose).not.toHaveBeenCalled();
  });
});
