import { describe, expect, it, vi } from 'vitest';
import {
  ForwardPartialError,
  forwardClientId,
  forwardToTargets,
  newForwardOperationId,
} from '../forwardDelivery';

describe('forward operation ids', () => {
  it('are unique per operation and short enough to leave room for the recipient', () => {
    const a = newForwardOperationId();
    const b = newForwardOperationId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(8);
    expect(a.length).toBeLessThanOrEqual(24);
  });

  it('derive a stable client id per recipient and never exceed the server limit', () => {
    expect(forwardClientId('op1', 'userA')).toBe(forwardClientId('op1', 'userA'));
    expect(forwardClientId('op1', 'userA')).not.toBe(forwardClientId('op1', 'userB'));
    expect(forwardClientId('op1', 'userA')).not.toBe(forwardClientId('op2', 'userA'));
    expect(forwardClientId('op', 'x'.repeat(500)).length).toBeLessThanOrEqual(128);
  });
});

describe('forwardToTargets', () => {
  it('sends to everyone, passing each recipient its stable client id', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await forwardToTargets({ targetIds: ['a', 'b'], operationId: 'op', send });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, 'a', forwardClientId('op', 'a'));
    expect(send).toHaveBeenNthCalledWith(2, 'b', forwardClientId('op', 'b'));
  });

  it('keeps going after a failure and reports exactly who is left', async () => {
    const send = vi.fn(async (id) => { if (id === 'b') throw new Error('nope'); });
    const error = await forwardToTargets({ targetIds: ['a', 'b', 'c'], operationId: 'op', send })
      .catch((e) => e);
    expect(send).toHaveBeenCalledTimes(3);
    expect(error).toBeInstanceOf(ForwardPartialError);
    expect(error.failedIds).toEqual(['b']);
    expect(error.sentCount).toBe(2);
    expect(error.total).toBe(3);
  });

  it('reports a total failure as such', async () => {
    const send = vi.fn().mockRejectedValue(new Error('down'));
    const error = await forwardToTargets({ targetIds: ['a', 'b'], operationId: 'op', send }).catch((e) => e);
    expect(error.failedIds).toEqual(['a', 'b']);
    expect(error.sentCount).toBe(0);
  });

  it('a retry reuses the same client ids, so the server can recognise repeats', async () => {
    const seen = [];
    let failB = true;
    const send = async (id, clientId) => {
      seen.push([id, clientId]);
      if (id === 'b' && failB) throw new Error('flaky');
    };
    await forwardToTargets({ targetIds: ['a', 'b'], operationId: 'op', send }).catch(() => {});
    failB = false;
    await forwardToTargets({ targetIds: ['a', 'b'], operationId: 'op', send });
    const clientIdsFor = (id) => seen.filter(([who]) => who === id).map(([, c]) => c);
    expect(new Set(clientIdsFor('a')).size).toBe(1);
    expect(new Set(clientIdsFor('b')).size).toBe(1);
  });

  it('treats a missing target list as nothing to do', async () => {
    const send = vi.fn();
    await expect(forwardToTargets({ targetIds: undefined, operationId: 'op', send })).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});
