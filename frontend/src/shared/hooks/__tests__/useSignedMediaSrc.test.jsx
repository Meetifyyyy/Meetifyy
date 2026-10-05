/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const cache = vi.hoisted(() => ({
  getSyncUrl: vi.fn(),
  getUrl: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock('@shared/utils/MediaCacheManager', () => ({ mediaCache: cache }));

import { useSignedMediaSrc } from '../useSignedMediaSrc';

beforeEach(() => {
  vi.clearAllMocks();
  // Absolute URLs need no signing; bare conversation keys have no sync answer.
  cache.getSyncUrl.mockImplementation((v) => (v.startsWith('http') || v.startsWith('/') ? v : null));
});

describe('useSignedMediaSrc retry', () => {
  it('counts retries even when the URL needs no signing and so does not change', () => {
    const { result } = renderHook(() => useSignedMediaSrc('https://cdn.example/a.mp4'));
    expect(result.current.src).toBe('https://cdn.example/a.mp4');
    expect(result.current.attempt).toBe(0);

    act(() => result.current.refresh());

    expect(result.current.attempt).toBe(1);
    expect(result.current.src).toBe('https://cdn.example/a.mp4');
    expect(result.current.pending).toBe(false);
    expect(cache.getUrl).not.toHaveBeenCalled();
  });

  it('drops the stale signature in the same render as the new attempt, then re-signs', async () => {
    let call = 0;
    cache.getUrl.mockImplementation(async () => `https://signed.example/v.mp4?sig=${++call}`);
    const { result } = renderHook(() => useSignedMediaSrc('chat/abc.mp4'));
    await waitFor(() => expect(result.current.src).toBe('https://signed.example/v.mp4?sig=1'));

    act(() => result.current.refresh());

    expect(cache.invalidate).toHaveBeenCalledWith('chat/abc.mp4');
    expect(result.current.attempt).toBe(1);
    expect(result.current.src).toBe('');
    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.src).toBe('https://signed.example/v.mp4?sig=2'));
    expect(result.current.failed).toBe(false);
  });

  it('reports failure only once the server has declined, and a retry clears it', async () => {
    cache.getUrl.mockResolvedValueOnce(null).mockResolvedValueOnce('https://signed.example/ok.mp4');
    const { result } = renderHook(() => useSignedMediaSrc('chat/abc.mp4'));
    await waitFor(() => expect(result.current.failed).toBe(true));

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.src).toBe('https://signed.example/ok.mp4'));
    expect(result.current.failed).toBe(false);
  });
});
