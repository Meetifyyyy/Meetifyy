import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ActivitiesService, isCacheableFeedPage } from './activities.service';
import { ActivityAuthorizationService } from './activity-authorization.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { BlocksService } from '../users/blocks.service';
import { DomainEventService } from '../events/domain-event.service';
import { RedisService } from '../redis/redis.service';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor';
import { affiliatedWith } from '../common/campus/testing/affiliation.fixture';

describe('Activities feed cache keys', () => {
  const get = jest.fn<Promise<string | null>, [string]>();
  const setex = jest.fn<Promise<'OK'>, [string, number, string]>();
  const sadd = jest.fn<Promise<number>, [string, string]>();
  const expire = jest.fn<Promise<number>, [string, number]>();
  const crewFindMany = jest.fn<Promise<never[]>, []>();
  const crewFindUnique = jest.fn<Promise<null>, []>();
  let service: ActivitiesService;

  beforeEach(async () => {
    get.mockReset().mockResolvedValue(null);
    setex.mockReset().mockResolvedValue('OK');
    sadd.mockReset().mockResolvedValue(1);
    expire.mockReset().mockResolvedValue(1);
    crewFindMany.mockReset().mockResolvedValue([]);
    crewFindUnique.mockReset().mockResolvedValue(null);

    const prisma = {
      crewActivity: { findMany: crewFindMany, findUnique: crewFindUnique },
      crewActivityMember: { findMany: jest.fn().mockResolvedValue([]) },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'me',
          collegeId: 'c1',
          collegeAffiliation: affiliatedWith('c1'),
        }),
      },
      activityInvitation: { count: jest.fn().mockResolvedValue(0) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        ActivityAuthorizationService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: {} },
        { provide: NotificationFactory, useValue: {} },
        {
          provide: BlocksService,
          useValue: { getExcludedUserIds: jest.fn().mockResolvedValue([]) },
        },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        {
          provide: RedisService,
          useValue: { getClient: () => ({ get, setex, sadd, expire }) },
        },
        {
          provide: getQueueToken(NOTIFICATIONS_QUEUE),
          useValue: { add: jest.fn() },
        },
      ],
    }).compile();
    service = moduleRef.get(ActivitiesService);
  });

  it('stores the first page under keys without a cursor', async () => {
    await service.getAllActivities('me', 20, undefined, 'public');
    const keys = setex.mock.calls.map((c) => c[0]);
    expect(keys).toContain('activities:feed:v2:public:me:20');
    expect(keys).toContain('activities:feed:base:v2:public:aud:c1:20');
    for (const key of keys) expect(key.length).toBeLessThan(120);
  });

  it('does not read or write Redis for a page reached by cursor', async () => {
    for (let i = 0; i < 20; i++) {
      const cursor = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
      await service.getAllActivities('me', 20, cursor, 'public');
    }
    expect(get).not.toHaveBeenCalled();
    expect(setex).not.toHaveBeenCalled();
    expect(sadd).not.toHaveBeenCalled();
    expect(crewFindMany).toHaveBeenCalledTimes(20);
  });

  it('answers a 10 kB cursor without a lookup or a key', async () => {
    await service.getAllActivities('me', 20, 'x'.repeat(10 * 1024), 'public');
    expect(crewFindUnique).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(setex).not.toHaveBeenCalled();
  });

  it('only caches page sizes the controller can produce', () => {
    expect(isCacheableFeedPage(20, undefined)).toBe(true);
    expect(isCacheableFeedPage(50, undefined)).toBe(true);
    expect(isCacheableFeedPage(51, undefined)).toBe(false);
    expect(isCacheableFeedPage(0, undefined)).toBe(false);
    expect(isCacheableFeedPage(NaN, undefined)).toBe(false);
    expect(isCacheableFeedPage(20, '2026-01-01T00:00:00.000Z')).toBe(false);
  });
});
