/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Post deletion, end to end through the cache.
 *
 * Deletion used to remove the post from every cache the moment the request left
 * the browser. Instant, but it reads as finished — and that is a promise the
 * client cannot keep, because the request can still fail and the post then
 * reappears somewhere the user has already scrolled past. The card is now
 * MARKED immediately and removed only on a real success.
 */

const deletePost = vi.fn();
const toasts = [];

vi.mock('@shared/api/apiClient', () => ({
  // Added with the cookie migration: AuthContext reads this to decide
  // whether a cookie session is worth recovering.
  readCsrfCookie: () => '',
  postsApi: { deletePost: (...a) => deletePost(...a) },
}));
vi.mock('@shared/utils/toast', () => ({
  showToast: (msg, kind) => toasts.push({ msg, kind }),
}));

const { useDeletePost, DELETING_FLAG } = await import('../useDeletePost');

const post = (id, over = {}) => ({ id, text: `post ${id}`, ...over });

let queryClient;
const wrapper = ({ children }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

/** Seeds one cache of each shape the app actually stores posts in. */
function seedCaches() {
  // Flat array (profile lists).
  queryClient.setQueryData(['user-posts', 'alice'], [post('p1'), post('p2')]);
  // { posts } envelope.
  queryClient.setQueryData(['bookmarks'], { posts: [post('p1')], total: 1 });
  // Infinite query, `posts` pages (feed).
  queryClient.setQueryData(['feed'], {
    pages: [{ posts: [post('p1'), post('p3')] }, { posts: [post('p4')] }],
    pageParams: [null, 'c1'],
  });
  // Infinite query, `items` pages (community).
  queryClient.setQueryData(['community-posts', 'c9'], {
    pages: [{ items: [post('p1'), post('p5')] }],
    pageParams: [null],
  });
  // The detail entry.
  queryClient.setQueryData(['post', 'p1'], post('p1'));
}

const allCachedIds = () => {
  const out = [];
  const walk = (d) => {
    if (!d) return;
    if (Array.isArray(d)) return d.forEach((p) => out.push(p.id));
    if (Array.isArray(d.posts)) return d.posts.forEach((p) => out.push(p.id));
    if (d.pages) {
      d.pages.forEach((pg) => (pg.posts || pg.items || []).forEach((p) => out.push(p.id)));
    }
  };
  for (const key of [['user-posts', 'alice'], ['bookmarks'], ['feed'], ['community-posts', 'c9']]) {
    walk(queryClient.getQueryData(key));
  }
  return out;
};

/** Every cached copy of one post, across all four list shapes. */
const copiesOf = (id) => {
  const found = [];
  const walk = (d) => {
    if (!d) return;
    const scan = (list) => (list || []).forEach((p) => p.id === id && found.push(p));
    if (Array.isArray(d)) return scan(d);
    if (Array.isArray(d.posts)) return scan(d.posts);
    if (d.pages) d.pages.forEach((pg) => scan(pg.posts || pg.items));
  };
  for (const key of [['user-posts', 'alice'], ['bookmarks'], ['feed'], ['community-posts', 'c9']]) {
    walk(queryClient.getQueryData(key));
  }
  return found;
};

describe('deleting a post', () => {
  beforeEach(() => {
    deletePost.mockReset();
    toasts.length = 0;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    seedCaches();
  });
  afterEach(() => queryClient.clear());

  it('marks the post in every cache immediately, without waiting on the server', async () => {
    let resolve;
    deletePost.mockReturnValue(new Promise((r) => { resolve = r; }));

    const { result } = renderHook(() => useDeletePost(), { wrapper });
    await act(async () => { result.current.mutate({ postId: 'p1' }); });

    // Still in flight...
    expect(deletePost).toHaveBeenCalledTimes(1);
    // ...and every copy already says so. Four caches, four shapes.
    const marked = copiesOf('p1');
    expect(marked).toHaveLength(4);
    expect(marked.every((p) => p[DELETING_FLAG] === true)).toBe(true);

    // Crucially it is still THERE — the list has not collapsed under the reader.
    expect(allCachedIds().filter((id) => id === 'p1')).toHaveLength(4);

    await act(async () => { resolve({ success: true }); });
  });

  it('leaves every other post untouched', async () => {
    deletePost.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useDeletePost(), { wrapper });
    await act(async () => { result.current.mutate({ postId: 'p1' }); });

    await waitFor(() => expect(allCachedIds()).not.toContain('p1'));
    expect(allCachedIds().sort()).toEqual(['p2', 'p3', 'p4', 'p5']);
    expect(copiesOf('p3')[0][DELETING_FLAG]).toBeUndefined();
  });

  it('removes it from every cache on success, and refetches nothing', async () => {
    deletePost.mockResolvedValue({ success: true });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const refetch = vi.spyOn(queryClient, 'refetchQueries');

    const { result } = renderHook(() => useDeletePost(), { wrapper });
    await act(async () => { result.current.mutate({ postId: 'p1' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(copiesOf('p1')).toHaveLength(0);
    // The detail entry is removed, not invalidated — invalidating schedules a
    // fetch for a post the server will now answer 404 for.
    expect(queryClient.getQueryData(['post', 'p1'])).toBeUndefined();
    expect(invalidate).not.toHaveBeenCalled();
    expect(refetch).not.toHaveBeenCalled();
  });

  it('restores the post, unmarked, when the delete fails', async () => {
    deletePost.mockRejectedValue(Object.assign(new Error('Server error'), { status: 500 }));

    const { result } = renderHook(() => useDeletePost(), { wrapper });
    await act(async () => { result.current.mutate({ postId: 'p1' }); });
    await waitFor(() => expect(result.current.isError).toBe(true));

    const restored = copiesOf('p1');
    expect(restored).toHaveLength(4);
    // No card may be stranded showing "Deleting post…" forever.
    expect(restored.every((p) => p[DELETING_FLAG] === undefined)).toBe(true);
    expect(queryClient.getQueryData(['post', 'p1'])).toBeTruthy();
    expect(toasts).toEqual([{ msg: 'Server error', kind: 'error' }]);
  });

  it('surfaces a timeout as the message the user gets, not a silent restore', async () => {
    // apiClient turns an aborted request into this wording.
    deletePost.mockRejectedValue(new Error('Request timed out. Please check your connection and try again.'));

    const { result } = renderHook(() => useDeletePost(), { wrapper });
    await act(async () => { result.current.mutate({ postId: 'p1' }); });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(copiesOf('p1')).toHaveLength(4);
    expect(toasts[0].msg).toMatch(/timed out/i);
  });

  it('surfaces a network failure', async () => {
    // A dead connection reaches the hook as a bare TypeError with no status.
    deletePost.mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useDeletePost(), { wrapper });
    await act(async () => { result.current.mutate({ postId: 'p1' }); });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(copiesOf('p1')).toHaveLength(4);
    expect(toasts).toHaveLength(1);
  });

  it('treats an already-deleted post as done, quietly', async () => {
    // The user asked for it gone and it is gone. Restoring it and shouting
    // would be wrong on both counts.
    deletePost.mockRejectedValue(Object.assign(new Error('Post not found'), { status: 404 }));

    const { result } = renderHook(() => useDeletePost(), { wrapper });
    await act(async () => { result.current.mutate({ postId: 'p1' }); });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(copiesOf('p1')).toHaveLength(0);
    expect(queryClient.getQueryData(['post', 'p1'])).toBeUndefined();
    expect(toasts).toHaveLength(0);
  });

  it('issues exactly one request per post', async () => {
    deletePost.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useDeletePost(), { wrapper });
    await act(async () => { result.current.mutate({ postId: 'p1' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deletePost).toHaveBeenCalledTimes(1);
    expect(deletePost).toHaveBeenCalledWith('p1');
  });
});
