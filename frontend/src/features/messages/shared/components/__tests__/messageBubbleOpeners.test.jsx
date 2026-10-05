/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@shared/utils/MediaCacheManager', () => ({
  mediaCache: { getSyncUrl: (v) => v, getUrl: vi.fn(async (v) => v), invalidate: vi.fn() },
}));
vi.mock('@shared/hooks/useSignedMediaSrc', () => ({
  useSignedMediaSrc: (value) => ({ src: value || '', failed: false, pending: false, attempt: 0, refresh: vi.fn() }),
}));

import MessageBubble from '../MessageBubble';

const ME = { id: 'me' };
const wrap = (ui) => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
);

const message = (over = {}) => ({
  id: 'msg-9',
  senderId: 'them',
  senderName: 'Asha',
  status: 'sent',
  createdAt: new Date().toISOString(),
  mediaUrl: 'https://api.example/api/media/chat/p.jpg',
  mediaType: 'image',
  ...over,
});

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

function open(msg) {
  const onOpenMediaModal = vi.fn();
  render(wrap(<MessageBubble msg={msg} currentUser={ME} onOpenMediaModal={onOpenMediaModal} />));
  return onOpenMediaModal;
}

describe('MessageBubble media openers', () => {
  it('opens an image from a real button and offers Report for someone else\'s confirmed message', () => {
    const onOpen = open(message());
    fireEvent.click(screen.getByRole('button', { name: 'Open photo' }));
    expect(onOpen).toHaveBeenCalledWith(
      'https://api.example/api/media/chat/p.jpg',
      'image',
      {
        report: { targetType: 'MESSAGE', targetId: 'msg-9', name: 'Asha' },
        rawUrl: 'https://api.example/api/media/chat/p.jpg',
      },
    );
  });

  it('offers no report target for an optimistic id', () => {
    const onOpen = open(message({ id: 'temp_123_abc' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open photo' }));
    expect(onOpen.mock.calls[0][2]).not.toHaveProperty('report');
  });

  it('offers no report target for the current user\'s own message', () => {
    const onOpen = open(message({ senderId: 'me', from: 'me' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open photo' }));
    expect(onOpen.mock.calls[0][2]).not.toHaveProperty('report');
  });

  it('opens a captioned video through the same opener', () => {
    const onOpen = open(message({
      mediaUrl: 'https://api.example/api/media/chat/c.mp4',
      mediaType: 'video',
      text: 'look at this',
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Open video' }));
    expect(onOpen).toHaveBeenCalledWith(
      'https://api.example/api/media/chat/c.mp4',
      'video',
      {
        report: { targetType: 'MESSAGE', targetId: 'msg-9', name: 'Asha' },
        rawUrl: 'https://api.example/api/media/chat/c.mp4',
      },
    );
  });
});
