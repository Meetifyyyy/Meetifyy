import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { UsersService } from './users.service';
import { BlocksService } from './blocks.service';
import { blocksServiceMockProvider } from './testing/blocks.service.mock';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { DomainEventService } from '../events/domain-event.service';
import { RedisService } from '../redis/redis.service';
import { PresenceService } from '../presence/presence.service';
import { AcademicsService } from '../academics/academics.service';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor';

describe('UsersService — blocking', () => {
  let service: UsersService;
  let tx: any;
  let mockPrisma: any;
  let blocksMock: any;
  let blockRows: any[] = [];
  let domainEvents: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();

    tx = {
      block: { upsert: jest.fn() },
      follow: { deleteMany: jest.fn() },
      matchSession: { updateMany: jest.fn() },
    };

    mockPrisma = {
      $transaction: jest.fn(async (fn: any) => fn(tx)),
      block: { deleteMany: jest.fn(), findMany: jest.fn() },
    };

    domainEvents = jest.fn();

    blocksMock = blocksServiceMockProvider();
    // getBlockedContacts now reads through BlocksService, so the double serves
    // the rows the pagination/deleted-account assertions below rely on.
    blocksMock.useValue.listBlockedContacts = jest.fn(async () => blockRows);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: NotificationsService,
          useValue: {
            createNotification: jest.fn(),
            invalidatePrefsCache: jest.fn(),
          },
        },
        { provide: NotificationFactory, useValue: {} },
        { provide: DomainEventService, useValue: { emit: domainEvents } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: RedisService, useValue: { getClient: () => null } },
        blocksMock,
        {
          provide: PresenceService,
          useValue: { getPresenceMany: jest.fn().mockResolvedValue(new Map()) },
        },
        AcademicsService,
        {
          provide: getQueueToken(NOTIFICATIONS_QUEUE),
          useValue: { add: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('blockUser', () => {
    it('severs the follow edge in both directions, not just the blocker’s', async () => {
      await service.blockUser('alice', 'bob');

      const where = tx.follow.deleteMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { followerId: 'alice', followingId: 'bob' },
        { followerId: 'bob', followingId: 'alice' },
      ]);
    });

    it('ends a live Instant Match between the two', async () => {
      await service.blockUser('alice', 'bob');

      const call = tx.matchSession.updateMany.mock.calls[0][0];
      expect(call.where.OR).toEqual([
        { userAId: 'alice', userBId: 'bob' },
        { userAId: 'bob', userBId: 'alice' },
      ]);
      expect(call.data).toMatchObject({
        status: 'EXPIRED',
        chatStatus: 'ENDED_BY_USER',
        endedById: 'alice',
      });
    });

    it('leaves an already-resolved match session alone', async () => {
      await service.blockUser('alice', 'bob');
      expect(tx.matchSession.updateMany.mock.calls[0][0].where.NOT).toEqual({
        status: { in: ['DECLINED', 'EXPIRED'] },
      });
    });

    it('applies the block and its side effects in one transaction', async () => {
      await service.blockUser('alice', 'bob');
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.block.upsert).toHaveBeenCalledTimes(1);
    });

    it('refuses a self-block', async () => {
      await expect(service.blockUser('alice', 'alice')).rejects.toThrow();
    });
  });

  describe('block realtime events', () => {
    /** The events targeted at one user, as [type, data] pairs. */
    const eventsFor = (userId: string) =>
      domainEvents.mock.calls
        .filter(
          ([, , targets]) => Array.isArray(targets) && targets.includes(userId),
        )
        .map(([type, data]) => [type, data] as const);

    it('tells the blocked user, live, that they can no longer send', async () => {
      // Without this the block was invisible on their screen: the composer
      // stayed enabled and the restriction only appeared after a refresh.
      await service.blockUser('alice', 'bob');

      const [[type, data]] = eventsFor('bob');
      expect(type).toBe('user:blocked');
      expect(data).toMatchObject({
        blocked: true,
        otherUserId: 'alice',
        isBlockedByThem: true,
        isBlockedByMe: false,
      });
    });

    it('gives the blocker the other side of the same block', async () => {
      // Directional flags are resolved per recipient. Handing the blocked user
      // an `isBlockedByMe` would offer them an Unblock button for a block they
      // never placed.
      await service.blockUser('alice', 'bob');

      const [[type, data]] = eventsFor('alice');
      expect(type).toBe('user:blocked');
      expect(data).toMatchObject({
        blocked: true,
        otherUserId: 'bob',
        isBlockedByMe: true,
        isBlockedByThem: false,
      });
    });

    it('reverses on unblock so the input re-enables without a reload', async () => {
      await service.unblockUser('alice', 'bob');

      const [[type, data]] = eventsFor('bob');
      expect(type).toBe('user:unblocked');
      expect(data).toMatchObject({ blocked: false, isBlockedByThem: false });
    });

    it('does not fail the block when realtime delivery throws', async () => {
      // The row is already committed by this point. A dropped event costs a
      // stale composer until refresh; it must never cost the block.
      domainEvents.mockImplementation(() => {
        throw new Error('redis down');
      });
      await expect(service.blockUser('alice', 'bob')).resolves.toMatchObject({
        blocked: true,
      });
    });
  });

  describe('unblockUser', () => {
    it('removes only the blocker’s own row and restores nothing', async () => {
      await service.unblockUser('alice', 'bob');

      expect(blocksMock.useValue.removeBlock).toHaveBeenCalledWith(
        'alice',
        'bob',
      );
      // No follow re-creation and no match revival: re-following and
      // re-matching are deliberately manual after an unblock.
      expect(tx.follow.deleteMany).not.toHaveBeenCalled();
      expect(tx.matchSession.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('getBlockedContacts', () => {
    const setBlockRows = (rows: any[]) => {
      blockRows = rows;
    };

    const row = (id: string, deletedAt: Date | null = null) => ({
      blockedId: id,
      createdAt: new Date('2025-08-12T00:00:00Z'),
      blocked: {
        id,
        username: `${id}_h`,
        displayName: id.toUpperCase(),
        avatar: 'a.png',
        deletedAt,
      },
    });

    it('returns only blocks this user made, never blocks received', async () => {
      setBlockRows([row('bob')]);
      await service.getBlockedContacts('alice');

      expect(blocksMock.useValue.listBlockedContacts).toHaveBeenCalledWith(
        'alice',
        20,
        0,
      );
    });

    it('reports another page without a second query', async () => {
      setBlockRows(Array.from({ length: 21 }, (_, i) => row(`u${i}`)));
      const result = await service.getBlockedContacts('alice', 20, 0);

      expect(result.contacts).toHaveLength(20);
      expect(result.hasMore).toBe(true);
      expect(result.nextOffset).toBe(20);
    });

    it('anonymises a deleted account but keeps it unblockable', async () => {
      setBlockRows([row('ghost', new Date())]);
      const result = await service.getBlockedContacts('alice');

      expect(result.contacts[0]).toMatchObject({
        id: 'ghost',
        displayName: 'Deleted Account',
        username: null,
        avatar: null,
        isDeleted: true,
      });
    });
  });

  describe('follower and following lists', () => {
    /**
     * These lists are built with $queryRaw, so the only way to prove the
     * exclusion reaches the database is to inspect the SQL fragment handed to
     * Prisma. Asserting on the returned rows would prove nothing — the mock
     * decides those.
     */
    const sqlFragments = () => {
      const call = mockPrisma.$queryRaw.mock.calls[0];
      if (!call) return '';
      // Tagged template: (strings, ...values). Nested Prisma.sql fragments
      // arrive as values carrying their own `strings`.
      return call
        .slice(1)
        .map((v: any) =>
          v && Array.isArray(v.strings) ? v.strings.join(' ') : '',
        )
        .join(' ');
    };

    beforeEach(() => {
      mockPrisma.user = { findUnique: jest.fn(async () => ({ id: 'target' })) };
      mockPrisma.$queryRaw = jest.fn(async () => []);
    });

    it('excludes blocked users from a follower list at the database level', async () => {
      blocksMock.useValue.getExcludedUserIds = jest.fn(async () => ['bob']);

      await service.getFollowers('someone', 'alice');

      expect(sqlFragments()).toContain('NOT IN');
      expect(sqlFragments()).toContain('followerId');
    });

    it('excludes blocked users from a following list at the database level', async () => {
      blocksMock.useValue.getExcludedUserIds = jest.fn(async () => ['bob']);

      await service.getFollowing('someone', 'alice');

      expect(sqlFragments()).toContain('NOT IN');
      expect(sqlFragments()).toContain('followingId');
    });

    it('emits no NOT IN clause when the viewer has blocked nobody', async () => {
      blocksMock.useValue.getExcludedUserIds = jest.fn(async () => []);

      await service.getFollowers('someone', 'alice');

      // An empty list must not produce `NOT IN ()`, which is invalid SQL.
      expect(sqlFragments()).not.toContain('NOT IN');
    });

    it('skips the block lookup entirely for an anonymous viewer', async () => {
      blocksMock.useValue.getExcludedUserIds = jest.fn(async () => ['bob']);

      await service.getFollowers('someone', undefined);

      expect(blocksMock.useValue.getExcludedUserIds).not.toHaveBeenCalled();
      expect(sqlFragments()).not.toContain('NOT IN');
    });
  });
});
