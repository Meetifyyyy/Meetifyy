import { describe, expect, it, vi } from 'vitest';
import { forwardClientId, forwardedInviteData, newForwardOperationId } from '../forwardDelivery';

describe('forward operation ids', () => {
  it('come from a secure source, never Math.random, and fail loudly without one', () => {
    const random = vi.spyOn(Math, 'random');
    vi.stubGlobal('crypto', { getRandomValues: (a) => a.fill(171) });
    expect(newForwardOperationId()).toBe('ab'.repeat(12));
    expect(random).not.toHaveBeenCalled();
    vi.stubGlobal('crypto', undefined);
    expect(() => newForwardOperationId()).toThrow();
    vi.unstubAllGlobals();
    random.mockRestore();
  });

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

describe('forwardedInviteData', () => {
  it('carries a shared item on, on either message shape', () => {
    const confession = { type: 'confessionShare', confessionId: 'cf1' };
    expect(forwardedInviteData({ inviteData: confession })).toBe(confession);
    const post = { type: 'postShare', post: { id: 'p1' } };
    expect(forwardedInviteData({ payload: { inviteData: post } })).toBe(post);
  });

  it('never passes on a group invite, and nothing for a plain message', () => {
    expect(forwardedInviteData({ inviteData: { type: 'group_invite', groupId: 'g1' } })).toBeNull();
    expect(forwardedInviteData({ inviteData: { groupId: 'g1', groupName: 'Chess' } })).toBeNull();
    expect(forwardedInviteData({ text: 'hi' })).toBeNull();
  });
});

