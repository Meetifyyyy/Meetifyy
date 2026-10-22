/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ addComment: vi.fn() }));
vi.mock('@shared/api/apiClient', () => ({ postsApi: api }));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));

import { useAddComment } from '../useAddComment';

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useAddComment(), { wrapper });
};

const keyOfCall = (i) => api.addComment.mock.calls[i][2]?.idempotencyKey;
const vars = { postId: 'p1', text: 'hello', parentId: null, mentions: [] };

afterEach(() => {
  cleanup();
  api.addComment.mockReset();
});

it('resends a failed comment under the same key, and the next comment under a new one', async () => {
  api.addComment
    .mockRejectedValueOnce(Object.assign(new TypeError('Failed to fetch'), { status: 0 }))
    .mockResolvedValueOnce({ id: 'c1', text: 'hello' })
    .mockResolvedValueOnce({ id: 'c2', text: 'hello' });
  const { result } = setup();

  await act(() => result.current.mutateAsync(vars).catch(() => {}));
  await act(() => result.current.mutateAsync(vars));
  expect(api.addComment).toHaveBeenNthCalledWith(1, 'p1', { text: 'hello', parentId: null, mentions: [] }, expect.any(Object));
  expect(keyOfCall(0)).toBeTruthy();
  // The retry is the same submission: the server replays it rather than posting twice.
  expect(keyOfCall(1)).toBe(keyOfCall(0));

  // Identical text after a success is a new comment.
  await act(() => result.current.mutateAsync(vars));
  expect(keyOfCall(2)).toBeTruthy();
  expect(keyOfCall(2)).not.toBe(keyOfCall(0));
});

it('gives a changed comment a new key even after a failure', async () => {
  api.addComment
    .mockRejectedValueOnce(Object.assign(new TypeError('Failed to fetch'), { status: 0 }))
    .mockResolvedValueOnce({ id: 'c1', text: 'hello!' });
  const { result } = setup();

  await act(() => result.current.mutateAsync(vars).catch(() => {}));
  await act(() => result.current.mutateAsync({ ...vars, text: 'hello!' }));
  expect(keyOfCall(1)).not.toBe(keyOfCall(0));
});
