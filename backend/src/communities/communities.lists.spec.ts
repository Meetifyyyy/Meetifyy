import { CommunitiesService } from './communities.service';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { RedisService } from '../redis/redis.service';
import type { PresenceService } from '../presence/presence.service';
import type { DefaultAssetsService } from '../uploads/default-assets.service';
import type { BlocksService } from '../users/blocks.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { NotificationFactory } from '../notifications/notification.factory';

/**
 * The two lists the Communities page is built on: the viewer's own
 * communities, and the public/private discovery list with search.
 */

interface CommunityRow {
  id: string;
  ownerId: string;
  isPrivate: boolean;
}
interface MembershipRow {
  role: string;
  joinedAt: Date;
  community: CommunityRow;
}
interface FindManyArgs {
  where: {
    isPrivate?: boolean;
    isCampusCommunity?: boolean;
    OR?: { name?: { contains: string } }[];
  };
}
interface MemberFindManyArgs {
  where: { userId: string; community: { deletedAt: null } };
}
interface RequestFindManyArgs {
  where: { communityId: { in: string[] } };
}

describe('CommunitiesService — community lists', () => {
  let service: CommunitiesService;
  let communityFindMany: jest.Mock<Promise<CommunityRow[]>, [FindManyArgs]>;
  let memberFindMany: jest.Mock<Promise<MembershipRow[]>, [MemberFindManyArgs]>;
  let requestFindMany: jest.Mock<
    Promise<{ communityId: string }[]>,
    [RequestFindManyArgs]
  >;
  let postGroupBy: jest.Mock<
    Promise<{ communityId: string; _max: { createdAt: Date } }[]>,
    []
  >;

  const setup = ({
    communities = [] as CommunityRow[],
    memberships = [] as MembershipRow[],
    requests = [] as { communityId: string }[],
    lastPosts = [] as { communityId: string; _max: { createdAt: Date } }[],
  } = {}) => {
    communityFindMany = jest.fn((_args: FindManyArgs) =>
      Promise.resolve(communities),
    );
    memberFindMany = jest.fn((_args: MemberFindManyArgs) =>
      Promise.resolve(memberships),
    );
    requestFindMany = jest.fn((_args: RequestFindManyArgs) =>
      Promise.resolve(requests),
    );
    postGroupBy = jest.fn(() => Promise.resolve(lastPosts));
    service = new CommunitiesService(
      stub<PrismaService>({
        community: { findMany: communityFindMany },
        communityMember: { findMany: memberFindMany },
        communityJoinRequest: { findMany: requestFindMany },
        post: { groupBy: postGroupBy },
      }),
      stub<DomainEventService>(),
      stub<RedisService>({ getClient: () => null }),
      stub<PresenceService>(),
      stub<DefaultAssetsService>(),
      stub<BlocksService>(),
      stub<NotificationsService>(),
      stub<NotificationFactory>(),
    );
  };

  describe('getMyCommunities', () => {
    it('lists memberships from the membership table, with last activity', async () => {
      const t = new Date('2026-09-01T00:00:00Z');
      setup({
        memberships: [
          {
            role: 'MEMBER',
            joinedAt: t,
            community: { id: 'a', ownerId: 'other', isPrivate: true },
          },
          {
            role: 'OWNER',
            joinedAt: t,
            community: { id: 'b', ownerId: 'me', isPrivate: false },
          },
        ],
        lastPosts: [{ communityId: 'a', _max: { createdAt: t } }],
      });

      const rows = await service.getMyCommunities('me');

      expect(memberFindMany.mock.calls[0][0].where).toEqual({
        userId: 'me',
        community: { deletedAt: null },
      });
      expect(rows.map((r) => [r.id, r.userRole, r.lastPostAt])).toEqual([
        ['a', 'MEMBER', t],
        ['b', 'OWNER', null],
      ]);
      expect(rows.every((r) => r.isJoined)).toBe(true);
    });

    it('makes no post query for an account with no memberships', async () => {
      setup();
      expect(await service.getMyCommunities('me')).toEqual([]);
      expect(postGroupBy).not.toHaveBeenCalled();
    });
  });

  describe('getAllCommunities', () => {
    it('applies search and visibility in the query', async () => {
      setup();
      await service.getAllCommunities('me', 30, 0, {
        search: ' chess ',
        visibility: 'private',
      });
      const { where } = communityFindMany.mock.calls[0][0];
      expect(where.isPrivate).toBe(true);
      expect(where.isCampusCommunity).toBe(false);
      expect(where.OR?.[0].name?.contains).toBe('chess');
    });

    it('flags a pending request on a private community the viewer is not in', async () => {
      setup({
        communities: [
          { id: 'p', isPrivate: true, ownerId: 'o' },
          { id: 'q', isPrivate: false, ownerId: 'o' },
        ],
        requests: [{ communityId: 'p' }],
      });

      const rows = await service.getAllCommunities('me', 30, 0, {
        search: 'x',
      });

      expect(requestFindMany.mock.calls[0][0].where.communityId).toEqual({
        in: ['p'],
      });
      expect(rows.find((r) => r.id === 'p')?.hasPendingRequest).toBe(true);
      expect(rows.find((r) => r.id === 'q')?.hasPendingRequest).toBe(false);
    });
  });
});
