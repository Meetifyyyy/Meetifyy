import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  applyOwnMembership,
  applyOthersMembership,
  isCurrentMembership,
  newerMembership,
  resetMembershipEventMemory,
  seedJoinedGroup,
} from '../groupMembership';

/**
 * The removed user's chat must close at once and stay closed: across events
 * that arrive late, twice or out of order, and with no cached copy left that
 * says otherwise. This is the client half of the "removed, but the composer
 * is still open until a restart" report.
 */
const T1 = '2026-10-27T10:00:00.000Z';
const T2 = '2026-10-27T10:05:00.000Z';
const T3 = '2026-10-27T10:10:00.000Z';

const group = (over = {}) => ({
  id: 'pub-1',
  publicId: 'pub-1',
  internalId: 'int-1',
  type: 'GROUP',
  isGroup: true,
  isMember: true,
  memberCount: 3,
  ...over,
});

let qc;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  resetMembershipEventMemory();
});

const row = () => qc.getQueryData(['conversations'])[0];

describe('applyOwnMembership: the viewer is removed', () => {
  it('closes the group in the list and in the open chat history', () => {
    qc.setQueryData(['conversations'], [group()]);
    qc.setQueryData(['messages', 'pub-1'], {
      pages: [{ messages: [], isMember: true, canSendMessages: true }],
      pageParams: [undefined],
    });
    applyOwnMembership(qc, { ids: ['pub-1', 'int-1'], isMember: false, changedAt: T2 });
    expect(row()).toMatchObject({ isMember: false, myMembershipStatus: 'KICKED', membershipChangedAt: T2 });
    expect(qc.getQueryData(['messages', 'pub-1']).pages[0]).toMatchObject({
      isMember: false,
      canSendMessages: false,
    });
  });

  it('drops the cached group details whose role kept the composer open', () => {
    qc.setQueryData(['conversations'], [group()]);
    qc.setQueryData(['groupDetails', 'pub-1'], { id: 'pub-1', myRole: 'MEMBER' });
    qc.setQueryData(['groupDetails', 'int-1'], { id: 'int-1', myRole: 'MEMBER' });
    applyOwnMembership(qc, { ids: ['pub-1', 'int-1'], isMember: false, changedAt: T2 });
    expect(qc.getQueryData(['groupDetails', 'pub-1'])).toBeUndefined();
    expect(qc.getQueryData(['groupDetails', 'int-1'])).toBeUndefined();
  });

  it('a late removal event cannot undo a newer re-add', () => {
    qc.setQueryData(['conversations'], [group({ isMember: true, membershipChangedAt: T3 })]);
    applyOwnMembership(qc, { ids: ['pub-1'], isMember: false, changedAt: T2 });
    expect(row().isMember).toBe(true);
  });

  it('a repeated removal changes nothing the second time', () => {
    qc.setQueryData(['conversations'], [group()]);
    expect(applyOwnMembership(qc, { ids: ['pub-1'], isMember: false, changedAt: T2 })).toBe(true);
    const after = qc.getQueryData(['conversations']);
    expect(applyOwnMembership(qc, { ids: ['pub-1'], isMember: false, changedAt: T2 })).toBe(false);
    expect(qc.getQueryData(['conversations'])).toBe(after);
  });

  it('removed, then added back: the newer statement wins in either arrival order', () => {
    qc.setQueryData(['conversations'], [group()]);
    applyOwnMembership(qc, { ids: ['pub-1'], isMember: true, changedAt: T3 });
    applyOwnMembership(qc, { ids: ['pub-1'], isMember: false, changedAt: T2 });
    expect(row().isMember).toBe(true);
  });

  it('applies an unstamped event from an older server, as before', () => {
    qc.setQueryData(['conversations'], [group({ membershipChangedAt: T1 })]);
    applyOwnMembership(qc, { ids: ['pub-1'], isMember: false, changedAt: null });
    expect(row().isMember).toBe(false);
  });

  it('touches only the group it names', () => {
    qc.setQueryData(['conversations'], [group(), group({ id: 'pub-2', publicId: 'pub-2', internalId: 'int-2' })]);
    applyOwnMembership(qc, { ids: ['pub-1'], isMember: false, changedAt: T2 });
    expect(qc.getQueryData(['conversations'])[1].isMember).toBe(true);
  });
});

describe('newerMembership: list row versus history', () => {
  it('prefers the later stamp', () => {
    expect(newerMembership({ isMember: true, membershipChangedAt: T1 }, { isMember: false, membershipChangedAt: T2 }).isMember).toBe(false);
    expect(newerMembership({ isMember: true, membershipChangedAt: T3 }, { isMember: false, membershipChangedAt: T2 }).isMember).toBe(true);
  });

  it('uses whichever exists', () => {
    expect(newerMembership(undefined, { isMember: false }).isMember).toBe(false);
    expect(newerMembership({ isMember: true }, {}).isMember).toBe(true);
    expect(newerMembership({}, {})).toBeNull();
  });

  it('on a tie that disagrees, offers no composer', () => {
    expect(newerMembership({ isMember: true, membershipChangedAt: T2 }, { isMember: false, membershipChangedAt: T2 }).isMember).toBe(false);
  });

  it('isCurrentMembership accepts equal-or-newer and unstamped statements', () => {
    expect(isCurrentMembership({ membershipChangedAt: T2 }, T2)).toBe(true);
    expect(isCurrentMembership({ membershipChangedAt: T2 }, T1)).toBe(false);
    expect(isCurrentMembership({ membershipChangedAt: T2 }, null)).toBe(true);
  });
});

describe('applyOthersMembership: someone else leaves', () => {
  it('moves the count once, however many times the event arrives', () => {
    qc.setQueryData(['conversations'], [group({ memberCount: 3 })]);
    const event = { ids: ['pub-1'], userId: 'u-9', joined: false, changedAt: T2 };
    applyOthersMembership(qc, event);
    applyOthersMembership(qc, event);
    expect(row().memberCount).toBe(2);
  });

  it('drops them from the cached roster at once', () => {
    qc.setQueryData(['conversations'], [group()]);
    qc.setQueryData(['groupDetails', 'pub-1'], {
      id: 'pub-1',
      memberDetails: [{ userId: 'u-1' }, { userId: 'u-9' }],
      admins: ['u-9'],
      memberCount: 2,
    });
    applyOthersMembership(qc, { ids: ['pub-1'], userId: 'u-9', joined: false, changedAt: T2 });
    expect(qc.getQueryData(['groupDetails', 'pub-1'])).toMatchObject({
      memberDetails: [{ userId: 'u-1' }],
      admins: [],
      memberCount: 1,
    });
  });

  it("leaves the roster of a group the viewer has left alone", () => {
    qc.setQueryData(['conversations'], [group({ isMember: false, memberCount: 3 })]);
    applyOthersMembership(qc, { ids: ['pub-1'], userId: 'u-9', joined: false, changedAt: T2 });
    expect(row().memberCount).toBe(3);
  });
});

describe('leaving is not being removed', () => {
  it('records a leave as LEFT, so the chat does not say "removed"', () => {
    qc.setQueryData(['conversations'], [group()]);
    applyOwnMembership(qc, { ids: ['pub-1'], isMember: false, changedAt: T2, status: 'LEFT' });
    expect(row()).toMatchObject({ isMember: false, myMembershipStatus: 'LEFT' });
  });
});

describe('seedJoinedGroup: a group is in the list the moment it is joined', () => {
  const joined = { status: 'JOINED', alreadyMember: false, publicId: 'pub-9', conversationId: 'pub-9', internalId: 'int-9', membershipChangedAt: T3 };
  const preview = { name: 'Weekend Hike', avatarKey: 'groups/h.webp', description: 'Saturdays', memberCount: 4 };

  it('adds a row built from the invite preview, counting the new member', () => {
    qc.setQueryData(['conversations'], [group()]);
    seedJoinedGroup(qc, joined, preview);
    const [first, second] = qc.getQueryData(['conversations']);
    expect(first).toMatchObject({
      id: 'pub-9', internalId: 'int-9', isGroup: true, isMember: true,
      name: 'Weekend Hike', avatarKey: 'groups/h.webp', memberCount: 5, membershipChangedAt: T3,
    });
    expect(second.id).toBe('pub-1');
  });

  it('marks a group the viewer had left as joined again, and a late removal event about that stay cannot undo it', () => {
    qc.setQueryData(['conversations'], [group({ id: 'pub-9', publicId: 'pub-9', internalId: 'int-9', isMember: false, membershipChangedAt: T1 })]);
    seedJoinedGroup(qc, joined, preview);
    expect(row()).toMatchObject({ isMember: true, myMembershipStatus: 'MEMBER', membershipChangedAt: T3 });
    applyOwnMembership(qc, { ids: ['pub-9'], isMember: false, changedAt: T1 });
    expect(row().isMember).toBe(true);
    expect(qc.getQueryData(['conversations'])).toHaveLength(1);
  });

  it('does nothing without a loaded list (the refetch brings the row)', () => {
    seedJoinedGroup(qc, joined, preview);
    expect(qc.getQueryData(['conversations'])).toBeUndefined();
  });
});
