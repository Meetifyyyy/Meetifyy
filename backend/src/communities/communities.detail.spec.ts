import { NotFoundException } from '@nestjs/common';
import { CommunitiesService } from './communities.service';

/**
 * `getCommunityById` — the community page's payload.
 *
 * It had no coverage at all, which is how the membership bug below survived:
 * the viewer's own membership was resolved by searching the member strip, and
 * that strip is capped at 50 rows. In any community larger than that, a member
 * who did not happen to fall in the first page was told they were not one.
 *
 * The reads it makes are also all independent of one another, so they run
 * concurrently now. These tests pin the observable results rather than the
 * order, but the fixtures deliberately answer the viewer's membership from the
 * database rather than from the loaded strip, so a regression back to
 * "search the strip" fails the large-community case.
 */
describe('CommunitiesService — community detail', () => {
  const ID = 'c1';
  const VIEWER = 'viewer';

  let service: CommunitiesService;
  let prisma: any;

  // The collegeId cache is a static map shared by every instance of the
  // service, with a 10-minute TTL — so without this, one test's viewer college
  // is still cached for the next one.
  beforeEach(() => {
    (CommunitiesService as any).collegeIdCache.clear();
  });

  /**
   * `viewerMembership` is placed in the loaded member strip by default, which
   * is where the service reads it from whenever the strip is complete.
   * `viewerOutsideStrip` instead pads the strip to its cap WITHOUT the viewer
   * and leaves the row only in the database — the large-community case, and
   * the one the strip cannot answer.
   */
  const build = ({
    community = {} as any,
    members = [] as any[],
    viewerMembership = null as any,
    viewerOutsideStrip = false,
    joinRequest = null as any,
    viewerCollegeId = null as string | null,
  } = {}) => {
    let strip = [...members];
    if (viewerMembership && !viewerOutsideStrip) {
      strip = [
        ...strip,
        {
          userId: VIEWER,
          communityId: ID,
          user: { id: VIEWER, username: VIEWER },
          ...viewerMembership,
        },
      ];
    }
    members = strip;
    prisma = {
      community: {
        findUnique: jest.fn(async () => ({
          id: ID,
          name: 'Community',
          ownerId: 'owner',
          createdAt: new Date('2026-01-01'),
          deletedAt: null,
          isPrivate: false,
          isCampusCommunity: false,
          collegeId: null,
          owner: { id: 'owner', username: 'owner', displayName: 'Owner' },
          college: null,
          members,
          _count: { members: members.length, posts: 0 },
          ...community,
        })),
      },
      communityMember: {
        findUnique: jest.fn(async () =>
          viewerOutsideStrip ? viewerMembership : null,
        ),
        findMany: jest.fn(async () =>
          members.map((m: any) => ({ userId: m.userId })),
        ),
      },
      communityJoinRequest: { findUnique: jest.fn(async () => joinRequest) },
      user: {
        findUnique: jest.fn(async () => ({ collegeId: viewerCollegeId })),
      },
    };

    service = new CommunitiesService(
      prisma,
      { emit: jest.fn() } as any,
      { getClient: () => null } as any,
      { getPresenceMany: async () => new Map() } as any,
      { refFor: () => null } as any,
      {
        getExcludedUserIds: async () => [],
        isBlocked: async () => false,
        filterBlockedUsers: async (_u: any, ids: any) => ids,
        injectBlockFilter: async (_u: any, w: any) => w,
        invalidateBlockCache: async () => {},
      } as any,
      { createNotification: async () => ({}) } as any,
      { createModeratorPromotion: () => null } as any,
    );
    return service;
  };

  const member = (userId: string, role = 'MEMBER') => ({
    userId,
    communityId: ID,
    role,
    user: { id: userId, username: userId },
  });

  it('reports a member who falls outside the loaded member strip as joined', async () => {
    // The strip is capped at 50 and does not contain the viewer; their row
    // exists in the database. Deriving membership from the strip returned
    // isJoined: false and a Join button for a community they are in.
    const strip = Array.from({ length: 50 }, (_, i) => member(`u${i}`));
    build({
      members: strip,
      viewerMembership: { role: 'MEMBER' },
      viewerOutsideStrip: true,
    });

    const result: any = await service.getCommunityById(ID, VIEWER);

    expect(result.isJoined).toBe(true);
    expect(result.userRole).toBe('MEMBER');
  });

  it('reports a non-member as not joined', async () => {
    build({ members: [member('someone')], viewerMembership: null });

    const result: any = await service.getCommunityById(ID, VIEWER);

    expect(result.isJoined).toBe(false);
    expect(result.userRole).toBeNull();
  });

  it('treats the owner as joined with the OWNER role', async () => {
    build({ community: { ownerId: VIEWER }, viewerMembership: null });

    const result: any = await service.getCommunityById(ID, VIEWER);

    expect(result.isJoined).toBe(true);
    expect(result.userRole).toBe('OWNER');
  });

  describe('query economy', () => {
    // These pin the cost, not just the answer. An earlier version of this
    // method made both reads unconditional so they could join the parallel
    // batch; measured against the dev database that was slower on the common
    // case, because it turns two reads that usually cost nothing into two the
    // database always serves.

    it('answers membership from the loaded strip without touching the database', async () => {
      build({
        members: [member('someone')],
        viewerMembership: { role: 'MEMBER' },
      });

      const result: any = await service.getCommunityById(ID, VIEWER);

      expect(result.isJoined).toBe(true);
      expect(prisma.communityMember.findUnique).not.toHaveBeenCalled();
    });

    it('queries only when the strip is full and the viewer is not in it', async () => {
      build({
        members: Array.from({ length: 50 }, (_, i) => member(`u${i}`)),
        viewerMembership: { role: 'MEMBER' },
        viewerOutsideStrip: true,
      });

      await service.getCommunityById(ID, VIEWER);

      expect(prisma.communityMember.findUnique).toHaveBeenCalledTimes(1);
    });

    it('does not look up a join request for a member of a private community', async () => {
      build({
        community: { isPrivate: true },
        viewerMembership: { role: 'MEMBER' },
        joinRequest: { status: 'PENDING' },
      });

      await service.getCommunityById(ID, VIEWER);

      expect(prisma.communityJoinRequest.findUnique).not.toHaveBeenCalled();
    });

    it('does not look up a college for a non-campus community', async () => {
      build({ viewerMembership: { role: 'MEMBER' } });

      await service.getCommunityById(ID, VIEWER);

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('moderator notice', () => {
    it('carries a pending notice on the payload', async () => {
      build({
        viewerMembership: {
          role: 'MODERATOR',
          moderatorPromotedAt: new Date('2026-02-01'),
          moderatorNoticeAckedAt: null,
        },
      });

      const result: any = await service.getCommunityById(ID, VIEWER);

      expect(result.moderatorNotice?.promotedAt).toEqual(
        new Date('2026-02-01'),
      );
      expect(Array.isArray(result.moderatorNotice.permissions)).toBe(true);
    });

    it('omits it once acknowledged after the promotion', async () => {
      build({
        viewerMembership: {
          role: 'MODERATOR',
          moderatorPromotedAt: new Date('2026-02-01'),
          moderatorNoticeAckedAt: new Date('2026-02-02'),
        },
      });

      const result: any = await service.getCommunityById(ID, VIEWER);

      expect(result.moderatorNotice).toBeNull();
    });

    it('shows it again after a re-promotion', async () => {
      build({
        viewerMembership: {
          role: 'MODERATOR',
          moderatorPromotedAt: new Date('2026-03-01'),
          moderatorNoticeAckedAt: new Date('2026-02-02'),
        },
      });

      const result: any = await service.getCommunityById(ID, VIEWER);

      expect(result.moderatorNotice).not.toBeNull();
    });

    it('is null for an ordinary member', async () => {
      build({ viewerMembership: { role: 'MEMBER' } });

      const result: any = await service.getCommunityById(ID, VIEWER);

      expect(result.moderatorNotice).toBeNull();
    });
  });

  describe('private communities', () => {
    it('reports a pending join request for a non-member', async () => {
      build({
        community: { isPrivate: true },
        viewerMembership: null,
        joinRequest: { status: 'PENDING' },
      });

      const result: any = await service.getCommunityById(ID, VIEWER);

      expect(result.hasPendingRequest).toBe(true);
      expect(result.canViewPosts).toBe(false);
    });

    it('never reports one for someone who is already a member', async () => {
      // The request is now issued in parallel with the membership lookup, so a
      // stale ACCEPTED/PENDING row must still be ignored for a member.
      build({
        community: { isPrivate: true },
        viewerMembership: { role: 'MEMBER' },
        joinRequest: { status: 'PENDING' },
      });

      const result: any = await service.getCommunityById(ID, VIEWER);

      expect(result.hasPendingRequest).toBe(false);
      expect(result.canViewPosts).toBe(true);
    });
  });

  describe('campus eligibility', () => {
    it('refuses a viewer from another college', async () => {
      build({
        community: {
          isCampusCommunity: true,
          collegeId: 'college-a',
          college: { name: 'College A' },
        },
        viewerCollegeId: 'college-b',
      });

      const result: any = await service.getCommunityById(ID, VIEWER);

      expect(result.isEligibleToJoin).toBe(false);
      expect(result.eligibilityMessage).toContain('College A');
    });

    it('admits a viewer from the same college', async () => {
      build({
        community: { isCampusCommunity: true, collegeId: 'college-a' },
        viewerCollegeId: 'college-a',
      });

      const result: any = await service.getCommunityById(ID, VIEWER);

      expect(result.isEligibleToJoin).toBe(true);
      expect(result.eligibilityMessage).toBeNull();
    });
  });

  it('hides members this viewer has blocked without changing the count', async () => {
    const members = [member('a'), member('b')];
    build({ members });
    (service as any).blocksService.filterBlockedUsers = async () => ['a'];

    const result: any = await service.getCommunityById(ID, VIEWER);

    expect(result.members.map((m: any) => m.userId)).toEqual(['a']);
    expect(result._count.members).toBe(2);
  });

  it('rejects a deleted community', async () => {
    build({ community: { deletedAt: new Date() } });

    await expect(service.getCommunityById(ID, VIEWER)).rejects.toThrow(
      NotFoundException,
    );
  });
});
