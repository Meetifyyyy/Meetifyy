import { describe, it, expect } from 'vitest';
import {
  isCommunityMember,
  isCommunityOwner,
  canLeaveCommunity,
  communityMemberCount,
} from '../community';

const ME = { id: 'u1', username: 'me' };
const OTHER = { id: 'u2', username: 'them' };

describe('isCommunityOwner', () => {
  it('recognises the owner by role', () => {
    expect(isCommunityOwner({ userRole: 'OWNER' }, ME)).toBe(true);
  });

  it('recognises the owner by ownerId, comparing as strings', () => {
    expect(isCommunityOwner({ ownerId: 'u1' }, ME)).toBe(true);
    expect(isCommunityOwner({ ownerId: 1 }, { id: '1' })).toBe(true);
  });

  it('is false for a plain member and for a signed-out viewer', () => {
    expect(isCommunityOwner({ userRole: 'MEMBER', ownerId: 'u2' }, ME)).toBe(false);
    expect(isCommunityOwner({ ownerId: 'u1' }, null)).toBe(false);
  });
});

describe('isCommunityMember', () => {
  it('reads the API\'s own isJoined flag', () => {
    // The profile sidebar used to read `comm.joined`, which the API has never
    // returned, so its button said "Join" for every community.
    expect(isCommunityMember({ isJoined: true }, ME)).toBe(true);
    expect(isCommunityMember({ isJoined: false }, ME)).toBe(false);
  });

  it('treats every role as membership', () => {
    for (const userRole of ['OWNER', 'MODERATOR', 'MEMBER']) {
      expect(isCommunityMember({ userRole }, ME)).toBe(true);
    }
    expect(isCommunityMember({ userRole: null }, ME)).toBe(false);
  });

  it('counts the owner as a member even without a flag', () => {
    expect(isCommunityMember({ ownerId: 'u1' }, ME)).toBe(true);
  });

  it('accepts the optimistic updater\'s isMember spelling', () => {
    expect(isCommunityMember({ isMember: true }, ME)).toBe(true);
  });

  it('falls back to an inlined member list', () => {
    expect(isCommunityMember({ members: [{ userId: 'u1' }] }, ME)).toBe(true);
    expect(isCommunityMember({ members: [{ user: { id: 'u1' } }] }, ME)).toBe(true);
    expect(isCommunityMember({ members: [{ userId: 'u2' }] }, ME)).toBe(false);
  });

  it('is false for a community with no membership signal at all', () => {
    expect(isCommunityMember({ id: 'c1', name: 'JOKE' }, ME)).toBe(false);
    expect(isCommunityMember(null, ME)).toBe(false);
  });
});

describe('canLeaveCommunity', () => {
  it('lets an ordinary member leave', () => {
    expect(canLeaveCommunity({ userRole: 'MEMBER' }, ME)).toBe(true);
  });

  it('refuses the owner — the server rejects it, so it must not be offered', () => {
    expect(canLeaveCommunity({ userRole: 'OWNER' }, ME)).toBe(false);
    expect(canLeaveCommunity({ ownerId: 'u1', isJoined: true }, ME)).toBe(false);
  });

  it('refuses someone who is not a member', () => {
    expect(canLeaveCommunity({ isJoined: false }, OTHER)).toBe(false);
  });
});

describe('communityMemberCount', () => {
  it('reads memberCount, then membersCount, then the member list', () => {
    expect(communityMemberCount({ memberCount: 7 })).toBe(7);
    expect(communityMemberCount({ membersCount: 4 })).toBe(4);
    expect(communityMemberCount({ members: [{}, {}] })).toBe(2);
  });

  it('returns 0 rather than NaN or undefined for junk', () => {
    // Reading a field that does not exist is what produced "0 members" and,
    // worse, "undefined members" on some surfaces.
    expect(communityMemberCount({})).toBe(0);
    expect(communityMemberCount(null)).toBe(0);
    expect(communityMemberCount({ memberCount: 'x' })).toBe(0);
  });
});
