/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { showToast, postsApi } = vi.hoisted(() => ({
  showToast: vi.fn(),
  postsApi: { likePost: vi.fn(async () => ({})), unlikePost: vi.fn(async () => ({})) },
}));
vi.mock('@shared/utils/toast', () => ({ showToast }));
vi.mock('@shared/api/apiClient', () => ({ postsApi }));

import { useToggleMutation } from '../useToggleMutation';
import { useLikePost } from '@features/feed/hooks/useLikePost';

/**
 * Likes, saves, joins and follows are refused offline rather than flipped and
 * taken back: the button does not move, one sentence says why, nothing is sent.
 */
let onLine;
const wrapper = ({ children }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

beforeEach(() => {
  onLine = false;
  vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => onLine);
  showToast.mockReset();
  postsApi.likePost.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('toggles offline', () => {
  it('useToggleMutation: no optimistic write, no request, one toast', () => {
    const applyOptimistic = vi.fn();
    const callApi = vi.fn(async () => ({}));
    const { result } = renderHook(
      () => useToggleMutation({
        entityKey: (v) => `save:${v.id}`,
        applyOptimistic,
        applyRollback: vi.fn(),
        callApi,
      }),
      { wrapper },
    );

    act(() => result.current.mutate({ id: 'p1', isSaved: true }));

    expect(applyOptimistic).not.toHaveBeenCalled();
    expect(callApi).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][0]).toMatch(/offline/i);
  });

  it('useToggleMutation: works online', async () => {
    onLine = true;
    const applyOptimistic = vi.fn();
    const callApi = vi.fn(async () => ({}));
    const { result } = renderHook(
      () => useToggleMutation({
        entityKey: (v) => `save:${v.id}`,
        applyOptimistic,
        applyRollback: vi.fn(),
        callApi,
      }),
      { wrapper },
    );
    await act(async () => { result.current.mutate({ id: 'p2', isSaved: true }); });
    expect(applyOptimistic).toHaveBeenCalledTimes(1);
    expect(callApi).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('likes: the heart is not flipped and nothing is sent offline', () => {
    const { result } = renderHook(() => useLikePost(), { wrapper });
    const post = { id: 'post-offline-1', hasLiked: false, likeCount: 3 };

    let shown;
    act(() => { shown = result.current.toggle(post, 'me'); });

    expect(shown).toEqual({ liked: false, count: 3 });
    expect(postsApi.likePost).not.toHaveBeenCalled();
    expect(showToast.mock.calls[0][0]).toMatch(/offline/i);
  });
});
