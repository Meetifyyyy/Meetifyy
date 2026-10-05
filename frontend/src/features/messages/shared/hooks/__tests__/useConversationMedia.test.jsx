/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ getConversationMedia: vi.fn() }));
vi.mock('@shared/api/apiClient', () => ({ messagesApi: api }));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'me' } }) }));

import { useConversationMedia, toGalleryItem } from '../useConversationMedia';
import { invalidateConversationMedia } from '../../utils/conversationMediaCache';

const raw = (id, over = {}) => ({
  messageId: id, senderId: 'them', kind: 'image', mediaUrl: `chat/${id}.webp`, thumbnailUrl: `chat/${id}_thumb.webp`,
  width: 100, height: 80, duration: null, createdAt: '2026-10-01T10:00:00.000Z', ...over,
});

let client;
const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.getConversationMedia.mockReset();
});
afterEach(() => client.clear());

describe('toGalleryItem', () => {
  it('offers a report of the MESSAGE for someone else\'s attachment, and none for your own', () => {
    expect(toGalleryItem(raw('m1'), 'me').report).toEqual({ targetType: 'MESSAGE', targetId: 'm1' });
    expect(toGalleryItem(raw('m2', { senderId: 'me' }), 'me').report).toBeUndefined();
  });

  it('maps the stored values the gallery and viewer use', () => {
    expect(toGalleryItem(raw('m1'), 'me')).toMatchObject({
      id: 'm1', type: 'image', url: 'chat/m1.webp', thumbnailUrl: 'chat/m1_thumb.webp', senderId: 'them',
    });
    expect(toGalleryItem(raw('m3', { thumbnailUrl: null }), 'me').thumbnailUrl).toBe('');
  });
});

describe('useConversationMedia', () => {
  it('stays idle until it knows how much to ask for', () => {
    const { result } = renderHook(() => useConversationMedia('c1', { pageSize: 0 }), { wrapper });
    expect(api.getConversationMedia).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.items).toEqual([]);
  });

  it('requests the first page at the size it was given', async () => {
    api.getConversationMedia.mockResolvedValue({ items: [raw('m1')], nextCursor: null });
    const { result } = renderHook(() => useConversationMedia('c1', { pageSize: 4 }), { wrapper });

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(api.getConversationMedia).toHaveBeenCalledWith('c1', expect.objectContaining({ before: undefined, limit: 4 }));
    expect(result.current.hasNextPage).toBe(false);
  });

  it('pages with the server\'s cursor until it says there is no more', async () => {
    api.getConversationMedia
      .mockResolvedValueOnce({ items: [raw('m1'), raw('m2')], nextCursor: 'cur-1' })
      .mockResolvedValueOnce({ items: [raw('m3')], nextCursor: null });
    const { result } = renderHook(() => useConversationMedia('c1', { pageSize: 2 }), { wrapper });

    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => { await result.current.fetchNextPage(); });

    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual(['m1', 'm2', 'm3']));
    expect(api.getConversationMedia).toHaveBeenLastCalledWith('c1', expect.objectContaining({ before: 'cur-1', limit: 2 }));
    expect(result.current.hasNextPage).toBe(false);
    expect(api.getConversationMedia).toHaveBeenCalledTimes(2);
  });

  it('never lists the same message twice', async () => {
    api.getConversationMedia
      .mockResolvedValueOnce({ items: [raw('m1')], nextCursor: 'c' })
      .mockResolvedValueOnce({ items: [raw('m1'), raw('m2')], nextCursor: null });
    const { result } = renderHook(() => useConversationMedia('c1', { pageSize: 1 }), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => { await result.current.fetchNextPage(); });

    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual(['m1', 'm2']));
  });

  it('an empty answer is a real, settled "no media"', async () => {
    api.getConversationMedia.mockResolvedValue({ items: [], nextCursor: null });
    const { result } = renderHook(() => useConversationMedia('c1', { pageSize: 3 }), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  it('a failure is an error, not an empty gallery', async () => {
    api.getConversationMedia.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useConversationMedia('c1', { pageSize: 3 }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.items).toEqual([]);
  });

  it('refetches when the conversation\'s media changes (a photo arrives)', async () => {
    api.getConversationMedia.mockResolvedValueOnce({ items: [raw('m1')], nextCursor: null });
    const { result } = renderHook(() => useConversationMedia('c1', { pageSize: 3 }), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    api.getConversationMedia.mockResolvedValueOnce({ items: [raw('m2'), raw('m1')], nextCursor: null });
    await act(async () => { invalidateConversationMedia(client); });

    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual(['m2', 'm1']));
  });

  it('does not depend on, or get cleared by, the chat\'s message cache', async () => {
    api.getConversationMedia.mockResolvedValue({ items: [raw('m1')], nextCursor: null });
    const { result } = renderHook(() => useConversationMedia('c1', { pageSize: 3 }), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    // What searching, clearing the search or reopening the header does to the chat cache.
    act(() => {
      client.setQueryData(['messages', 'c1'], { pages: [], pageParams: [] });
      client.removeQueries({ queryKey: ['messages'] });
    });

    expect(result.current.items).toHaveLength(1);
    expect(api.getConversationMedia).toHaveBeenCalledTimes(1);
  });

  it('keeps a forwarded copy as its own entry, reporting the message it actually came from', async () => {
    // The same stored file sent twice: once by Asha, then forwarded by Ben.
    api.getConversationMedia.mockResolvedValue({
      items: [
        raw('m-forward', { senderId: 'ben', mediaUrl: 'chat/same.webp' }),
        raw('m-original', { senderId: 'asha', mediaUrl: 'chat/same.webp' }),
      ],
      nextCursor: null,
    });
    const { result } = renderHook(() => useConversationMedia('c1', { pageSize: 5 }), { wrapper });

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.items.map((i) => i.report.targetId)).toEqual(['m-forward', 'm-original']);
  });
});

