import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PostsService } from './posts.service';

/**
 * Who may write a post into a community.
 *
 * createPost used to check only that the community existed and was not
 * deleted. Membership, privacy and campus eligibility were enforced on the
 * read path and nowhere on the write path — so passing a communityId
 * straight to the API let anyone post into any community, including a
 * private one they could not open. The post would then be visible to that
 * community's members while its author could not read the community at all.
 *
 * These cases are written against the guard directly, because the rule is
 * an authorization boundary and needs to hold regardless of what the UI
 * happens to offer.
 */
describe('PostsService — community post authorization', () => {
  const COMMUNITY = 'c1';

  let service: PostsService;
  let prisma: any;

  const community = (over: any = {}) => ({
    id: COMMUNITY, deletedAt: null, isPrivate: false,
    isCampusCommunity: false, collegeId: null, ownerId: 'owner', ...over,
  });

  const setup = ({ comm = community(), membership = null, user = { collegeId: 'col-1' } }: {
    comm?: any; membership?: any; user?: any;
  } = {}) => {
    prisma = {
      community: { findUnique: jest.fn(async () => comm) },
      communityMember: { findUnique: jest.fn(async () => membership) },
      user: { findUnique: jest.fn(async () => user) },
    };
    service = new PostsService(
      prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      // Deletion authorizer — unused by the write-path guard under test.
      {} as any,
    );
  };

  const attempt = (userId: string) => (service as any).assertCanPostInCommunity(userId, COMMUNITY);

  describe('a non-member', () => {
    it('is refused', async () => {
      setup();
      await expect(attempt('stranger')).rejects.toThrow(ForbiddenException);
    });

    it('is refused on a private community too', async () => {
      // The case that mattered most: they cannot even read this community.
      setup({ comm: community({ isPrivate: true }) });
      await expect(attempt('stranger')).rejects.toThrow(/join this community/i);
    });
  });

  describe('a member', () => {
    it('may post', async () => {
      setup({ membership: { role: 'MEMBER' } });
      await expect(attempt('member')).resolves.toBeUndefined();
    });

    it('may post in a private community they belong to', async () => {
      setup({ comm: community({ isPrivate: true }), membership: { role: 'MEMBER' } });
      await expect(attempt('member')).resolves.toBeUndefined();
    });
  });

  describe('the owner', () => {
    it('may post without a membership row', async () => {
      // Ownership is carried by Community.ownerId; the member row is a
      // convenience that every other owner check also treats as optional.
      setup({ membership: null });
      await expect(attempt('owner')).resolves.toBeUndefined();
      expect(prisma.communityMember.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('a campus community', () => {
    const campus = community({ isCampusCommunity: true, collegeId: 'col-1' });

    it('accepts a member from that college', async () => {
      setup({ comm: campus, membership: { role: 'MEMBER' }, user: { collegeId: 'col-1' } });
      await expect(attempt('member')).resolves.toBeUndefined();
    });

    it('refuses a member whose college no longer matches', async () => {
      // A membership row predating a college change must not grant access.
      setup({ comm: campus, membership: { role: 'MEMBER' }, user: { collegeId: 'col-2' } });
      await expect(attempt('member')).rejects.toThrow(/limited to verified students/i);
    });

    it('refuses a member with no college at all', async () => {
      setup({ comm: campus, membership: { role: 'MEMBER' }, user: null });
      await expect(attempt('member')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('a community that is gone', () => {
    it('is a 404, not a 403', async () => {
      setup({ comm: community({ deletedAt: new Date() }) });
      await expect(attempt('member')).rejects.toThrow(NotFoundException);
    });

    it('is a 404 when it never existed', async () => {
      setup({ comm: null as any });
      await expect(attempt('member')).rejects.toThrow(NotFoundException);
    });
  });

  it('mirrors the read path, so writable implies readable', async () => {
    // getFeed hides a private community's posts from non-members and a campus
    // community's from other colleges. If this guard were looser, a user
    // could author posts into a feed they are not allowed to read.
    setup({ comm: community({ isPrivate: true }), membership: null });
    await expect(attempt('stranger')).rejects.toThrow(ForbiddenException);
  });
});
