import { describe, it, expect } from 'vitest';
import { INVITE_STATUS, resolveInviteStatus } from '../inviteLifecycle';

/**
 * The list the Invitations tab renders, reproduced exactly as NotificationsRoute
 * builds it: notification rows first, pending-endpoint rows for anything the
 * feed has not got, then the answers taken in this session applied on top.
 *
 * The bug this covers: an invite whose notification row has not been written yet
 * (the notification job is asynchronous, and on a deployment without a queue
 * worker it never ran at all) existed only in the pending-endpoint list — which
 * drops it the instant it stops being pending. Answering it therefore made the
 * row disappear instead of turning into Accepted/Declined.
 */
function buildInvitations({ inviteNotifications = [], pendingInvitations = [], settledInvites = {} }) {
  const rows = [];
  const seen = new Set();

  for (const inv of inviteNotifications) {
    if (!inv.activityId || seen.has(inv.activityId)) continue;
    seen.add(inv.activityId);
    rows.push(inv);
  }
  for (const inv of pendingInvitations) {
    if (seen.has(inv.activityId)) continue;
    seen.add(inv.activityId);
    rows.push(inv);
  }

  const withAnswers = rows.map(row => {
    const settled =
      settledInvites[row.id] ||
      Object.values(settledInvites).find(s => s.activityId && s.activityId === row.activityId);
    if (!settled) return row;
    if (resolveInviteStatus(row) !== INVITE_STATUS.PENDING) return row;
    return { ...row, lifecycleStatus: settled.status };
  });

  const known = new Set(withAnswers.map(r => r.id));
  for (const [invitationId, settled] of Object.entries(settledInvites)) {
    if (!known.has(invitationId) && settled.row) {
      withAnswers.push({ ...settled.row, lifecycleStatus: settled.status });
    }
  }
  return withAnswers;
}

const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const pendingRow = { id: 'inv-1', activityId: 'act-1', startDate: future, status: 'PENDING' };

describe('answering an invite', () => {
  it('shows Accepted immediately on a row that only the pending endpoint knows about', () => {
    const rows = buildInvitations({
      pendingInvitations: [pendingRow],
      settledInvites: { 'inv-1': { status: 'ACCEPTED', activityId: 'act-1', row: pendingRow } },
    });

    expect(rows).toHaveLength(1);
    expect(resolveInviteStatus(rows[0])).toBe(INVITE_STATUS.ACCEPTED);
  });

  it('keeps the row visible after the pending endpoint drops it', () => {
    // What the next refetch looks like: no longer pending, notification not yet
    // written. Previously the row vanished here.
    const rows = buildInvitations({
      pendingInvitations: [],
      settledInvites: { 'inv-1': { status: 'DECLINED', activityId: 'act-1', row: pendingRow } },
    });

    expect(rows).toHaveLength(1);
    expect(resolveInviteStatus(rows[0])).toBe(INVITE_STATUS.DECLINED);
  });

  it('does not duplicate the row once the notification arrives', () => {
    const notifRow = {
      id: 'inv-1',
      activityId: 'act-1',
      startDate: future,
      lifecycleStatus: 'ACCEPTED',
    };
    const rows = buildInvitations({
      inviteNotifications: [notifRow],
      pendingInvitations: [],
      settledInvites: { 'inv-1': { status: 'ACCEPTED', activityId: 'act-1', row: pendingRow } },
    });

    expect(rows).toHaveLength(1);
    expect(resolveInviteStatus(rows[0])).toBe(INVITE_STATUS.ACCEPTED);
  });

  it('lets a server-confirmed cancellation win over the local answer', () => {
    const cancelled = { id: 'inv-1', activityId: 'act-1', startDate: future, lifecycleStatus: 'CANCELLED' };
    const rows = buildInvitations({
      inviteNotifications: [cancelled],
      settledInvites: { 'inv-1': { status: 'ACCEPTED', activityId: 'act-1', row: pendingRow } },
    });

    expect(resolveInviteStatus(rows[0])).toBe(INVITE_STATUS.CANCELLED);
  });

  it('leaves other invites untouched', () => {
    const other = { id: 'inv-2', activityId: 'act-2', startDate: future, status: 'PENDING' };
    const rows = buildInvitations({
      pendingInvitations: [pendingRow, other],
      settledInvites: { 'inv-1': { status: 'ACCEPTED', activityId: 'act-1', row: pendingRow } },
    });

    const byId = Object.fromEntries(rows.map(r => [r.id, resolveInviteStatus(r)]));
    expect(byId['inv-1']).toBe(INVITE_STATUS.ACCEPTED);
    expect(byId['inv-2']).toBe(INVITE_STATUS.PENDING);
  });
});
