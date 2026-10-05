import { describe, expect, it, vi } from 'vitest';
import {
  CONVERSATION_MEDIA_KEY, isConfirmedMessage, messageCarriesGalleryMedia,
} from '../conversationMediaCache';
import {
  appendMessageToCache, purgeConversationFromCaches, removeMessageFromCache, updateMessageInCache,
} from '../cacheUtils';

const fakeClient = () => ({
  setQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
  removeQueries: vi.fn(),
});
const invalidatedGallery = (qc) =>
  qc.invalidateQueries.mock.calls.some(([arg]) => arg.queryKey[0] === CONVERSATION_MEDIA_KEY);

describe('what counts as gallery media', () => {
  it('a photo or video attachment does, however it is stored on the message', () => {
    expect(messageCarriesGalleryMedia({ mediaUrl: 'chat/a.webp', mediaType: 'image' })).toBe(true);
    expect(messageCarriesGalleryMedia({ payload: { mediaUrl: 'chat/b.mp4', mediaType: 'video' } })).toBe(true);
  });

  it('text, voice notes and unsent messages do not', () => {
    expect(messageCarriesGalleryMedia({ text: 'hi' })).toBe(false);
    expect(messageCarriesGalleryMedia({ mediaUrl: 'voice/n.webm', mediaType: 'audio/webm' })).toBe(false);
    expect(messageCarriesGalleryMedia({ mediaUrl: null })).toBe(false);
    expect(messageCarriesGalleryMedia(null)).toBe(false);
  });

  it('an optimistic message is not confirmed; a server one is', () => {
    expect(isConfirmedMessage({ id: 'temp_1_abc' })).toBe(false);
    expect(isConfirmedMessage({ id: 'c_temp_1' })).toBe(false);
    expect(isConfirmedMessage({ id: 'm9', isOptimistic: true })).toBe(false);
    expect(isConfirmedMessage({ id: 'm9' })).toBe(true);
    expect(isConfirmedMessage({})).toBe(false);
  });
});

describe('keeping the gallery in step with the conversation', () => {
  it('a confirmed incoming photo refreshes the gallery', () => {
    const qc = fakeClient();
    appendMessageToCache(qc, 'c1', { id: 'm5', mediaUrl: 'chat/a.webp', mediaType: 'image' });
    expect(invalidatedGallery(qc)).toBe(true);
  });

  it('an optimistic upload, and plain text, do not', () => {
    const qc = fakeClient();
    appendMessageToCache(qc, 'c1', { id: 'temp_1_x', mediaUrl: 'blob:http://x/1', mediaType: 'image' });
    appendMessageToCache(qc, 'c1', { id: 'm6', text: 'hello' });
    expect(invalidatedGallery(qc)).toBe(false);
  });

  it('unsending takes the attachment out of the gallery', () => {
    const qc = fakeClient();
    updateMessageInCache(qc, 'c1', 'm5', { isUnsent: true, mediaUrl: null });
    expect(invalidatedGallery(qc)).toBe(true);
  });

  it('an ordinary status update does not refetch anything', () => {
    const qc = fakeClient();
    updateMessageInCache(qc, 'c1', 'm5', { status: 'read' });
    updateMessageInCache(qc, 'c1', 'm5', (m) => ({ ...m, status: 'read' }));
    expect(invalidatedGallery(qc)).toBe(false);
  });

  it('removing a message, and deleting the conversation, are reflected', () => {
    const qc = fakeClient();
    removeMessageFromCache(qc, 'c1', 'm5');
    expect(invalidatedGallery(qc)).toBe(true);

    const qc2 = fakeClient();
    purgeConversationFromCaches(qc2, 'c1', [{ id: 'c1' }]);
    expect(qc2.removeQueries.mock.calls.some(([arg]) => arg.queryKey[0] === CONVERSATION_MEDIA_KEY)).toBe(true);
  });
});
