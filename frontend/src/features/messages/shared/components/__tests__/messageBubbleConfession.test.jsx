/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal()),
  confessionsApi: api,
}));
vi.mock('@shared/context/AuthContext', async (importOriginal) => ({
  ...(await importOriginal()),
  useAuth: () => ({ isLoggedIn: true, currentUser: { id: 'me' } }),
}));
vi.mock('@shared/utils/MediaCacheManager', () => ({
  mediaCache: { getSyncUrl: (v) => v, getUrl: vi.fn(async (v) => v), invalidate: vi.fn() },
}));
vi.mock('@shared/hooks/useSignedMediaSrc', () => ({
  useSignedMediaSrc: (value) => ({ src: value || '', failed: false, pending: false, attempt: 0, refresh: vi.fn() }),
}));

const { default: MessageBubble } = await import('../MessageBubble');

/**
 * A shared confession the reader may no longer see reads as a plain message
 * state, like "This message was unsent", not as a broken card.
 */
const share = {
  id: 'm1',
  senderId: 'them',
  from: 'them',
  status: 'read',
  createdAt: new Date().toISOString(),
  text: '',
  inviteData: { type: 'confessionShare', confessionId: '11111111-1111-4111-8111-111111111111' },
};
const renderBubble = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>
      <MessageBubble msg={share} currentUser={{ id: 'me' }} onOpenMediaModal={vi.fn()} />
    </MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => {
  api.get.mockReset();
});
afterEach(cleanup);

describe('a shared confession in a chat', () => {
  it.each([404, 403])('reads like an unsent message when it is not available (%i)', async (status) => {
    api.get.mockRejectedValue(Object.assign(new Error('nope'), { status }));
    renderBubble();
    const line = await screen.findByText('This confession is no longer available');
    expect(line.tagName).toBe('SPAN');
    expect(line.style.fontStyle).toBe('italic');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('is the card while it is available', async () => {
    api.get.mockResolvedValue({
      confession: {
        id: share.inviteData.confessionId,
        handle: 'quiet.fern',
        content: 'Never read the syllabus.',
        createdAt: new Date().toISOString(),
        reactions: { love: 0, funny: 1, sad: 0, surprised: 0, relatable: 0 },
        reactionCount: 1,
        myReaction: null,
      },
    });
    renderBubble();
    expect(await screen.findByRole('link', { name: /Confession by @quiet.fern/ })).toBeTruthy();
    expect(screen.queryByText('This confession is no longer available')).toBeNull();
  });
});
