/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * A received chat image must always settle: signed and shown, or an explicit
 * "Unavailable" - never a skeleton that stays up for good.
 *
 * The cache is real-shaped: it has no synchronous answer for conversation media
 * (an unsigned `/api/media/chat/...` URL 404s in the installed app), so the first
 * paint depends on the signing request, which is exactly what used to be skipped
 * on a bubble's first render.
 */
const cache = vi.hoisted(() => ({
  signed: new Map(),
  getSyncUrl: vi.fn(() => null),
  getUrl: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock('@shared/utils/MediaCacheManager', () => ({ mediaCache: cache }));

import MessageBubble from '../MessageBubble';

const THUMB = 'https://api.example/api/media/chat/a_thumb.webp';
const FULL = 'https://api.example/api/media/chat/a.webp';

const wrap = (ui) => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
);
const message = (over = {}) => ({
  id: 'msg-1', senderId: 'them', senderName: 'Asha', status: 'sent', createdAt: new Date().toISOString(),
  mediaUrl: FULL, mediaType: 'image', payload: { mediaUrl: FULL, thumbnailUrl: THUMB }, ...over,
});
const renderBubble = (msg = message()) => render(wrap(<MessageBubble msg={msg} currentUser={{ id: 'me' }} onOpenMediaModal={vi.fn()} />));
const img = () => document.querySelector('img');
const skeleton = () => document.querySelector('[class*="msgMediaSkeleton"]');

beforeEach(() => {
  vi.clearAllMocks();
  cache.getSyncUrl.mockReturnValue(null);
  cache.getUrl.mockImplementation(async (v) => cache.signed.get(v) ?? null);
  cache.signed.clear();
});
afterEach(cleanup);

describe('received chat image', () => {
  it('asks for a signed URL on its very first render and shows that, never the unsigned one', async () => {
    cache.signed.set(THUMB, 'https://cdn.example/a_thumb.webp?sig=1');
    renderBubble();

    expect(cache.getUrl).toHaveBeenCalledWith(THUMB);
    await waitFor(() => expect(img()?.getAttribute('src')).toBe('https://cdn.example/a_thumb.webp?sig=1'));
    expect(img().getAttribute('src')).not.toContain('/api/media/');
  });

  it('shows the skeleton until the picture has loaded, then removes it', async () => {
    cache.signed.set(THUMB, 'https://cdn.example/a_thumb.webp?sig=1');
    renderBubble();
    await waitFor(() => expect(img()).not.toBeNull());
    expect(skeleton()).not.toBeNull();

    fireEvent.load(img());
    expect(skeleton()).toBeNull();
  });

  it('falls back to the full image when the thumbnail cannot be signed', async () => {
    // The cache resolves a missing derived thumbnail to nothing so callers use the original.
    cache.signed.set(FULL, 'https://cdn.example/a.webp?sig=2');
    renderBubble();

    await waitFor(() => expect(img()?.getAttribute('src')).toBe('https://cdn.example/a.webp?sig=2'));
    expect(screen.queryByText('Unavailable')).toBeNull();
  });

  it('ends on Unavailable - not an endless skeleton - when nothing can be signed', async () => {
    renderBubble();
    await waitFor(() => expect(screen.getByText('Unavailable')).toBeTruthy());
    expect(skeleton()).toBeNull();
  });

  it('re-signs once when the picture fails to load, then moves on to the full image', async () => {
    cache.signed.set(THUMB, 'https://cdn.example/a_thumb.webp?sig=1');
    cache.signed.set(FULL, 'https://cdn.example/a.webp?sig=2');
    renderBubble();
    await waitFor(() => expect(img()).not.toBeNull());

    fireEvent.error(img());                       // expired signature: sign again
    expect(cache.invalidate).toHaveBeenCalledWith(THUMB);
    await waitFor(() => expect(cache.getUrl).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(img()).not.toBeNull());

    fireEvent.error(img());                       // still bad: use the original
    await waitFor(() => expect(img()?.getAttribute('src')).toBe('https://cdn.example/a.webp?sig=2'));

    fireEvent.error(img());                       // the original is bad too: re-sign it once...
    await waitFor(() => expect(img()).not.toBeNull());
    fireEvent.error(img());                       // ...and then stop
    await waitFor(() => expect(screen.getByText('Unavailable')).toBeTruthy());
  });

  it('paints an optimistic local preview immediately, without signing', () => {
    renderBubble(message({ mediaUrl: 'blob:http://x/1', payload: { localPreviewUrl: 'blob:http://x/1' }, uploadStatus: 'uploading', senderId: 'me' }));
    expect(img()?.getAttribute('src')).toBe('blob:http://x/1');
    expect(cache.getUrl).not.toHaveBeenCalled();
  });

  it('does not strand a bubble whose message changes to a different image', async () => {
    cache.signed.set(THUMB, 'https://cdn.example/a_thumb.webp?sig=1');
    cache.signed.set('https://api.example/api/media/chat/b_thumb.webp', 'https://cdn.example/b_thumb.webp?sig=3');
    const view = renderBubble();
    await waitFor(() => expect(img()?.getAttribute('src')).toContain('a_thumb'));

    await act(async () => {
      view.rerender(wrap(<MessageBubble
        msg={message({ mediaUrl: 'https://api.example/api/media/chat/b.webp', payload: { thumbnailUrl: 'https://api.example/api/media/chat/b_thumb.webp' } })}
        currentUser={{ id: 'me' }}
        onOpenMediaModal={vi.fn()}
      />));
    });
    await waitFor(() => expect(img()?.getAttribute('src')).toContain('b_thumb'));
  });
});
