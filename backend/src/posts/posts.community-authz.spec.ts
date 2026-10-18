import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PostsService } from './posts.service';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { NotificationFactory } from '../notifications/notification.factory';
import type { BlocksService } from '../users/blocks.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { RedisService } from '../redis/redis.service';
import type { MentionsService } from '../mentions/mentions.service';
import type { StorageService } from '../uploads/uploads.service';
import type { ContentDeletionAuthorizer } from './content-deletion.authorizer';
import type { AffiliationGateRow } from '../common/campus/campus-access.service';
import { affiliatedWith } from '../common/campus/testing/affiliation.fixture';

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

  /** The community columns the write-path guard reads. */
  type CommunityRow = {
    id: string;
    deletedAt: Date | null;
    isPrivate: boolean;
    isCampusCommunity: boolean;
    collegeId: string | null;
    ownerId: string;
  };

  let service: PostsService;
  let prisma: ReturnType<typeof makePrisma>;

  const community = (over: Partial<CommunityRow> = {}): CommunityRow => ({
    id: COMMUNITY,
    deletedAt: null,
    isPrivate: false,
    isCampusCommunity: false,
    collegeId: null,
    ownerId: 'owner',
    ...over,
  });

  const makePrisma = (
    comm: CommunityRow | null,
    membership: { role: string } | null,
    affiliation: AffiliationGateRow | null,
  ) => ({
    community: { findUnique: jest.fn(() => Promise.resolve(comm)) },
    communityMember: {
      findUnique: jest.fn(() => Promise.resolve(membership)),
    },
    // The campus check reads the ACTIVE affiliation. `user.findUnique` is
    // answered with a matching mirror on purpose: it must never be consulted.
    collegeAffiliation: {
      findUnique: jest.fn(() => Promise.resolve(affiliation)),
    },
    user: {
      findUnique: jest.fn(() => Promise.resolve({ collegeId: 'col-1' })),
    },
  });

  const setup = ({
    comm = community(),
    membership = null,
    affiliation = affiliatedWith('col-1'),
  }: {
    comm?: CommunityRow | null;
    membership?: { role: string } | null;
    affiliation?: AffiliationGateRow | null;
  } = {}) => {
    prisma = makePrisma(comm, membership, affiliation);
    service = new PostsService(
      stub<PrismaService>(prisma),
      stub<NotificationsService>(),
      stub<NotificationFactory>(),
      stub<BlocksService>(),
      stub<DomainEventService>(),
      stub<RedisService>(),
      stub<MentionsService>(),
      stub<StorageService>(),
      // Deletion authorizer — unused by the write-path guard under test.
      stub<ContentDeletionAuthorizer>(),
    );
  };

  const attempt = (userId: string) =>
    service['assertCanPostInCommunity'](userId, COMMUNITY);

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
      setup({
        comm: community({ isPrivate: true }),
        membership: { role: 'MEMBER' },
      });
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
      setup({
        comm: campus,
        membership: { role: 'MEMBER' },
        affiliation: affiliatedWith('col-1'),
      });
      await expect(attempt('member')).resolves.toBeUndefined();
    });

    it('refuses a member whose college no longer matches', async () => {
      // A membership row predating a college change must not grant access.
      setup({
        comm: campus,
        membership: { role: 'MEMBER' },
        affiliation: affiliatedWith('col-2'),
      });
      await expect(attempt('member')).rejects.toThrow(
        /limited to people who verified this college's email/i,
      );
    });

    it('refuses a member with no affiliation, even with a matching mirror', async () => {
      // User.collegeId says col-1 (see makePrisma); the affiliation is gone.
      setup({
        comm: campus,
        membership: { role: 'MEMBER' },
        affiliation: null,
      });
      await expect(attempt('member')).rejects.toThrow(ForbiddenException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('refuses a member whose affiliation was revoked', async () => {
      setup({
        comm: campus,
        membership: { role: 'MEMBER' },
        affiliation: affiliatedWith('col-1', { revokedAt: new Date() }),
      });
      await expect(attempt('member')).rejects.toThrow(ForbiddenException);
    });

    describe('the campus community feed', () => {
      const feed = () =>
        service.getChronologicalFeed('member', 10, undefined, COMMUNITY);

      it('is empty for a viewer whose affiliation is revoked, despite the mirror', async () => {
        setup({
          comm: campus,
          membership: { role: 'MEMBER' },
          affiliation: affiliatedWith('col-1', { revokedAt: new Date() }),
        });
        await expect(feed()).resolves.toEqual({
          posts: [],
          nextCursor: undefined,
        });
        expect(prisma.collegeAffiliation.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({ where: { userId: 'member' } }),
        );
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
      });

      it('is empty for a viewer affiliated with another college', async () => {
        setup({ comm: campus, affiliation: affiliatedWith('col-2') });
        await expect(feed()).resolves.toEqual({
          posts: [],
          nextCursor: undefined,
        });
      });
    });
  });

  describe('a community that is gone', () => {
    it('is a 404, not a 403', async () => {
      setup({ comm: community({ deletedAt: new Date() }) });
      await expect(attempt('member')).rejects.toThrow(NotFoundException);
    });

    it('is a 404 when it never existed', async () => {
      setup({ comm: null });
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
