/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const m = vi.hoisted(() => ({
  socket: { connected: true, emit: vi.fn(), timeout: vi.fn(), on: vi.fn(), off: vi.fn() },
  enqueue: vi.fn(),
  retry: vi.fn(async () => false),
  uploadImage: vi.fn(),
  api: { sendMessage: vi.fn(), getHistory: vi.fn(async () => ({ messages: [] })) },
}));

vi.mock('@shared/api/apiClient', () => ({ messagesApi: m.api, dmApi: m.api, groupApi: m.api }));
vi.mock('@shared/stores/useGlobalSocketStore', () => ({
  useGlobalSocketStore: Object.assign((sel) => sel({ socket: m.socket }), { getState: () => ({ socket: m.socket }) }),
}));
vi.mock('@shared/utils/mediaPipeline', () => ({
  processAndUploadImage: m.uploadImage,
  processAndUploadVideo: vi.fn(),
  uploadFileDirect: vi.fn(),
  getImageDimensions: vi.fn(async () => null),
}));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'u1' } }) }));
vi.mock('@shared/hooks/useMessages', () => ({
  useConversations: () => ({ conversations: [{ id: 'conv-pub', internalId: 'conv-int' }] }),
}));
vi.mock('@shared/lib/networkStatus', () => ({ useOnlineStatus: () => true, isOnline: () => true }));
vi.mock('../../utils/outboxClient', () => ({
  outbox: { enqueue: m.enqueue, retry: m.retry, flush: vi.fn() },
}));
vi.mock('../../utils/idbMessages', () => ({
  idbGetMessages: vi.fn(async () => []),
  idbOutboxAll: vi.fn(async () => []),
  idbSaveMessages: vi.fn(async () => {}),
  idbPatchMessage: vi.fn(async () => {}),
  idbDeleteMessage: vi.fn(async () => {}),
  idbMessagesEpoch: () => 0,
  migrateHistoricalFailedMessages: vi.fn(async () => {}),
}));

import { useChatManager } from '../useChatManager';
import { idbOutboxAll } from '../../utils/idbMessages';

const messageSends = () => m.socket.emit.mock.calls.filter(([event]) => event === 'message:send');

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['messages', 'conv-pub'], { pages: [{ messages: [] }], pageParams: [undefined] });
  const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useChatManager('conv-pub', 'messages'), { wrapper });
  const bubbles = () => qc.getQueryData(['messages', 'conv-pub']).pages.flatMap((p) => p.messages);
  return { qc, hook, bubbles };
}

beforeEach(() => {
  m.enqueue.mockReset().mockResolvedValue({ persisted: true, settled: false });
  m.retry.mockReset().mockResolvedValue(false);
  m.uploadImage.mockReset();
  m.socket.emit.mockReset();
  m.socket.timeout.mockReset();
  m.api.sendMessage.mockReset();
});

describe('useChatManager send path', () => {
  it('records the send in the outbox and sends nothing itself', async () => {
    const { hook, bubbles } = setup();
    await act(async () => {
      await hook.result.current.sendMessageOptimistically({ conversationId: 'conv-pub', text: 'hello', clientId: 'c-1' });
    });
    expect(m.enqueue).toHaveBeenCalledTimes(1);
    const [entry] = m.enqueue.mock.calls[0];
    expect(entry).toMatchObject({
      clientId: 'c-1', userId: 'u1', conversationId: 'conv-pub', orderKey: 'conv-int', chatType: 'messages',
      payload: { clientId: 'c-1', conversationId: 'conv-pub', text: 'hello' },
    });
    expect(messageSends()).toHaveLength(0);
    expect(m.socket.timeout).not.toHaveBeenCalled();
    expect(m.api.sendMessage).not.toHaveBeenCalled();
    // The optimistic bubble waits in the outbox as "Sending…".
    expect(bubbles()).toEqual([expect.objectContaining({ clientId: 'c-1', status: 'sending', isOptimistic: true, queued: true })]);
  });

  it('never leaves a send behind a timer: nothing is sent later either', async () => {
    vi.useFakeTimers();
    try {
      const { hook } = setup();
      await act(async () => {
        await hook.result.current.sendMessageOptimistically({ conversationId: 'conv-pub', text: 'hello', clientId: 'c-2' });
      });
      await act(async () => { vi.advanceTimersByTime(30_000); });
      expect(messageSends()).toHaveLength(0);
      expect(m.api.sendMessage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uploads media itself and records only a payload with the server URL', async () => {
    m.uploadImage.mockResolvedValue({ publicUrl: 'https://cdn/x.jpg', thumbnailUrl: 'https://cdn/t.jpg', width: 640, height: 480 });
    const { hook } = setup();
    const file = new File(['x'], 'x.jpg', { type: 'image/jpeg' });
    await act(async () => {
      await hook.result.current.sendMessageOptimistically({
        conversationId: 'conv-pub', text: '', mediaUrl: 'blob:preview', mediaType: 'image', fileObj: file, clientId: 'c-3',
      });
    });
    expect(m.enqueue).toHaveBeenCalledTimes(1);
    expect(m.enqueue.mock.calls[0][0].payload).toMatchObject({
      mediaUrl: 'https://cdn/x.jpg', thumbnailUrl: 'https://cdn/t.jpg', width: 640, height: 480, mediaType: 'image',
    });
  });

  it('records nothing for a failed upload', async () => {
    m.uploadImage.mockRejectedValue(new Error('upload failed'));
    const { hook, bubbles } = setup();
    const file = new File(['x'], 'x.jpg', { type: 'image/jpeg' });
    await act(async () => {
      await hook.result.current.sendMessageOptimistically({
        conversationId: 'conv-pub', mediaUrl: 'blob:preview', mediaType: 'image', fileObj: file, clientId: 'c-4',
      });
    });
    expect(m.enqueue).not.toHaveBeenCalled();
    expect(bubbles()[0]).toMatchObject({ status: 'failed', uploadStatus: 'failed' });
  });
});

describe('tap-to-retry that rebuilds the send', () => {
  const failedBubble = (over = {}) => ({
    id: 'c-9', clientId: 'c-9', tempId: 'c-9', status: 'failed', senderId: 'u1', payload: { text: 'again' }, ...over,
  });

  it('carries the same ordering and cache routing as a fresh send', async () => {
    const { qc, hook } = setup();
    // The bubble is cached under the internal id; the screen shows the public one.
    qc.setQueryData(['messages', 'conv-int'], { pages: [{ messages: [failedBubble()] }], pageParams: [undefined] });
    await act(async () => { await hook.result.current.retryFailedMessage('c-9', 'conv-int'); });
    expect(m.enqueue).toHaveBeenCalledTimes(1);
    expect(m.enqueue.mock.calls[0][0]).toMatchObject({
      clientId: 'c-9', userId: 'u1', conversationId: 'conv-int',
      orderKey: 'conv-int', chatType: 'messages', mirrorConversationId: 'conv-pub',
      payload: { clientId: 'c-9', text: 'again' },
    });
  });

  it('orders by the canonical chat when the chat on screen is addressed by its public id', async () => {
    const { qc, hook } = setup();
    qc.setQueryData(['messages', 'conv-pub'], { pages: [{ messages: [failedBubble({ id: 'c-8', clientId: 'c-8', tempId: 'c-8' })] }], pageParams: [undefined] });
    await act(async () => { await hook.result.current.retryFailedMessage('c-8'); });
    const [entry] = m.enqueue.mock.calls[0];
    expect(entry.orderKey).toBe('conv-int');
    expect(entry.mirrorConversationId).toBeUndefined();
  });
});

describe('history page folding', () => {
  afterEach(() => {
    idbOutboxAll.mockImplementation(async () => []);
    m.api.getHistory.mockImplementation(async () => ({ messages: [] }));
  });

  it('reads the optimistic copies AFTER the outbox read, so a message sent meanwhile is not dropped', async () => {
    let releaseOutbox;
    idbOutboxAll.mockImplementation(() => new Promise((r) => { releaseOutbox = () => r([]); }));
    m.api.getHistory.mockResolvedValue({ messages: [{ id: 'srv-1', text: 'old', status: 'sent', createdAt: '2026-10-01T00:00:00Z' }] });
    const { qc, hook, bubbles } = setup();
    void qc.invalidateQueries({ queryKey: ['messages', 'conv-pub'] }); // refetch the first page
    await waitFor(() => expect(releaseOutbox).toBeTypeOf('function')); // the page is back, the outbox read is pending
    // The person sends a message while the outbox is being read.
    await act(async () => {
      await hook.result.current.sendMessageOptimistically({ conversationId: 'conv-pub', text: 'sent meanwhile', clientId: 'c-late' });
    });
    await act(async () => { releaseOutbox(); });
    await waitFor(() => expect(bubbles().map((b) => b.id)).toContain('srv-1'));
    expect(bubbles().map((b) => b.clientId || b.id)).toContain('c-late');
    qc.clear();
  });
});

describe('retrying a failed upload', () => {
  it('revokes the preview it replaces, so each retry does not leak a blob URL', async () => {
    const create = vi.fn().mockReturnValueOnce('blob:fresh-1').mockReturnValueOnce('blob:fresh-2');
    const revoke = vi.fn();
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    try {
      m.uploadImage.mockRejectedValue(new Error('upload failed'));
      const { hook } = setup();
      const file = new File(['x'], 'x.jpg', { type: 'image/jpeg' });
      await act(async () => {
        await hook.result.current.sendMessageOptimistically({
          conversationId: 'conv-pub', mediaUrl: 'blob:preview', mediaType: 'image', fileObj: file, clientId: 'c-5',
        });
      });
      await act(async () => { hook.result.current.retryUpload('c-5'); });
      expect(revoke).toHaveBeenCalledWith('blob:preview');
      expect(revoke).not.toHaveBeenCalledWith('blob:fresh-1');
      await act(async () => { hook.result.current.retryUpload('c-5'); });
      expect(revoke).toHaveBeenCalledWith('blob:fresh-1');
    } finally {
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
    }
  });
});
