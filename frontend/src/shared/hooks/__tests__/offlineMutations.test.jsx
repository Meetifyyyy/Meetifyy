/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@shared/utils/toast', () => ({ showToast }));

import { installNetworkStatus } from '@shared/lib/networkStatus';
import { mutationDefaults } from '@shared/lib/mutationDefaults';
import {
  blockIfOffline, assertOnline, offlineMessage, submitErrorMessage, OfflineError, isOfflineError,
} from '@shared/lib/offlineGuard';
import { useGuardedMutation } from '../useGuardedMutation';

/**
 * Offline, a mutation must not be queued behind the user's back: no spinner
 * that never ends, no success announced minutes later, no second copy when the
 * connection returns.
 */

let onLine = true;
const setNetwork = (online) => {
  onLine = online;
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
};

function wrapperFor(client) {
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  onLine = true;
  vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => onLine);
  installNetworkStatus();
  showToast.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('mutation networkMode', () => {
  it("TanStack's default ('online') pauses offline and would fire later: the hidden queue", async () => {
    onLine = false;
    installNetworkStatus();
    const client = new QueryClient();
    const mutationFn = vi.fn(async () => 'created');
    const { result } = renderHook(() => useMutation({ mutationFn }), { wrapper: wrapperFor(client) });

    act(() => { result.current.mutate('x'); });
    await waitFor(() => expect(result.current.isPaused).toBe(true));
    expect(mutationFn).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true); // the spinner that never stops

    act(() => setNetwork(true));
    await waitFor(() => expect(mutationFn).toHaveBeenCalledTimes(1)); // fires later, unannounced
  });

  it("our default ('always') runs at once and fails fast: nothing is paused, nothing fires later", async () => {
    expect(mutationDefaults.networkMode).toBe('always');
    onLine = false;
    installNetworkStatus();
    const client = new QueryClient({ defaultOptions: { mutations: mutationDefaults } });
    const mutationFn = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const { result } = renderHook(() => useMutation({ mutationFn }), { wrapper: wrapperFor(client) });

    act(() => { result.current.mutate('x'); });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isPaused).toBe(false);
    expect(result.current.isPending).toBe(false);
    expect(mutationFn).toHaveBeenCalledTimes(1);

    act(() => setNetwork(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(mutationFn).toHaveBeenCalledTimes(1); // no replay on reconnect
  });
});

describe('useGuardedMutation', () => {
  const setup = (mutationFn, kind) => {
    const client = new QueryClient({ defaultOptions: { mutations: mutationDefaults } });
    return renderHook(() => useGuardedMutation(useMutation({ mutationFn }), kind), { wrapper: wrapperFor(client) });
  };

  it('offline: mutateAsync rejects with an OfflineError, shows one reason, sends nothing', async () => {
    onLine = false;
    const mutationFn = vi.fn(async () => 'created');
    const { result } = setup(mutationFn, 'activity');

    let caught;
    await act(async () => {
      try { await result.current.mutateAsync({ title: 'Hike' }); } catch (e) { caught = e; }
    });

    expect(isOfflineError(caught)).toBe(true);
    expect(caught.message).toBe(offlineMessage('activity'));
    expect(mutationFn).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(false);
    expect(result.current.isSuccess).toBe(false);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][0]).toBe(offlineMessage('activity'));
    expect(showToast.mock.calls[0][1]).toBe('error');

    // And nothing is waiting to fire when the connection comes back.
    act(() => setNetwork(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(mutationFn).not.toHaveBeenCalled();
  });

  it('offline: mutate calls the per-call onError and onSettled, so a busy flag clears', () => {
    onLine = false;
    const mutationFn = vi.fn(async () => 'x');
    const { result } = setup(mutationFn, 'action');
    const onError = vi.fn();
    const onSettled = vi.fn();

    act(() => { result.current.mutate('v', { onError, onSettled }); });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(isOfflineError(onError.mock.calls[0][0])).toBe(true);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(mutationFn).not.toHaveBeenCalled();
  });

  it('online: behaves like a plain mutation', async () => {
    const mutationFn = vi.fn(async (v) => `made ${v}`);
    const { result } = setup(mutationFn, 'post');
    let out;
    await act(async () => { out = await result.current.mutateAsync('a'); });
    expect(out).toBe('made a');
    expect(showToast).not.toHaveBeenCalled();
  });

  it('keeps mutate and mutateAsync stable across renders (callers put them in dependency arrays)', () => {
    const { result, rerender } = setup(async () => 'x', 'action');
    const { mutate, mutateAsync } = result.current;
    rerender();
    expect(result.current.mutate).toBe(mutate);
    expect(result.current.mutateAsync).toBe(mutateAsync);
  });
});

describe('offlineGuard', () => {
  it('blockIfOffline refuses with a message offline and is silent online', () => {
    expect(blockIfOffline('post')).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
    onLine = false;
    expect(blockIfOffline('post')).toBe(true);
    expect(showToast.mock.calls[0][0]).toMatch(/offline.*saved as a draft/i);
  });

  it('assertOnline throws an OfflineError offline, without a toast of its own', () => {
    expect(() => assertOnline('comment')).not.toThrow();
    onLine = false;
    expect(() => assertOnline('comment')).toThrow(OfflineError);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('submitErrorMessage: a lost connection promises the draft is kept; other errors keep their words', () => {
    const lost = new TypeError('Failed to fetch');
    expect(submitErrorMessage(lost)).toMatch(/kept/i);
    onLine = false;
    expect(submitErrorMessage(lost)).toBe(offlineMessage('action'));
    onLine = true;
    expect(submitErrorMessage(Object.assign(new Error('Text is too long'), { status: 400 }))).toBe('Text is too long');
    expect(submitErrorMessage(new Error(''), 'Post failed')).toBe('Post failed');
  });
});
