/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Search in the New Message modal.
 *
 * It used to draw its list from `useUsersMap()` alone -- the first 20 rows of
 * `GET /users`, 50 campus users, and whoever the viewer already had a thread
 * with -- and filter that map in JavaScript. Anybody outside those few dozen
 * preloaded rows was unreachable however exactly their handle was typed.
 *
 * It now asks the server, which matches display name and username across every
 * eligible account before applying the limit. These tests assert on the
 * REQUEST as well as the render: a component that happened to have the right
 * row cached would satisfy a render assertion and still be broken for
 * everybody else.
 *
 * The eligibility rules are asserted in both directions -- a first-year viewer
 * must not be shown a senior, and a senior must not be shown a first-year --
 * because the point of moving search to the server is that it widens the
 * reachable set without widening the ALLOWED set.
 */

const getConnectionsMock = vi.fn();

vi.mock('@shared/api/apiClient', () => ({
  // Added with the cookie migration: AuthContext reads this to decide
  // whether a cookie session is worth recovering.
  readCsrfCookie: () => '',
  apiClient: { get: async () => ({}), post: async () => ({}) },
  usersApi: { getConnections: (...a) => getConnectionsMock(...a) },
  getMediaUrl: (v) => v,
}));

let currentUser = { id: 'me', username: 'me', displayName: 'Me', isFirstYearStudent: false };
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser, updateCurrentUser: vi.fn(), isLoggedIn: true }),
}));

let usersMap = {};
vi.mock('@shared/hooks/useUsersMap', () => ({
  useUsersMap: () => usersMap,
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

const renderModal = (props = {}) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NewMessageModal
        onClose={vi.fn()}
        onStartChat={vi.fn()}
        onCreateGroup={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
};

const type = async (text) => {
  fireEvent.change(screen.getByPlaceholderText('Search...'), {
    target: { value: text },
  });
  // Past the 250ms debounce.
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
  Array.from(document.querySelectorAll('[class*="userUsername"]')).map(
    (n) => n.textContent,
  );

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  getConnectionsMock.mockReset().mockResolvedValue([]);
  usersMap = {};
  currentUser = { id: 'me', username: 'me', displayName: 'Me', isFirstYearStudent: false };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('New Message modal — search reaches the server', () => {
  it('finds somebody who was never in the preloaded map', async () => {
    // The map holds nobody. Before the fix this was an empty list and no
    // amount of typing could produce a result.
    getConnectionsMock.mockResolvedValue([
      { id: 'u9', username: 'faraway', displayName: 'Far Away' },
    ]);

    renderModal();
    await type('faraway');

    await waitFor(() => {
      expect(renderedHandles()).toContain('@faraway');
    });
    expect(getConnectionsMock).toHaveBeenCalledWith('faraway', 50);
  });

  it('debounces to one request per pause, not one per keystroke', async () => {
    renderModal();
    await settle();
    getConnectionsMock.mockClear();

    const input = screen.getByPlaceholderText('Search...');
    for (const value of ['a', 'an', 'ani', 'anit', 'anita']) {
      fireEvent.change(input, { target: { value } });
      await act(async () => {
        vi.advanceTimersByTime(50);
      });
    }
    await settle();

    const terms = getConnectionsMock.mock.calls.map((c) => c[0]);
    expect(terms).toEqual(['anita']);
  });

  it('keeps showing people the viewer already talks to', async () => {
    // The map is where open threads live, and it must not be dropped now that
    // the server answers the search -- otherwise the suggested list would lose
    // every face it used to open with.
    usersMap = { u1: { id: 'u1', username: 'known', displayName: 'Known Person' } };

    renderModal();
    await settle();

    await waitFor(() => {
      expect(renderedHandles()).toContain('@known');
    });
  });

  it('shows a server result and a locally-known match together, once each', async () => {
    usersMap = { u1: { id: 'u1', username: 'anita', displayName: 'Anita Local' } };
    getConnectionsMock.mockResolvedValue([
      { id: 'u1', username: 'anita', displayName: 'Anita' },
      { id: 'u2', username: 'anitab', displayName: 'Anita B' },
    ]);

    renderModal();
    await type('anit');

    await waitFor(() => {
      expect(renderedHandles()).toEqual(['@anita', '@anitab']);
    });
  });

  it('never lists a senior for a first-year viewer', async () => {
    currentUser = { ...currentUser, isFirstYearStudent: true };
    // A row held over in the cache from before the viewer's batch resolved.
    // The server would not return it; the client drops it anyway.
    usersMap = {
      u5: { id: 'u5', username: 'senior', displayName: 'Senior', isFirstYearStudent: false },
    };
    getConnectionsMock.mockResolvedValue([
      { id: 'u6', username: 'fresher', displayName: 'Fresher', isFirstYearStudent: true },
    ]);

    renderModal();
    await type('s');

    await waitFor(() => {
      expect(renderedHandles()).toContain('@fresher');
    });
    expect(renderedHandles()).not.toContain('@senior');
  });

  it('never lists a first-year for a senior viewer', async () => {
    // The rule is symmetric, and a picker that enforced it in one direction
    // only would leak the other way round.
    currentUser = { ...currentUser, isFirstYearStudent: false };
    usersMap = {
      u7: { id: 'u7', username: 'fresher', displayName: 'Fresher', isFirstYearStudent: true },
    };

    renderModal();
    await type('f');

    expect(renderedHandles()).not.toContain('@fresher');
  });

  it('never lists a deleted or unverified account', async () => {
    getConnectionsMock.mockResolvedValue([
      { id: 'u1', username: 'gone', displayName: 'Gone', isDeleted: true },
      {
        id: 'u2',
        username: 'unverified',
        displayName: 'Unverified',
        verificationStatus: 'PENDING',
      },
      { id: 'u3', username: 'fine', displayName: 'Fine' },
    ]);

    renderModal();
    await type('x');

    await waitFor(() => {
      expect(renderedHandles()).toEqual(['@fine']);
    });
  });

  it('never lists the viewer themselves', async () => {
    getConnectionsMock.mockResolvedValue([
      { id: 'me', username: 'me', displayName: 'Me' },
      { id: 'u1', username: 'other', displayName: 'Other' },
    ]);

    renderModal();
    await type('m');

    await waitFor(() => {
      expect(renderedHandles()).toEqual(['@other']);
    });
  });

  it('says nothing was found rather than showing a stale list', async () => {
    getConnectionsMock.mockResolvedValue([]);

    renderModal();
    await type('nobodyhere');

    await waitFor(() => {
      expect(screen.getByText(/No accounts found matching "nobodyhere"/)).toBeTruthy();
    });
  });
});
