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
import { VerificationAccessService } from '../common/verification/verification-access.service';
import { createBlocksServiceMock } from './testing/blocks.service.mock';
import { studentYearPolicyMockProvider } from '../common/student-year/testing/student-year-policy.mock';

jest.mock('../auth/auth.service', () => ({ clearAuthSyncCache: jest.fn() }));

/**
 * The follower/following COUNT on a profile and the LIST behind it have to be
 * built from the same visibility rules.
 *
 * The bug: they were not. A profile read "1 Following" above a modal that said
 * "No following yet", because the count included an account the viewer is not
 * allowed to see and the list — correctly — did not. Blocks cause it at once;
 * first-year isolation causes it on 1 January, when a cohort rolls over and
 * accounts a senior already followed become invisible to them.
 *
 * These tests assert the rules are actually pushed into the count query rather
 * than asserting a number, because a fixture returning the right total says
 * nothing about which rows the database was asked to count.
 */
describe('Follower counts and the lists behind them', () => {
  let service: UsersService;
  let prisma: any;
  /** The `where` the profile query asked Postgres to count through. */
  let countArgs: any;

  const VIEWER = 'viewer-1';

  const makeModule = async (
    blocks: { blockerId: string; blockedId: string }[] = [],
  ) => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'target-1' }),
        findFirst: jest.fn(async (args: any) => {
          countArgs = args.include?._count?.select;
          return {
            id: 'target-1',
            username: 'target',
            displayName: 'Target',
            deletedAt: null,
            accountStatus: 'ACTIVE',
            verificationStatus: 'VERIFIED',
            createdAt: new Date(),
            settings: null,
            college: null,
            _count: { followers: 0, following: 0, posts: 0 },
          };
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      userSettings: { findUnique: jest.fn().mockResolvedValue(null) },
      follow: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      post: { count: jest.fn().mockResolvedValue(0) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        studentYearPolicyMockProvider(),
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { createNotification: jest.fn() } },
        { provide: NotificationFactory, useValue: { createFollow: jest.fn() } },
        { provide: DomainEventService, useValue: { emit: jest.fn().mockResolvedValue(undefined) } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: RedisService, useValue: { withLock: jest.fn(async (_k: any, _t: any, fn: any) => fn()) } },
        { provide: BlocksService, useValue: createBlocksServiceMock(blocks) },
        {
          provide: PresenceService,
          useValue: {
            getPresence: jest.fn(),
            getPresenceMany: jest.fn().mockResolvedValue(new Map()),
          },
        },
        AcademicsService,
        {
          provide: VerificationAccessService,
          useValue: { eligibleUserWhere: () => ({}), isEnforcementEnabled: () => true },
        },
        {
          provide: getQueueToken(NOTIFICATIONS_QUEUE),
          useValue: { add: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    countArgs = undefined;
    await makeModule();
  });

  it('counts only accounts that are alive and active', async () => {
    await service.getProfileByUsername('target', VIEWER);

    expect(countArgs.followers.where.follower).toMatchObject({
      deletedAt: null,
      accountStatus: 'ACTIVE',
    });
    expect(countArgs.following.where.following).toMatchObject({
      deletedAt: null,
      accountStatus: 'ACTIVE',
    });
  });

  it('excludes blocked accounts from both counts', async () => {
    await makeModule([{ blockerId: VIEWER, blockedId: 'blocked-1' }]);

    await service.getProfileByUsername('target', VIEWER);

    expect(countArgs.followers.where.follower.id.notIn).toContain('blocked-1');
    expect(countArgs.following.where.following.id.notIn).toContain('blocked-1');
  });

  /**
   * The exact case that produced "1 Following" over an empty list: the viewer
   * follows someone on the other side of the first-year boundary.
   */
  it('applies the first-year visibility rule to both counts', async () => {
    await service.getProfileByUsername('target', VIEWER);

    // The policy double returns a marker `where`; what matters is that the
    // count query carries whatever the policy produced, on both sides.
    const policy = service['studentYearPolicy'] as any;
    expect(policy.visibleUserWhere).toHaveBeenCalled();
    const produced = policy.visibleUserWhere.mock.results[0].value;
    for (const key of Object.keys(produced)) {
      expect(countArgs.followers.where.follower).toHaveProperty(key);
      expect(countArgs.following.where.following).toHaveProperty(key);
    }
  });

  it('leaves the post count alone — it is not a per-viewer social edge', async () => {
    await service.getProfileByUsername('target', VIEWER);

    expect(countArgs.posts.where).toEqual({ deletedAt: null, communityId: null });
  });
});
