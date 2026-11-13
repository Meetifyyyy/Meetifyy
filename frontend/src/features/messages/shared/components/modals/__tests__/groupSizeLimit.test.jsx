/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The New Message picker stops at a full group.
 *
 * A group holds at most MAX_GROUP_MEMBERS people, the creator included, and
 * the server refuses a larger founding list. The picker used to let anyone
 * build one, and the refusal only came after naming the group.
 */

const getConnectionsMock = vi.fn();

vi.mock('@shared/api/apiClient', () => ({
  readCsrfCookie: () => '',
  mayHaveCookieSession: () => false,
  rememberCsrfToken: () => {},
  forgetCsrfToken: () => {},
  authApi: {
    currentSession: async () => ({ user: null }),
    adoptSession: async () => ({}),
    logoutSession: async () => ({}),
  },
  apiClient: { get: async () => ({}), post: async () => ({}) },
  usersApi: { getConnections: (...a) => getConnectionsMock(...a) },
  getMediaUrl: (v) => v,
}));

vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { id: 'me', username: 'me', displayName: 'Me' },
    updateCurrentUser: vi.fn(),
    isLoggedIn: true,
  }),
}));

vi.mock('@shared/hooks/useUsersMap', () => ({
  useUsersMap: () => ({}),
  UsersMapProvider: ({ children }) => children,
}));

vi.mock('@shared/components/avatar/Avatar', () => ({
  default: () => <span data-testid="avatar" />,
  getProcessedAvatarUrl: (v) => v,
}));
vi.mock('@shared/components/avatar/DefaultAvatar', () => ({
  default: () => <span data-testid="default-avatar" />,
}));

import NewMessageModal from '../NewMessageModal';
import { MAX_GROUP_MEMBERS } from '@features/messages/shared/utils/groupMembership';

const people = Array.from({ length: MAX_GROUP_MEMBERS }, (_, i) => ({
  id: `u${i}`,
  username: `person${i}`,
  displayName: `Person ${i}`,
}));

const listButtons = () => Array.from(document.querySelectorAll('ul button[aria-pressed]'));
const picked = () => listButtons().filter((b) => b.getAttribute('aria-pressed') === 'true').length;
const note = () => screen.queryByText(/A group can have up to \d+ members, you included\./);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  getConnectionsMock.mockReset().mockResolvedValue(people);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('New Message modal — group size', () => {
  it('lets the viewer pick everyone a group can hold besides them, and no one more', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={qc}>
        <NewMessageModal onClose={vi.fn()} onStartChat={vi.fn()} onCreateGroup={vi.fn()} />
      </QueryClientProvider>,
    );
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });
    await waitFor(() => expect(listButtons()).toHaveLength(MAX_GROUP_MEMBERS));

    const buttons = listButtons();
    for (const b of buttons.slice(0, MAX_GROUP_MEMBERS - 2)) fireEvent.click(b);
    expect(picked()).toBe(MAX_GROUP_MEMBERS - 2);
    expect(note()).toBeNull();

    fireEvent.click(buttons[MAX_GROUP_MEMBERS - 2]);
    expect(picked()).toBe(MAX_GROUP_MEMBERS - 1);
    expect(note()).not.toBeNull();
    expect(screen.getByRole('button', { name: `Create group · ${MAX_GROUP_MEMBERS - 1}` })).toBeTruthy();

    // Full: the last person cannot be added.
    fireEvent.click(buttons[MAX_GROUP_MEMBERS - 1]);
    expect(picked()).toBe(MAX_GROUP_MEMBERS - 1);
    expect(buttons[MAX_GROUP_MEMBERS - 1].getAttribute('aria-pressed')).toBe('false');

    // Unpicking someone makes room again.
    fireEvent.click(buttons[0]);
    expect(note()).toBeNull();
    fireEvent.click(buttons[MAX_GROUP_MEMBERS - 1]);
    expect(picked()).toBe(MAX_GROUP_MEMBERS - 1);
  });
});
