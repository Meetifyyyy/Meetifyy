/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';

/**
 * When the roster is read.
 *
 * The server owns the list, so the only decisions here are timing ones, and
 * each of them exists for a reason: a burst of queue movement must not become
 * a burst of reads, a reconnect must re-read because the events that fired
 * while the socket was down were never delivered, and a failed refresh must
 * not blank a list that is already on screen.
 */

const listeners = new Map();
const listQueue = vi.fn();

vi.mock('../../utils/matchSocketClient', () => ({
  default: {
    acquire: () => () => {},
    listQueue: (...a) => listQueue(...a),
    on: (event, cb) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(cb);
      return () => listeners.get(event).delete(cb);
    },
  },
}));

const { useSearchingNow } = await import('../useSearchingNow');

const ok = (people) => ({ ok: true, data: { status: 'ok', people } });
const rows = (id) => [{ user: { id, displayName: id }, activity: 'study', timePreference: 'now', area: null, optionalDetail: null, joinedAt: Date.now() }];

const emit = (event, payload) => act(() => {
  for (const cb of listeners.get(event) ?? []) cb(payload);
});

beforeEach(() => {
  listeners.clear();
  listQueue.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => { vi.useRealTimers(); cleanup(); });

describe('useSearchingNow', () => {
  it('reads once on mount and reports what came back', async () => {
    listQueue.mockResolvedValue(ok(rows('riya')));
    const { result } = renderHook(() => useSearchingNow(true));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.people).toHaveLength(1));
    expect(result.current.loading).toBe(false);
    expect(listQueue).toHaveBeenCalledTimes(1);
  });

  it('reads nothing at all when the screen is not up', () => {
    renderHook(() => useSearchingNow(false));
    expect(listQueue).not.toHaveBeenCalled();
  });

  it('collapses a burst of queue movement into one re-read', async () => {
    listQueue.mockResolvedValue(ok(rows('riya')));
    const { result } = renderHook(() => useSearchingNow(true));
    await waitFor(() => expect(result.current.people).toHaveLength(1));

    listQueue.mockResolvedValue(ok(rows('arjun')));
    emit('queue:changed', {});
    emit('queue:changed', {});
    emit('queue:changed', {});
    await act(async () => { vi.advanceTimersByTime(1600); });

    await waitFor(() => expect(result.current.people[0].user.id).toBe('arjun'));
    expect(listQueue).toHaveBeenCalledTimes(2);
  });

  it('re-reads after a reconnect, since events were missed while it was down', async () => {
    listQueue.mockResolvedValue(ok(rows('riya')));
    const { result } = renderHook(() => useSearchingNow(true));
    await waitFor(() => expect(result.current.people).toHaveLength(1));

    emit('transport:status', { connected: true });
    await act(async () => { vi.advanceTimersByTime(1600); });
    expect(listQueue).toHaveBeenCalledTimes(2);
  });

  it('keeps the rows it has when a refresh fails', async () => {
    listQueue.mockResolvedValue(ok(rows('riya')));
    const { result } = renderHook(() => useSearchingNow(true));
    await waitFor(() => expect(result.current.people).toHaveLength(1));

    listQueue.mockResolvedValue({ ok: false, error: 'Something went wrong' });
    emit('queue:changed', {});
    await act(async () => { vi.advanceTimersByTime(1600); });

    expect(result.current.people).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('reports a first read that failed, and clears it on retry', async () => {
    listQueue.mockResolvedValueOnce({ ok: false, error: 'Could not load who is searching' });
    const { result } = renderHook(() => useSearchingNow(true));

    await waitFor(() => expect(result.current.error).toBe('Could not load who is searching'));
    expect(result.current.loading).toBe(false);

    listQueue.mockResolvedValueOnce(ok(rows('riya')));
    await act(async () => { result.current.retry(); });
    await waitFor(() => expect(result.current.people).toHaveLength(1));
    expect(result.current.error).toBeNull();
  });
});
