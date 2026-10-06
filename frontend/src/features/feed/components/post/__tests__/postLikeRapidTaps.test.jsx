/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

const server = vi.hoisted(() => ({ requests: [] }));
vi.mock('@shared/api/apiClient', () => {
  const pending = (liked) => new Promise((resolve, reject) => server.requests.push({ liked, resolve, reject }));
  return {
    postsApi: { likePost: () => pending(true), unlikePost: () => pending(false) },
    getMediaUrl: (u) => u,
  };
});
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'me' } }) }));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));
vi.mock('../../modals/SharePostModal', () => ({ default: () => null }));
vi.mock('../../../hooks/useSavePost', () => ({ useSavePost: () => ({ mutate: vi.fn() }) }));

const { default: PostActions } = await import('../PostActions');
const { __resetLikeSync, applyRemoteLike } = await import('@shared/utils/likeSync');
const { writePostLike, postLikeKey } = await import('../../../hooks/useLikePost');

afterEach(() => { cleanup(); __resetLikeSync(); server.requests.length = 0; });

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/** The open post, read from the same cache the app uses. */
function OpenPost() {
  const { data } = useQuery({ queryKey: ['post', 'p1'], queryFn: () => new Promise(() => {}), staleTime: Infinity });
  return data ? <PostActions post={data} /> : null;
}

function setup(initial = { id: 'p1', likeCount: 3, hasLiked: false, commentCount: 0 }) {
  const qc = new QueryClient();
  qc.setQueryData(['post', 'p1'], initial);
  const seen = [];
  const utils = render(<QueryClientProvider client={qc}><OpenPost /></QueryClientProvider>);
  const button = utils.getByLabelText('Like post');
  const read = () => ({ count: Number(button.textContent), liked: button.className.includes('liked') });
  // React Query hands cache writes to components on the next tick; each tap
  // waits for that one tick before reading what is on screen.
  const tap = async () => {
    fireEvent.click(button);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    seen.push(read().count);
  };
  return { qc, read, tap, seen };
}

describe('rapid like tapping on a post', () => {
  it('follows every tap instantly and ends on the last one, with one request per settled state', async () => {
    const { read, tap, seen } = setup();
    for (let i = 0; i < 9; i += 1) await tap(); // odd → liked
    expect(read()).toEqual({ count: 4, liked: true });
    expect(new Set(seen)).toEqual(new Set([3, 4]));
    await flush();
    expect(server.requests).toHaveLength(1);

    server.requests[0].resolve({ liked: true, likeCount: 4, version: 1 });
    await flush();
    expect(server.requests).toHaveLength(1);
    expect(read()).toEqual({ count: 4, liked: true });
  });

  it('survives a stale refetch, a late event and someone else\'s like mid-burst', async () => {
    const { qc, read, tap } = setup();
    await tap(); // like (3 → 4), request 1 in flight
    await tap(); // unlike — waits behind request 1
    expect(read()).toEqual({ count: 3, liked: false });

    // A list refetch that started before any of this lands with the old snapshot.
    act(() => { qc.setQueryData(['post', 'p1'], { id: 'p1', likeCount: 3, hasLiked: false, commentCount: 0 }); });
    await flush();
    expect(read()).toEqual({ count: 3, liked: false });

    // Someone else likes (server 3 → 4, before my like lands).
    act(() => {
      const shown = applyRemoteLike(postLikeKey('p1'), { count: 4, version: 1, liked: true, byMe: false });
      writePostLike(qc, 'p1', shown);
    });
    await flush();
    expect(read()).toEqual({ count: 4, liked: false });

    server.requests[0].resolve({ liked: true, likeCount: 5, version: 2 });
    await flush();
    expect(server.requests.map((r) => r.liked)).toEqual([true, false]);
    expect(read()).toEqual({ count: 4, liked: false });

    // A delayed event from before my like: ignored.
    act(() => {
      const shown = applyRemoteLike(postLikeKey('p1'), { count: 4, version: 1 });
      if (shown) writePostLike(qc, 'p1', shown);
    });
    server.requests[1].resolve({ liked: false, likeCount: 4, version: 3 });
    await flush();
    expect(read()).toEqual({ count: 4, liked: false });
  });

  it('rolls back to the server\'s state when the request fails', async () => {
    const { read, tap } = setup();
    await tap();
    await flush();
    server.requests[0].reject(new Error('Network Error'));
    // The rejection settles, then React Query delivers the rollback a tick
    // later; wait for the outcome rather than a fixed number of ticks.
    await waitFor(() => expect(read()).toEqual({ count: 3, liked: false }));
  });
});
