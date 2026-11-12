/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

/**
 * Removing the college email also removes the person from that college's
 * campus communities. The panel says so with the real count, withholds the
 * removal from an owner (naming and linking what to hand over), and shows the
 * server's sentence if it refuses anyway.
 */
const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  removeAffiliation: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@shared/api/apiClient', () => ({
  accountEmailApi: { get: vi.fn(() => Promise.resolve({ email: 'me@mail.com', cooldowns: {} })) },
  campusAffiliationApi: { get: (...a) => mocks.status(...a) },
}));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'me', email: 'me@mail.com' } }) }));
vi.mock('@shared/hooks/useCampusAffiliation', () => ({
  useCampusAffiliation: () => ({
    isActive: true,
    affiliation: { email: 'a***@gla.ac.in', collegeName: 'GLA University', active: true },
  }),
}));
vi.mock('@shared/hooks/useCampusAffiliationActions', () => ({
  useCampusAffiliationActions: () => ({ removeAffiliation: mocks.removeAffiliation }),
}));
vi.mock('@shared/components/AccountEmail/ReauthModal', () => ({
  REAUTH_CANCELLED: 'cancelled',
  useReauth: () => ({ ensure: vi.fn(), invalidate: vi.fn(), current: vi.fn(), modal: null }),
}));
vi.mock('@shared/components/AccountEmail/withReauth', () => ({
  withReauth: (_r, fn) => fn('grant'),
}));
vi.mock('@shared/components/AccountEmail/PersonalEmailForm', () => ({ default: () => null }));
vi.mock('@shared/utils/toast', () => ({ showToast: mocks.showToast }));
// The dialog's own chrome (portal, overlay history) is not under test.
vi.mock('@shared/components/modals/ConfirmModal', () => ({
  default: ({ visible, title, description, confirmText, onConfirm }) =>
    visible ? (
      <div role="dialog" aria-label={title}>
        <p>{description}</p>
        <button type="button" onClick={onConfirm}>{confirmText}</button>
      </div>
    ) : null,
}));

const { default: SettingsEmailPanel } = await import('../SettingsEmailPanel');

const renderPanel = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <SettingsEmailPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const standing = (campusCommunities) => ({ affiliation: null, pending: null, campusCommunities });
const openRemove = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Remove college email/ }));
  return screen.findByRole('dialog', { name: 'Remove college email?' });
};

beforeEach(() => {
  mocks.status.mockReset();
  mocks.removeAffiliation.mockReset().mockResolvedValue(undefined);
  mocks.showToast.mockReset();
});
afterEach(cleanup);

describe('remove college email', () => {
  it('states how many campus communities the person will leave', async () => {
    mocks.status.mockResolvedValue(standing({ joinedCount: 3, owned: [] }));
    renderPanel();
    const dialog = await openRemove();
    await waitFor(() => expect(dialog.textContent).toContain("You'll also leave your 3 campus communities."));
    expect(dialog.textContent).toContain('Your posts, profile and other communities stay.');
  });

  it('uses the singular for one community', async () => {
    mocks.status.mockResolvedValue(standing({ joinedCount: 1, owned: [] }));
    renderPanel();
    const dialog = await openRemove();
    await waitFor(() => expect(dialog.textContent).toContain("You'll also leave your campus community."));
  });

  it('leaves the clause out when there are none to leave', async () => {
    mocks.status.mockResolvedValue(standing({ joinedCount: 0, owned: [] }));
    renderPanel();
    const dialog = await openRemove();
    // Until the status answers the sentence is the generic one; at zero it goes.
    await waitFor(() => expect(mocks.status).toHaveBeenCalled());
    await waitFor(() => expect(dialog.textContent).not.toMatch(/leave your/));
    expect(dialog.textContent).toContain('Campus and your college directory close for you straight away.');
  });

  it('does not offer removal to an owner, and links each community to hand over', async () => {
    mocks.status.mockResolvedValue(
      standing({ joinedCount: 4, owned: [{ id: 'c1', name: 'Chess Club' }, { id: 'c2', name: 'Film Society' }] }),
    );
    renderPanel();
    const chess = await screen.findByRole('link', { name: 'Chess Club' });
    expect(chess.getAttribute('href')).toBe('/communities/c1');
    expect(screen.getByRole('link', { name: 'Film Society' }).getAttribute('href')).toBe('/communities/c2');
    expect(screen.getByText(/Transfer ownership before removing your college email\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Remove college email/ })).toBeNull();
  });

  it("shows the server's message and re-reads the status when it refuses an owner anyway", async () => {
    const message = 'You own campus communities at GLA University. Transfer ownership of Chess Club before removing your campus.';
    mocks.status.mockResolvedValueOnce(standing({ joinedCount: 2, owned: [] }));
    mocks.removeAffiliation.mockRejectedValueOnce(
      Object.assign(new Error(message), { status: 409, code: 'CAMPUS_COMMUNITY_OWNER' }),
    );
    renderPanel();
    await waitFor(() => expect(mocks.status).toHaveBeenCalledTimes(1));
    const dialog = await openRemove();
    mocks.status.mockResolvedValue(standing({ joinedCount: 2, owned: [{ id: 'c1', name: 'Chess Club' }] }));
    fireEvent.click(dialog.querySelector('button'));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith(message, 'error'));
    await waitFor(() => expect(mocks.status).toHaveBeenCalledTimes(2));
    expect((await screen.findByRole('link', { name: 'Chess Club' })).getAttribute('href')).toBe('/communities/c1');
    expect(screen.queryByRole('button', { name: /Remove college email/ })).toBeNull();
  });
});
