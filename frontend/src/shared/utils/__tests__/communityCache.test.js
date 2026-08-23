import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  applyMembershipEvent, membershipPatch,
  patchCommunityMemberRole, bumpCommunityPostCount,
} from '../communityCache';

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

describe('patchCommunityMemberRole', () => {
  let qc;
  beforeEach(() => {
    qc = new QueryClient();
    qc.setQueryData(['community', 'c1'], {
      id: 'c1', userRole: 'MEMBER', members: [
        { userId: 'u1', role: 'OWNER' },
        { userId: 'u2', role: 'MEMBER' },
      ],
    });
  });
  const detail = () => qc.getQueryData(['community', 'c1']);

  it('promotes exactly one member', () => {
    patchCommunityMemberRole(qc, 'c1', 'u2', 'MODERATOR');
    expect(detail().members).toEqual([
      { userId: 'u1', role: 'OWNER' },
      { userId: 'u2', role: 'MODERATOR' },
    ]);
  });

  it('demotes back', () => {
    patchCommunityMemberRole(qc, 'c1', 'u2', 'MODERATOR');
    patchCommunityMemberRole(qc, 'c1', 'u2', 'MEMBER');
    expect(detail().members[1].role).toBe('MEMBER');
  });

  it('updates the viewer’s own role when it is theirs', () => {
    // Drives whether the moderator-only controls appear for them.
    patchCommunityMemberRole(qc, 'c1', 'u2', 'MODERATOR', 'u2');
    expect(detail().userRole).toBe('MODERATOR');
  });

  it('leaves the viewer’s role alone when it is somebody else’s', () => {
    patchCommunityMemberRole(qc, 'c1', 'u2', 'MODERATOR', 'me');
    expect(detail().userRole).toBe('MEMBER');
  });

  it('is a no-op when the role already matches', () => {
    const before = detail();
    patchCommunityMemberRole(qc, 'c1', 'u2', 'MEMBER');
    expect(detail()).toBe(before);  // identical reference: no re-render
  });

  it('does nothing for a community that is not cached', () => {
    patchCommunityMemberRole(qc, 'nope', 'u2', 'MODERATOR');
    expect(qc.getQueryData(['community', 'nope'])).toBeUndefined();
  });
});

describe('bumpCommunityPostCount', () => {
  let qc;
  beforeEach(() => {
    qc = new QueryClient();
    qc.setQueryData(['community', 'c1'], { id: 'c1', name: 'Chess', _count: { members: 3, posts: 7 } });
  });

  it('moves the post count without touching anything else', () => {
    // This replaced a full invalidate of the community for one number.
    const before = qc.getQueryData(['community', 'c1']);
    bumpCommunityPostCount(qc, 'c1', 1);
    const after = qc.getQueryData(['community', 'c1']);
    expect(after._count).toEqual({ members: 3, posts: 8 });
    expect(after.name).toBe(before.name);
  });

  it('decrements on delete and never goes below zero', () => {
    bumpCommunityPostCount(qc, 'c1', -1);
    expect(qc.getQueryData(['community', 'c1'])._count.posts).toBe(6);
    qc.setQueryData(['community', 'c1'], { id: 'c1', _count: { posts: 0 } });
    bumpCommunityPostCount(qc, 'c1', -1);
    expect(qc.getQueryData(['community', 'c1'])._count.posts).toBe(0);
  });

  it('ignores a community with no count loaded', () => {
    qc.setQueryData(['community', 'c2'], { id: 'c2' });
    const before = qc.getQueryData(['community', 'c2']);
    bumpCommunityPostCount(qc, 'c2', 1);
    expect(qc.getQueryData(['community', 'c2'])).toBe(before);
  });
});
