/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const m = vi.hoisted(() => ({
  socket: { connected: true, emit: vi.fn(), timeout: vi.fn(), on: vi.fn(), off: vi.fn() },
  enqueue: vi.fn(),
  retry: vi.fn(async () => false),
  uploadImage: vi.fn(),
  uploadVideo: vi.fn(),
  poster: vi.fn(async () => null),
  toast: vi.fn(),
  api: { sendMessage: vi.fn(), getHistory: vi.fn(async () => ({ messages: [] })) },
}));

vi.mock('@shared/api/apiClient', () => ({ messagesApi: m.api, dmApi: m.api, groupApi: m.api }));
vi.mock('@shared/stores/useGlobalSocketStore', () => ({
  useGlobalSocketStore: Object.assign((sel) => sel({ socket: m.socket }), { getState: () => ({ socket: m.socket }) }),
}));
vi.mock('@shared/utils/mediaPipeline', () => ({
  processAndUploadImage: m.uploadImage,
  processAndUploadVideo: m.uploadVideo,
  uploadFileDirect: vi.fn(),
  getImageDimensions: vi.fn(async () => null),
  generateVideoPoster: m.poster,
  isMediaRejection: (err) => err?.code === 'MEDIA_INVALID' || err?.status === 413,
}));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'u1' } }) }));
vi.mock('@shared/utils/toast', () => ({ showToast: m.toast }));
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
  m.uploadVideo.mockReset();
  m.poster.mockReset().mockResolvedValue(null);
  m.toast.mockReset();
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

describe('sending a video', () => {
  const clip = () => new File(['x'], 'clip.mp4', { type: 'video/mp4' });
  let createObjectURL;
  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:poster-frame');
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
  });

  it('shows the poster frame and the real size before the clip has uploaded', async () => {
    m.poster.mockResolvedValue({ posterBlob: new Blob(['p']), width: 720, height: 1280, duration: 9 });
    let finish;
    m.uploadVideo.mockImplementation(() => new Promise((r) => { finish = r; }));
    const { hook, bubbles } = setup();
    let sending;
    act(() => {
      sending = hook.result.current.sendMessageOptimistically({
        conversationId: 'conv-pub', mediaUrl: 'blob:clip', mediaType: 'video', fileObj: clip(), clientId: 'v-1',
      });
    });
    await waitFor(() => expect(m.uploadVideo).toHaveBeenCalled());
    expect(bubbles()[0].payload).toMatchObject({
      thumbnailUrl: 'blob:poster-frame', localPosterUrl: 'blob:poster-frame', width: 720, height: 1280, duration: 9,
    });
    // The pipeline is handed that same frame instead of decoding the clip again.
    expect(m.uploadVideo.mock.calls[0][4]).toEqual({ meta: expect.objectContaining({ width: 720, height: 1280 }) });
    await act(async () => {
      finish({ publicUrl: '/api/media/chat/v.mp4', thumbnailUrl: '/api/media/chat/v_thumb.webp', width: 720, height: 1280, duration: 9 });
      await sending;
    });
    expect(m.enqueue.mock.calls[0][0].payload).toMatchObject({
      mediaUrl: '/api/media/chat/v.mp4', thumbnailUrl: '/api/media/chat/v_thumb.webp', width: 720, height: 1280, duration: 9,
    });
  });

  it('creates the bubble at the clip\'s real shape, before its poster frame exists', async () => {
    let drawPoster;
    m.poster.mockImplementation((_file, { onMetadata } = {}) => {
      onMetadata?.({ width: 1080, height: 1920, duration: 7 });
      return new Promise((r) => { drawPoster = r; });
    });
    m.uploadVideo.mockImplementation(() => new Promise(() => {}));
    const { qc, hook, bubbles } = setup();
    const shapes = [];
    qc.getQueryCache().subscribe(() => {
      const first = qc.getQueryData(['messages', 'conv-pub'])?.pages?.[0]?.messages?.[0];
      if (first) shapes.push([first.payload.width, first.payload.height]);
    });
    act(() => {
      hook.result.current.sendMessageOptimistically({
        conversationId: 'conv-pub', mediaUrl: 'blob:clip', mediaType: 'video', fileObj: clip(), clientId: 'v-shape',
      });
    });
    await waitFor(() => expect(bubbles()).toHaveLength(1));
    expect(bubbles()[0].payload).toMatchObject({ width: 1080, height: 1920, duration: 7, thumbnailUrl: null });
    await act(async () => { drawPoster({ posterBlob: new Blob(['p']), width: 1080, height: 1920, duration: 7 }); });
    await waitFor(() => expect(bubbles()[0].payload.thumbnailUrl).toBe('blob:poster-frame'));
    // Never a moment without its size.
    expect(shapes.every(([w, h]) => w === 1080 && h === 1920)).toBe(true);
  });

  it('never records the clip as its own thumbnail when the poster did not upload', async () => {
    m.uploadVideo.mockResolvedValue({ publicUrl: '/api/media/chat/v.mp4', thumbnailUrl: null });
    const { hook } = setup();
    await act(async () => {
      await hook.result.current.sendMessageOptimistically({
        conversationId: 'conv-pub', mediaUrl: 'blob:clip', mediaType: 'video', fileObj: clip(), clientId: 'v-2',
      });
    });
    const { payload } = m.enqueue.mock.calls[0][0];
    expect(payload.mediaUrl).toBe('/api/media/chat/v.mp4');
    expect(payload.thumbnailUrl).toBeUndefined();
  });

  it('says why once and removes the bubble when the file itself is refused', async () => {
    m.uploadVideo.mockRejectedValue(Object.assign(new Error('Video must be 15 MB or less'), { status: 413 }));
    const { hook, bubbles } = setup();
    await act(async () => {
      await hook.result.current.sendMessageOptimistically({
        conversationId: 'conv-pub', mediaUrl: 'blob:clip', mediaType: 'video', fileObj: clip(), clientId: 'v-3',
      });
    });
    expect(m.toast).toHaveBeenCalledTimes(1);
    expect(m.toast).toHaveBeenCalledWith('Video must be 15 MB or less', 'error');
    expect(bubbles()).toEqual([]);
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it('keeps a network failure retryable', async () => {
    m.uploadVideo.mockRejectedValue(new Error('Network or CORS error during media upload'));
    const { hook, bubbles } = setup();
    await act(async () => {
      await hook.result.current.sendMessageOptimistically({
        conversationId: 'conv-pub', mediaUrl: 'blob:clip', mediaType: 'video', fileObj: clip(), clientId: 'v-4',
      });
    });
    expect(m.toast).not.toHaveBeenCalled();
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
