/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const sendMock = vi.fn();
const conversations = [
  { id: 'c1', name: 'Asha', createdAt: 2, canSendMessages: true },
  { id: 'c2', name: 'Ravi', createdAt: 1, canSendMessages: true },
];

vi.mock('@shared/api/apiClient', () => ({
  readCsrfCookie: () => '',
  mayHaveCookieSession: () => false,
  rememberCsrfToken: () => {},
  forgetCsrfToken: () => {},
  authApi: { currentSession: async () => ({ user: null }) },
  apiClient: { get: async () => ({}), post: async () => ({}) },
  messagesApi: { getConversations: async () => conversations },
  getMediaUrl: (v) => v,
}));
vi.mock('@shared/hooks/useMessageActions', () => ({
  useMessageActions: () => ({ sendDirectMessage: (...a) => sendMock(...a) }),
}));
vi.mock('@shared/components/avatar/ShareModalAvatar', () => ({ default: () => <span /> }));
vi.mock('@shared/components/share/ShareTargets', () => ({
  default: () => <div data-testid="share-row" />,
}));

import ShareSheet from '../ShareSheet';

const renderSheet = (onClose = vi.fn()) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ShareSheet isOpen onClose={onClose} kind="post" entity={{ id: 'p1', text: 'hello' }} author={{ username: 'al' }} />
    </QueryClientProvider>,
  );
  return onClose;
};

beforeEach(() => sendMock.mockReset().mockResolvedValue({}));
afterEach(cleanup);

describe('<ShareSheet>', () => {
  it('shows the share row until somebody is picked, then one Send button', async () => {
    renderSheet();
    expect(screen.getByTestId('share-row')).toBeTruthy();
    fireEvent.click(await screen.findByRole('option', { name: /Asha/ }));
    expect(screen.queryByTestId('share-row')).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: /Ravi/ }));
    expect(screen.getByRole('button', { name: 'Send to 2' })).toBeTruthy();
  });

  it('hides the app row while searching, but never the Send button', async () => {
    renderSheet();
    const search = screen.getByLabelText('Search chats');
    fireEvent.focus(search);
    expect(screen.queryByTestId('share-row')).toBeNull();
    fireEvent.blur(search);
    expect(screen.getByTestId('share-row')).toBeTruthy();

    fireEvent.click(await screen.findByRole('option', { name: /Asha/ }));
    fireEvent.focus(search);
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('sends the same post payload to every picked chat', async () => {
    renderSheet();
    fireEvent.click(await screen.findByRole('option', { name: /Asha/ }));
    fireEvent.click(screen.getByRole('option', { name: /Ravi/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to 2' }));
    await screen.findByRole('button', { name: 'Sent' });
    expect(sendMock.mock.calls.map((c) => c[0]).sort()).toEqual(['c1', 'c2']);
    expect(sendMock.mock.calls[0][1].inviteData).toMatchObject({ type: 'postShare', post: { id: 'p1' } });
  });

  it('retries only the chats that failed, never re-sending to the rest', async () => {
    sendMock.mockImplementation(async (id) => {
      if (id === 'c2') throw new Error('nope');
      return {};
    });
    renderSheet();
    fireEvent.click(await screen.findByRole('option', { name: /Asha/ }));
    fireEvent.click(screen.getByRole('option', { name: /Ravi/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to 2' }));
    const retry = await screen.findByRole('button', { name: 'Retry 1 chat' });

    sendMock.mockReset().mockResolvedValue({});
    fireEvent.click(retry);
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    expect(sendMock.mock.calls[0][0]).toBe('c2');
  });
});
