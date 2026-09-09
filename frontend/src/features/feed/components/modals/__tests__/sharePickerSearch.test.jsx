/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Search in the Share picker.
 *
 * Every Share modal fetched one page of 50 eligible conversations and then
 * filtered that page in the browser, on `conversation.name` alone. Two things
 * were wrong with it: a thread past the first page could not be found at all,
 * and a DM could not be found by the partner's @handle even when it WAS on the
 * page, because the handle is not the rendered name.
 *
 * The term now goes to the server, which matches the group's name or the DM
 * partner's display name / username before applying the limit. The eligibility
 * filters -- verification and first-year isolation -- sit in the same `AND`,
 * so searching can only narrow what they already allow.
 *
 * SharePostModal stands in for all four share modals here: they share the hook
 * and the filter, and ShareProfileModal, ShareActivityModal and
 * ShareCommunityModal differ only in what they send.
 */

const getConversationsMock = vi.fn();

vi.mock('@shared/api/apiClient', () => ({
  // Added with the cookie migration: AuthContext reads this to decide
  // whether a cookie session is worth recovering.
  readCsrfCookie: () => '',
  apiClient: { get: async () => ({}), post: async () => ({}) },
  messagesApi: { getConversations: (...a) => getConversationsMock(...a) },
  getMediaUrl: (v) => v,
}));

vi.mock('@shared/hooks/useMessageActions', () => ({
  useMessageActions: () => ({ sendDirectMessage: vi.fn() }),
}));

vi.mock('@shared/components/avatar/ShareModalAvatar', () => ({
  default: () => <span data-testid="avatar" />,
}));

vi.mock('@shared/components/share/ShareTargets', () => ({ default: () => null }));

import SharePostModal from '../SharePostModal';

const conv = (over) => ({
  createdAt: 0,
  canSendMessages: true,
  ...over,
});

const renderModal = () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SharePostModal
        isOpen
        onClose={vi.fn()}
        post={{ id: 'p1', text: 'hello' }}
        author={{ username: 'author' }}
      />
    </QueryClientProvider>,
  );
};

const type = async (text) => {
  fireEvent.change(screen.getByPlaceholderText('Search connections or groups...'), {
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

const renderedNames = () =>
  Array.from(document.querySelectorAll('[class*="contactName"]')).map(
    (n) => n.textContent,
  );

/** The term the component last asked the server for. */
const lastRequestedTerm = () => {
  const calls = getConversationsMock.mock.calls;
  return calls.length ? calls[calls.length - 1][3] : undefined;
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  getConversationsMock.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Share picker — search reaches the server', () => {
  it('asks the server for eligible threads only, unsearched, on open', async () => {
    renderModal();
    await settle();

    expect(getConversationsMock).toHaveBeenCalledWith(50, 0, true, '');
  });

  it('sends the typed term to the server', async () => {
    renderModal();
    await settle();
    await type('hike');

    expect(lastRequestedTerm()).toBe('hike');
  });

  it('finds a thread that was never on the first page', async () => {
    // The unsearched page does not contain it. Before the fix the browser had
    // nothing to filter and the search box could not reach it.
    getConversationsMock.mockImplementation(async (_l, _o, _e, search) =>
      search === 'zara'
        ? [conv({ id: 'c99', name: 'Zara', targetUser: { username: 'zara' } })]
        : [conv({ id: 'c1', name: 'Someone Else' })],
    );

    renderModal();
    await settle();
    await waitFor(() => {
      expect(renderedNames()).toEqual(['Someone Else']);
    });

    await type('zara');
    await waitFor(() => {
      expect(renderedNames()).toEqual(['Zara']);
    });
  });

  it('keeps a DM matched by @handle rather than by rendered name', async () => {
    // The server matches the partner's username; the client's own second-line
    // filter has to match the same fields or it would throw the row away
    // again. This is the exact regression: `c.name` alone did not contain it.
    getConversationsMock.mockResolvedValue([
      conv({
        id: 'c1',
        name: 'Anita Sharma',
        targetUser: { username: 'anita_cs25', displayName: 'Anita Sharma' },
      }),
    ]);

    renderModal();
    await settle();
    await type('anita_cs25');

    await waitFor(() => {
      expect(renderedNames()).toEqual(['Anita Sharma']);
    });
  });

  it('debounces to one request per pause', async () => {
    renderModal();
    await settle();
    getConversationsMock.mockClear();

    const input = screen.getByPlaceholderText('Search connections or groups...');
    for (const value of ['h', 'hi', 'hik', 'hike']) {
      fireEvent.change(input, { target: { value } });
      await act(async () => {
        vi.advanceTimersByTime(50);
      });
    }
    await settle();

    expect(getConversationsMock.mock.calls.map((c) => c[3])).toEqual(['hike']);
  });

  it('never offers a thread the viewer may not send into', async () => {
    // `canSendMessages: false` is the server's own answer, computed from every
    // rule it will apply on the send -- first-year isolation included. A
    // restricted thread must not become selectable just because it matched.
    getConversationsMock.mockResolvedValue([
      conv({ id: 'c1', name: 'Senior Student', canSendMessages: false }),
      conv({ id: 'c2', name: 'Senior Society', canSendMessages: true }),
    ]);

    renderModal();
    await settle();
    await type('senior');

    await waitFor(() => {
      expect(renderedNames()).toEqual(['Senior Society']);
    });
  });

  it('never offers a thread whose counterpart has deleted their account', async () => {
    getConversationsMock.mockResolvedValue([
      conv({ id: 'c1', name: 'Deleted User', targetUserUnavailable: true }),
      conv({ id: 'c2', name: 'Delightful Group' }),
    ]);

    renderModal();
    await settle();
    await type('del');

    await waitFor(() => {
      expect(renderedNames()).toEqual(['Delightful Group']);
    });
  });
});
