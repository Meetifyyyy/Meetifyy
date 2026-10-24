/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
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
 * The bubble carries the two facts the thread's stylesheet needs to space it:
 * whether it closes up against the row above (a run), and whether it ends in a
 * status line the next row must stay clear of. Both are attributes, so the
 * spacing lives in CSS and the bubble renders the same either way.
 */
const wrap = (ui) => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
);
const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();
const mine = (over = {}) => ({
  id: 'm1', senderId: 'u-me', from: 'me', status: 'read', createdAt: minutesAgo(5), text: 'hi', ...over,
});
const theirs = (over = {}) => ({
  id: 't1', senderId: 'u-a', senderName: 'Aarav', status: 'read', createdAt: minutesAgo(5), text: 'hey', ...over,
});
const row = (msg, props = {}) => {
  const { container } = render(
    wrap(<MessageBubble msg={msg} currentUser={{ id: 'u-me' }} onOpenMediaModal={vi.fn()} {...props} />),
  );
  return container.querySelector('[data-message-id]');
};

afterEach(cleanup);

describe('data-run', () => {
  it('is set on a row the list says closes up against the one above it', () => {
    expect(row(mine(), { continuesRun: true }).getAttribute('data-run')).toBe('continue');
  });

  it('is absent on a row that starts a run', () => {
    expect(row(mine(), { continuesRun: false }).hasAttribute('data-run')).toBe(false);
    expect(row(mine()).hasAttribute('data-run')).toBe(false);
  });

  it('reflects the list\'s answer for any kind of row, deciding nothing itself', () => {
    // Which rows may close up (not a group member's, not a post reply's) is
    // utils/messageRuns.clusterFlags' call; the bubble just shows it.
    expect(row(theirs(), { continuesRun: true, conversation: { isGroup: false } }).getAttribute('data-run')).toBe('continue');
    expect(row(theirs(), { continuesRun: false, conversation: { isGroup: true } }).hasAttribute('data-run')).toBe(false);
    const reply = mine({ replyTo: { id: 'x', senderName: 'Aarav', text: 'quoted' } });
    expect(row(reply, { continuesRun: true }).getAttribute('data-run')).toBe('continue');
  });
});

describe('data-status-line', () => {
  it('marks your latest message, which shows "Sent" / "Seen"', () => {
    expect(row(mine(), { isLatestMessage: true }).hasAttribute('data-status-line')).toBe(true);
  });

  it('marks a queued message, which shows "Sending…", wherever it is in the thread', () => {
    expect(row(mine({ queued: true, status: 'sending' })).hasAttribute('data-status-line')).toBe(true);
  });

  it('marks a failed message, which shows "Not delivered"', () => {
    expect(row(mine({ status: 'failed' })).hasAttribute('data-status-line')).toBe(true);
  });

  it('does not mark an ordinary earlier message, or anyone else\'s', () => {
    expect(row(mine()).hasAttribute('data-status-line')).toBe(false);
    expect(row(theirs(), { isLatestMessage: true }).hasAttribute('data-status-line')).toBe(false);
  });
});
