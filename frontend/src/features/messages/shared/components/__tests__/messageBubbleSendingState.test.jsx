/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@shared/utils/MediaCacheManager', () => ({
  mediaCache: { getSyncUrl: (v) => v, getUrl: vi.fn(async (v) => v), invalidate: vi.fn() },
}));
vi.mock('@shared/hooks/useSignedMediaSrc', () => ({
  useSignedMediaSrc: (value) => ({ src: value || '', failed: false, pending: false, attempt: 0, refresh: vi.fn() }),
}));

import MessageBubble from '../MessageBubble';

/**
 * "Sending…" turns into "Not sent" when a message is neither queued in the
 * outbox nor confirmed and has been "sending" for over 5 seconds. A media send
 * is not queued until its upload has finished, so a long upload must not be
 * read as a failure while it is still going up.
 */
const wrap = (ui) => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
);
const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();
const mine = (over = {}) => ({
  id: 'c1', clientId: 'c1', tempId: 'c1', senderId: 'me', from: 'me', status: 'sending',
  isOptimistic: true, createdAt: minutesAgo(1), text: 'hi', ...over,
});
const renderBubble = (msg) =>
  render(wrap(<MessageBubble msg={msg} currentUser={{ id: 'me' }} isLatestMessage onOpenMediaModal={vi.fn()} />));

afterEach(cleanup);

describe('a message still going out', () => {
  it('an upload in progress stays "Sending…" however long it takes', () => {
    renderBubble(mine({
      uploadStatus: 'uploading', uploadProgress: 40, mediaType: 'video',
      payload: { localPreviewUrl: 'blob:http://x/1', mediaType: 'video' },
    }));
    expect(screen.getByText('Sending…')).toBeTruthy();
    expect(screen.queryByText(/Not sent/)).toBeNull();
  });

  it('a queued message stays "Sending…"', () => {
    renderBubble(mine({ queued: true }));
    expect(screen.getByText('Sending…')).toBeTruthy();
  });

  it('a message that is not queued, not uploading and was sent over 5 seconds ago is Not sent', () => {
    renderBubble(mine());
    expect(screen.getByText(/Not sent/)).toBeTruthy();
  });

  it('a failed upload is still Not sent', () => {
    renderBubble(mine({ uploadStatus: 'failed', status: 'failed' }));
    expect(screen.getByText(/Not sent/)).toBeTruthy();
  });
});
