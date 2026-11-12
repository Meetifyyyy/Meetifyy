import type Redis from 'ioredis';
import { CommunitiesService } from './communities.service';
import {
  allCommunitiesCacheKey,
  allCommunitiesCacheKeys,
  campusCommunitiesCacheKey,
  campusCommunitiesCacheKeys,
} from './communities-list-cache';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { RedisService } from '../redis/redis.service';
import type { PresenceService } from '../presence/presence.service';
import type { DefaultAssetsService } from '../uploads/default-assets.service';
import type { BlocksService } from '../users/blocks.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { NotificationFactory } from '../notifications/notification.factory';
import type { CampusAccessService } from '../common/campus/campus-access.service';

describe('community list cache keys', () => {
  it('cache only the first page at a common size', () => {
    expect(allCommunitiesCacheKey(undefined, 30, 0)).toBe('all:any:30:0');
    expect(allCommunitiesCacheKey('public', 50, 0)).toBe('all:public:50:0');
    expect(allCommunitiesCacheKey('public', 30, 30)).toBeNull();
    expect(allCommunitiesCacheKey('public', 7, 0)).toBeNull();
    expect(campusCommunitiesCacheKey('c1', 30, 5000)).toBeNull();
    expect(campusCommunitiesCacheKey('c1', 49, 0)).toBeNull();
  });

  it('can only ever produce the keys eviction knows by name', () => {
    const produced = new Set<string>();
    for (const visibility of ['public', 'private', undefined] as const) {
      for (let limit = 1; limit <= 50; limit++) {
        for (const offset of [0, 1, limit, 5000]) {
          const key = allCommunitiesCacheKey(visibility, limit, offset);
          if (key) produced.add(key);
        }
      }
    }
    expect([...produced].sort()).toEqual(allCommunitiesCacheKeys().sort());

    const campus = new Set<string>();
    for (let limit = 1; limit <= 50; limit++) {
      for (const offset of [0, limit, 5000]) {
        const key = campusCommunitiesCacheKey('c1', limit, offset);
        if (key) campus.add(key);
      }
    }
    expect([...campus].sort()).toEqual(campusCommunitiesCacheKeys('c1').sort());
  });
});

describe('CommunitiesService — list cache bounds', () => {
  const find = jest.fn<Promise<never[]>, []>();

  function build(redis: Redis | null): CommunitiesService {
    find.mockReset().mockResolvedValue([]);
    return new CommunitiesService(
      stub<PrismaService>({ community: { findMany: find } }),
      stub<DomainEventService>(),
      stub<RedisService>({ getClient: () => redis }),
      stub<PresenceService>(),
      stub<DefaultAssetsService>(),
      stub<BlocksService>(),
      stub<NotificationsService>(),
      stub<NotificationFactory>(),
      stub<CampusAccessService>(),
    );
  }

  const set = jest.fn<Promise<'OK'>, [string, string, 'EX', number]>();
  const sadd = jest.fn<Promise<number>, [string, string]>();
  const get = jest.fn<Promise<string | null>, [string]>();
  const expire = jest.fn<Promise<number>, [string, number]>();

  function fakeRedis(): Redis {
    get.mockReset().mockResolvedValue(null);
    set.mockReset().mockResolvedValue('OK');
    sadd.mockReset().mockResolvedValue(1);
    expire.mockReset().mockResolvedValue(1);
    return stub<Redis>({ get, set, sadd, expire });
  }

  it('writes and tags only canonical pages, whatever the client asks for', async () => {
    const service = build(fakeRedis());
    for (const limit of [1, 7, 30, 49, 50]) {
      for (const offset of [0, 1, 30, 5000]) {
        await service.getAllCommunities('me', limit, offset, {});
        await service.getCampusCommunities('me', limit, offset, '', 'c1');
      }
    }
    const allowed = new Set(
      [...allCommunitiesCacheKeys(), ...campusCommunitiesCacheKeys('c1')].map(
        (k) => `communities:${k}`,
      ),
    );
    expect(set.mock.calls.length).toBeGreaterThan(0);
    for (const [key] of set.mock.calls) expect(allowed.has(key)).toBe(true);
    for (const [, member] of sadd.mock.calls) {
      expect(allowed.has(member)).toBe(true);
    }
  });

  it('skips Redis entirely for a deep page and for a search', async () => {
    const service = build(fakeRedis());
    await service.getAllCommunities('me', 30, 60, {});
    await service.getAllCommunities('me', 30, 0, { search: 'chess' });
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('never lets the in-process fallback grow past its cap', async () => {
    const down = stub<Redis>({
      get: jest.fn().mockRejectedValue(new Error('down')),
      set: jest.fn().mockRejectedValue(new Error('down')),
    });
    const service = build(down);
    for (let i = 0; i < 1500; i++) {
      await service.getCampusCommunities('me', 30, 0, '', `college-${i}`);
    }
    const size = (service['localFallback'] as { size: number }).size;
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThanOrEqual(500);
  });
});
