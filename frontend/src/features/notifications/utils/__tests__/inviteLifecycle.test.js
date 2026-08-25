import { describe, it, expect } from 'vitest';
import {
  INVITE_STATUS,
  inviteFromNotification,
  patchInviteNotification,
  resolveInviteStatus,
} from '../inviteLifecycle';

describe('resolveInviteStatus', () => {
  it('treats an unanswered invite to a live activity as pending', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect(resolveInviteStatus({ lifecycleStatus: 'PENDING', activityStatus: 'OPEN', startDate: future }))
      .toBe(INVITE_STATUS.PENDING);
  });

  it('expires a pending invite the moment its activity starts', () => {
    const justStarted = new Date(Date.now() - 1000).toISOString();
    expect(resolveInviteStatus({ lifecycleStatus: 'PENDING', startDate: justStarted }))
      .toBe(INVITE_STATUS.EXPIRED);
  });

  it('keeps an accepted invite accepted after the activity starts', () => {
    const justStarted = new Date(Date.now() - 1000).toISOString();
    expect(resolveInviteStatus({ lifecycleStatus: 'ACCEPTED', startDate: justStarted }))
      .toBe(INVITE_STATUS.ACCEPTED);
  });

  it('keeps the recipient\'s own answer even after the activity ends', () => {
    expect(resolveInviteStatus({ lifecycleStatus: 'ACCEPTED', activityStatus: 'ENDED' }))
      .toBe(INVITE_STATUS.ACCEPTED);
    expect(resolveInviteStatus({ lifecycleStatus: 'DECLINED', activityStatus: 'CANCELLED' }))
      .toBe(INVITE_STATUS.DECLINED);
  });

  it('reports a host cancellation and an ended activity distinctly', () => {
    expect(resolveInviteStatus({ lifecycleStatus: 'CANCELLED' })).toBe(INVITE_STATUS.CANCELLED);
    expect(resolveInviteStatus({ lifecycleStatus: 'EXPIRED' })).toBe(INVITE_STATUS.EXPIRED);
  });

  it('falls back to the activity for rows written before the lifecycle field', () => {
    expect(resolveInviteStatus({ status: 'PENDING', activityStatus: 'CANCELLED' }))
      .toBe(INVITE_STATUS.CANCELLED);
    expect(resolveInviteStatus({ status: 'PENDING', activityStatus: 'ENDED' }))
      .toBe(INVITE_STATUS.EXPIRED);
    // Expiry keys off the START time: once an activity has begun the invite can
    // no longer be accepted, so it must not still read as pending.
    expect(resolveInviteStatus({ status: 'PENDING', startDate: '2000-01-01T00:00:00.000Z' }))
      .toBe(INVITE_STATUS.EXPIRED);
  });
});

describe('inviteFromNotification', () => {
  it('carries the invite identity and status off the notification row', () => {
    const inv = inviteFromNotification({
      id: 'n1',
      entityId: 'act-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      actor: { id: 'host', username: 'host', displayName: 'Host' },
      metadata: { invitationId: 'inv-1', activityId: 'act-1', title: 'Coffee', lifecycleStatus: 'DECLINED' },
    });
    expect(inv.id).toBe('inv-1');
    expect(inv.notificationId).toBe('n1');
    expect(inv.activityId).toBe('act-1');
    expect(resolveInviteStatus(inv)).toBe(INVITE_STATUS.DECLINED);
  });
});

describe('patchInviteNotification', () => {
  // Stands in for react-query: the patcher walks every ['notifications', ...]
  // entry, so the double is keyed the same way.
  const makeClient = (data) => {
    let current = data;
    return {
      current: () => current,
      setQueriesData: (_filters, updater) => { current = updater(current); },
    };
  };

  it('updates the matching row in place without removing or duplicating it', () => {
    const client = makeClient({
      pages: [{ data: [
        { id: 'n1', type: 'ACTIVITY_INVITE', entityId: 'act-1', metadata: { invitationId: 'inv-1', lifecycleStatus: 'PENDING' } },
        { id: 'n2', type: 'FOLLOW', entityId: 'u1' },
      ] }],
    });

    patchInviteNotification(client, { invitationId: 'inv-1', status: 'ACCEPTED' });

    const rows = client.current().pages[0].data;
    expect(rows).toHaveLength(2);
    expect(rows[0].metadata.lifecycleStatus).toBe('ACCEPTED');
    expect(rows[0].metadata.invitationId).toBe('inv-1');
  });

  it('ignores a realtime event older than what the cache already holds', () => {
    const client = makeClient({
      pages: [{ data: [{
        id: 'n1',
        type: 'ACTIVITY_INVITE',
        entityId: 'act-1',
        metadata: {
          invitationId: 'inv-1',
          lifecycleStatus: 'CANCELLED',
          lifecycleUpdatedAt: '2026-01-02T00:00:00.000Z',
        },
      }] }],
    });

    patchInviteNotification(client, {
      invitationId: 'inv-1',
      metadata: { lifecycleStatus: 'ACCEPTED', lifecycleUpdatedAt: '2026-01-01T00:00:00.000Z' },
    });

    expect(client.current().pages[0].data[0].metadata.lifecycleStatus).toBe('CANCELLED');
  });

  it('applies a newer realtime event over an older cached one', () => {
    const client = makeClient({
      pages: [{ data: [{
        id: 'n1',
        type: 'ACTIVITY_INVITE',
        entityId: 'act-1',
        metadata: {
          invitationId: 'inv-1',
          lifecycleStatus: 'PENDING',
          lifecycleUpdatedAt: '2026-01-01T00:00:00.000Z',
        },
      }] }],
    });

    patchInviteNotification(client, {
      invitationId: 'inv-1',
      metadata: { lifecycleStatus: 'DECLINED', lifecycleUpdatedAt: '2026-01-02T00:00:00.000Z' },
    });

    expect(client.current().pages[0].data[0].metadata.lifecycleStatus).toBe('DECLINED');
  });

  it('leaves the cache untouched when nothing matches', () => {
    const original = { pages: [{ data: [{ id: 'n1', type: 'FOLLOW' }] }] };
    const client = makeClient(original);
    patchInviteNotification(client, { invitationId: 'nope', status: 'ACCEPTED' });
    expect(client.current()).toBe(original);
  });
});
