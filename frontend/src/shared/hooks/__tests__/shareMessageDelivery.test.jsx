/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

/**
 * A message sent from a share flow has to behave like one sent from the chat.
 *
 * Share Post / Community / Profile / Activity send over HTTP from a modal that
 * is not the chat, so the conversation's message cache is usually COLD — it has
 * never been fetched. The writer these flows used opened with
 * `if (!old) return old`, so in exactly that case both the optimistic write and
 * the confirmed one were silently dropped and the message existed only on the
 * server until something refetched.
 *
 * It also wrote to the single id the modal happened to be holding. A
 * conversation answers to several — internal id, public id, the other
 * participant's id or username — and `['messages', id]` is keyed on whichever
 * the open route uses, so the write could land under a key nothing reads.
 */

const sendMessage = vi.hoisted(() => vi.fn());

vi.mock('@shared/api/apiClient', () => ({
  messagesApi: {},
  usersApi: {},
  dmApi: { sendMessage: (...a) => sendMessage(...a) },
  groupApi: { sendMessage: (...a) => sendMessage(...a) },
}));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { id: 'me', displayName: 'Me' } }),
}));
vi.mock('../useMessages', () => ({
  useConversations: () => ({
    conversations: [
      { id: 'conv-internal', publicId: 'conv-public', otherUser: { id: 'bob', username: 'bob' } },
    ],
  }),
}));
vi.mock('@shared/utils/toast', () => ({ showToast: () => {} }));
vi.mock('@shared/utils/mediaPipeline', () => ({
  processAndUploadImage: async () => ({ publicUrl: 'u' }),
  uploadFileDirect: async () => ({ publicUrl: 'u' }),
}));
vi.mock('../../features/messages/shared/utils/idbMessages', () => ({
  idbDeleteConversationMessages: async () => {},
}));
vi.mock('@shared/utils/conversationWriteQueue', () => ({ scheduleConversationWrite: () => {} }));

const { useMessageActions } = await import('@shared/hooks/useMessageActions');

const messagesIn = (qc, key) =>
  (qc.getQueryData(['messages', key])?.pages || []).flatMap((p) => p.messages || []);

describe('sending from a share flow', () => {
  let qc;
  const wrap = ({ children }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => qc.clear());

  it('shows the message even though the conversation was never opened', async () => {
    sendMessage.mockResolvedValue({ id: 'server-1', text: '', clientId: undefined });
    const { result } = renderHook(() => useMessageActions(), { wrapper: wrap });

    await act(async () => {
      await result.current.sendDirectMessage('conv-internal', {
        text: '',
        inviteData: { type: 'profileShare' },
      });
    });

    // Cold cache: the old writer dropped this entirely.
    expect(messagesIn(qc, 'conv-internal')).toHaveLength(1);
  });

  it('writes to every id the conversation answers to', async () => {
    sendMessage.mockResolvedValue({ id: 'server-1' });
    const { result } = renderHook(() => useMessageActions(), { wrapper: wrap });

    await act(async () => {
      await result.current.sendDirectMessage('conv-internal', { text: 'hi' });
    });

    // The chat may be keyed on any of these depending on the route it opened.
    expect(messagesIn(qc, 'conv-public')).toHaveLength(1);
    expect(messagesIn(qc, 'bob')).toHaveLength(1);
  });

  it('does not duplicate when the server confirms', async () => {
    sendMessage.mockResolvedValue({ id: 'server-1', clientId: 'echoed' });
    const { result } = renderHook(() => useMessageActions(), { wrapper: wrap });

    await act(async () => {
      await result.current.sendDirectMessage('conv-internal', { text: 'hi' });
    });

    const msgs = messagesIn(qc, 'conv-internal');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe('server-1');
    expect(msgs[0].status).toBe('sent');
  });

  it('sends a clientId so the server can dedupe a retry', async () => {
    sendMessage.mockResolvedValue({ id: 'server-1' });
    const { result } = renderHook(() => useMessageActions(), { wrapper: wrap });

    await act(async () => {
      await result.current.sendDirectMessage('conv-internal', { text: 'hi' });
    });

    const [, payload] = sendMessage.mock.calls[0];
    expect(payload.clientId).toEqual(expect.any(String));
    expect(payload.clientId.length).toBeGreaterThan(0);
  });

  it('gives two sends in the same millisecond different ids', async () => {
    // A multi-recipient share fires these back to back; `temp_${Date.now()}`
    // alone collided, which made two messages look like one.
    sendMessage.mockResolvedValue({ id: 'server-1' });
    const { result } = renderHook(() => useMessageActions(), { wrapper: wrap });

    await act(async () => {
      await Promise.all([
        result.current.sendDirectMessage('conv-internal', { text: 'a' }),
        result.current.sendDirectMessage('conv-internal', { text: 'b' }),
      ]);
    });

    const ids = sendMessage.mock.calls.map(([, p]) => p.clientId);
    expect(new Set(ids).size).toBe(2);
  });

  it('marks the message failed rather than losing it when the send fails', async () => {
    sendMessage.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useMessageActions(), { wrapper: wrap });

    await act(async () => {
      await result.current
        .sendDirectMessage('conv-internal', { text: 'hi' })
        .catch(() => {});
    });

    const msgs = messagesIn(qc, 'conv-internal');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].status).toBe('failed');
  });
});
