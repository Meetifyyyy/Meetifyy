import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { applyMembershipEvent, membershipPatch } from '../communityCache';

/**
 * Membership changes must be surgical.
 *
 * The flicker these replace came from treating a join as a reason to reload:
 * the handler set ['community', id] to null and invalidated five query keys.
 * CommunityView derives `isLoading` from `!comm`, so that null swapped the
 * entire page for a skeleton on every join, for every user, in every
 * community — the detail the tests below guard hardest.
 */
describe('applyMembershipEvent', () => {
  let qc;

  const community = (over = {}) => ({
    id: 'c1', name: 'Chess Club', memberCount: 10, isJoined: false,
    userRole: null, members: [{ userId: 'u1', role: 'OWNER', user: { id: 'u1' } }],
    ...over,
  });

  beforeEach(() => {
    qc = new QueryClient();
    qc.setQueryData(['community', 'c1'], community());
    qc.setQueryData(['communities'], [community(), community({ id: 'c2', memberCount: 4 })]);
  });

  const detail = () => qc.getQueryData(['community', 'c1']);
  const list = () => qc.getQueryData(['communities']);

  it('never blanks the detail cache', () => {
    // The exact regression: a null here is what made the page flash.
    applyMembershipEvent(qc, { communityId: 'c1', userId: 'u9', memberCount: 11, joined: true });
    expect(detail()).not.toBeNull();
    expect(detail().name).toBe('Chess Club');
  });

  it('updates the member count in the detail and in every list', () => {
    applyMembershipEvent(qc, { communityId: 'c1', userId: 'u9', memberCount: 11, joined: true });
    expect(detail().memberCount).toBe(11);
    expect(list()[0].memberCount).toBe(11);
  });

  it('leaves other communities untouched, by identity', () => {
    const before = list()[1];
    applyMembershipEvent(qc, { communityId: 'c1', userId: 'u9', memberCount: 11, joined: true });
    // Same object reference — a memoised card for c2 must not re-render.
    expect(list()[1]).toBe(before);
  });

  it('takes the count from the server rather than incrementing locally', () => {
    // A client-side +1 drifts permanently after one missed or duplicated
    // event; the server computes this in the membership transaction.
    applyMembershipEvent(qc, { communityId: 'c1', userId: 'u9', memberCount: 27, joined: true });
    expect(detail().memberCount).toBe(27);
  });

  it('is idempotent, so a duplicate event changes nothing', () => {
    applyMembershipEvent(qc, { communityId: 'c1', userId: 'u9', memberCount: 11, joined: true });
    const after = detail();
    applyMembershipEvent(qc, { communityId: 'c1', userId: 'u9', memberCount: 11, joined: true });
    expect(detail()).toBe(after);   // identical reference: no re-render
    expect(detail().members).toHaveLength(after.members.length);
  });

  describe('the member list', () => {
    it('appends someone who joined', () => {
      applyMembershipEvent(qc, { communityId: 'c1', userId: 'u9', memberCount: 11, joined: true });
      expect(detail().members.map((m) => m.userId)).toEqual(['u1', 'u9']);
    });

    it('removes only the member who left', () => {
      qc.setQueryData(['community', 'c1'], community({
        members: [
          { userId: 'u1', role: 'OWNER', user: { id: 'u1' } },
          { userId: 'u9', role: 'MEMBER', user: { id: 'u9' } },
        ],
      }));
      applyMembershipEvent(qc, { communityId: 'c1', userId: 'u9', memberCount: 9, joined: false });
      expect(detail().members.map((m) => m.userId)).toEqual(['u1']);
    });

    it('does not append past the server-side strip cap', () => {
      // The API returns at most 50; a 51st row would vanish on next refetch.
      const members = Array.from({ length: 50 }, (_, i) => ({ userId: `m${i}`, role: 'MEMBER' }));
      qc.setQueryData(['community', 'c1'], community({ members }));
      applyMembershipEvent(qc, { communityId: 'c1', userId: 'u9', memberCount: 51, joined: true });
      expect(detail().members).toHaveLength(50);
      expect(detail().memberCount).toBe(51);
    });
  });

  describe('the viewer’s own membership', () => {
    it('flips their join state when the event is about them', () => {
      applyMembershipEvent(qc, {
        communityId: 'c1', userId: 'me', memberCount: 11, joined: true, currentUserId: 'me',
      });
      expect(detail()).toMatchObject({ isJoined: true, isMember: true, userRole: 'MEMBER' });
    });

    it('clears their role when they leave', () => {
      qc.setQueryData(['community', 'c1'], community({ isJoined: true, userRole: 'MEMBER' }));
      applyMembershipEvent(qc, {
        communityId: 'c1', userId: 'me', memberCount: 9, joined: false, currentUserId: 'me',
      });
      expect(detail()).toMatchObject({ isJoined: false, userRole: null });
    });

    it('leaves their join state alone when somebody else joins', () => {
      // Someone else joining must not flip this viewer's Join button.
      applyMembershipEvent(qc, {
        communityId: 'c1', userId: 'u9', memberCount: 11, joined: true, currentUserId: 'me',
      });
      expect(detail().isJoined).toBe(false);
      expect(detail().userRole).toBeNull();
    });
  });

  it('does not invent a detail cache that was never loaded', () => {
    // Seeding a partial object would render a community page from nothing.
    applyMembershipEvent(qc, { communityId: 'unseen', userId: 'u9', memberCount: 3, joined: true });
    expect(qc.getQueryData(['community', 'unseen'])).toBeUndefined();
  });
});

describe('membershipPatch', () => {
  it('ignores a missing or non-numeric count', () => {
    expect(membershipPatch({ memberCount: undefined })).toEqual({});
    expect(membershipPatch({ memberCount: NaN })).toEqual({});
  });
});
