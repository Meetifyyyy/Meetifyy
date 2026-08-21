import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventService } from '../events/domain-event.service';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { RedisService } from '../redis/redis.service';
import { getQueueToken } from '@nestjs/bullmq';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor';
import { BlocksService } from './blocks.service';
import { PresenceService } from '../presence/presence.service';
import { AcademicsService } from '../academics/academics.service';

describe('Follow / Unfollow High Concurrency Stress Test', () => {
  let service: UsersService;

  const mockTargetUser = { id: 'target-user-id', username: 'sarthak' };

  const mockPrisma: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue(mockTargetUser),
    },
    block: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    follow: {
      deleteMany: jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
        return { count: 1 };
      }),
      count: jest.fn().mockResolvedValue(42),
    },
    $executeRaw: jest.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
      return 1;
    }),
    $queryRaw: jest.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
      return [{
        targetId: 'target-user-id',
        targetUsername: 'sarthak',
        targetDisplayName: 'Sarthak',
        targetAvatar: null,
        isBlocked: false,
        inserted: true,
        followersCount: 42,
        followingCount: 10,
      }];
    }),
  };

  const mockDomainEventService = {
    emit: jest.fn().mockResolvedValue(undefined),
  };

  const mockRedisService = {
    withLock: jest.fn(async (key: string, ttlMs: number, fn: () => Promise<any>) => fn()),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: { createNotification: jest.fn() } },
        { provide: NotificationFactory, useValue: { createFollow: jest.fn() } },
        { provide: DomainEventService, useValue: mockDomainEventService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: RedisService, useValue: mockRedisService },
        { provide: BlocksService, useValue: { isBlocked: jest.fn().mockResolvedValue(false) } },
        { provide: PresenceService, useValue: { getPresence: jest.fn(), getPresenceMany: jest.fn().mockResolvedValue(new Map()) } },
        // Real instance: it is pure validation logic with no I/O, so exercising
        // the actual catalogue here is more faithful than a stub.
        AcademicsService,
        { provide: getQueueToken(NOTIFICATIONS_QUEUE), useValue: { add: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should process 100 concurrent follow requests without deadlocks or 500 errors', async () => {
    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(service.followUser('follower-id', 'sarthak'));
    }

    const results = await Promise.allSettled(promises);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(100);
    expect(rejected.length).toBe(0);
  });

  it('should process 100 concurrent mixed follow/unfollow requests without throwing exceptions', async () => {
    const promises = [];
    for (let i = 0; i < 100; i++) {
      if (i % 2 === 0) {
        promises.push(service.followUser('follower-id', 'sarthak'));
      } else {
        promises.push(service.unfollowUser('follower-id', 'sarthak'));
      }
    }

    const results = await Promise.allSettled(promises);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(100);
    expect(rejected.length).toBe(0);
  });
});
