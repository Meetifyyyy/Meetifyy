/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The group Invite modal's people list.
 *
 * Two defects, both visible in the same list:
 *
 *   1. `currentMemberIds` was assembled from the group details and the
 *      conversation row and then never used, so every person already in the
 *      group -- the owner and the viewer included -- was listed with a live
 *      "Invite" button that could only produce a redundant invite.
 *   2. Every keystroke fired its own request, because the raw search term was
 *      the query key.
 *
 * The search itself was already server-side and stays that way: the term goes
 * to `/api/users/connections`, which applies blocks, verification and
 * first-year isolation IN THE QUERY, before the limit. Excluding current
 * members is a property of the group rather than an eligibility rule, which is
 * why that one is done on the client -- the set is small and already loaded.
 */

const getConnectionsMock = vi.fn();
const getGroupDetailsMock = vi.fn();

vi.mock('@shared/api/apiClient', () => ({
  apiClient: { get: async () => ({}), post: async () => ({}) },
  usersApi: { getConnections: (...a) => getConnectionsMock(...a) },
  groupApi: { getDetails: (...a) => getGroupDetailsMock(...a) },
  getMediaUrl: (v) => v,
}));

let currentUser = { id: 'me', username: 'me', displayName: 'Me', isFirstYearStudent: false };
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser, updateCurrentUser: vi.fn(), isLoggedIn: true }),
}));

vi.mock('@shared/hooks/useMessages', () => ({
  useConversations: () => ({ conversations: [] }),
}));
vi.mock('@shared/hooks/useMessageActions', () => ({
  useMessageActions: () => ({
    startConversation: vi.fn(),
    sendDirectMessage: vi.fn(),
  }),
}));
vi.mock('@shared/components/avatar/Avatar', () => ({
  default: () => <span data-testid="avatar" />,
  getProcessedAvatarUrl: (v) => v,
}));
vi.mock('@shared/components/avatar/DefaultAvatar', () => ({
  default: () => <span data-testid="default-avatar" />,
}));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));

import InviteModal from '../InviteModal';

const GROUP = {
  id: 'g1',
  name: 'Weekend Hike',
  ownerId: 'owner',
  members: [{ id: 'member' }],
};

const renderModal = (group = GROUP) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <InviteModal isOpen onClose={vi.fn()} group={group} />
    </QueryClientProvider>,
  );
};

const type = async (text) => {
  fireEvent.change(screen.getByPlaceholderText('Search people...'), {
    target: { value: text },
  });
  await act(async () => {
    vi.advanceTimersByTime(400);
    await Promise.resolve();
  });
};

const settle = async () =>
  act(async () => {
    vi.advanceTimersByTime(400);
    await Promise.resolve();
  });

const renderedHandles = () =>
  Array.from(document.querySelectorAll('[class*="contactHandle"]')).map(
    (n) => n.textContent,
  );

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  getConnectionsMock.mockReset().mockResolvedValue([]);
  getGroupDetailsMock.mockReset().mockResolvedValue({ ownerId: 'owner', members: [] });
  currentUser = { id: 'me', username: 'me', displayName: 'Me', isFirstYearStudent: false };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Invite modal — who is offered', () => {
  it('does not offer people who are already in the group', async () => {
    getConnectionsMock.mockResolvedValue([
      { id: 'owner', username: 'owner', displayName: 'Owner' },
      { id: 'member', username: 'member', displayName: 'Member' },
      { id: 'u3', username: 'outsider', displayName: 'Outsider' },
    ]);

    renderModal();
    await settle();

    await waitFor(() => {
      expect(renderedHandles()).toEqual(['@outsider']);
    });
  });

  it('does not offer the viewer themselves', async () => {
    getConnectionsMock.mockResolvedValue([
      { id: 'me', username: 'me', displayName: 'Me' },
      { id: 'u3', username: 'outsider', displayName: 'Outsider' },
    ]);

    renderModal();
    await settle();

    await waitFor(() => {
      expect(renderedHandles()).toEqual(['@outsider']);
    });
  });

  it('sends the typed term to the server rather than filtering a page', async () => {
    renderModal();
    await settle();
    await type('anita');

    expect(getConnectionsMock).toHaveBeenLastCalledWith('anita', 50);
  });

  it('debounces to one request per pause, not one per keystroke', async () => {
    renderModal();
    await settle();
    getConnectionsMock.mockClear();

    const input = screen.getByPlaceholderText('Search people...');
    for (const value of ['a', 'an', 'ani', 'anit', 'anita']) {
      fireEvent.change(input, { target: { value } });
      await act(async () => {
        vi.advanceTimersByTime(50);
      });
    }
    await settle();

    expect(getConnectionsMock.mock.calls.map((c) => c[0])).toEqual(['anita']);
  });

  it('never offers a senior to a first-year viewer', async () => {
    currentUser = { ...currentUser, isFirstYearStudent: true };
    // The server would not return the senior. This covers a row still held in
    // either cache from before the viewer's batch resolved.
    getConnectionsMock.mockResolvedValue([
      { id: 'u1', username: 'senior', displayName: 'Senior', isFirstYearStudent: false },
      { id: 'u2', username: 'fresher', displayName: 'Fresher', isFirstYearStudent: true },
    ]);

    renderModal();
    await settle();
    await type('e');

    await waitFor(() => {
      expect(renderedHandles()).toEqual(['@fresher']);
    });
  });

  it('never offers a first-year to a senior viewer', async () => {
    currentUser = { ...currentUser, isFirstYearStudent: false };
    getConnectionsMock.mockResolvedValue([
      { id: 'u1', username: 'senior', displayName: 'Senior', isFirstYearStudent: false },
      { id: 'u2', username: 'fresher', displayName: 'Fresher', isFirstYearStudent: true },
    ]);

    renderModal();
    await settle();
    await type('e');

    await waitFor(() => {
      expect(renderedHandles()).toEqual(['@senior']);
    });
  });

  it('never offers a deleted account', async () => {
    getConnectionsMock.mockResolvedValue([
      { id: 'u1', username: 'gone', displayName: 'Gone', isDeleted: true },
      { id: 'u2', username: 'here', displayName: 'Here' },
    ]);

    renderModal();
    await settle();

    await waitFor(() => {
      expect(renderedHandles()).toEqual(['@here']);
    });
  });
});
