import type Redis from 'ioredis';
import { CampusEventsService } from './campus-events.service';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { CampusAccessService } from '../common/campus/campus-access.service';
import type { RedisService } from '../redis/redis.service';

describe('CampusEventsService — list cache keys', () => {
  const get = jest.fn<Promise<string | null>, [string]>();
  const setex = jest.fn<Promise<'OK'>, [string, number, string]>();
  const sadd = jest.fn<Promise<number>, [string, string]>();
  const expire = jest.fn<Promise<number>, [string, number]>();
  const findMany = jest.fn<Promise<never[]>, []>();
  const updateMany = jest.fn<Promise<{ count: number }>, []>();
  let service: CampusEventsService;

  beforeEach(() => {
    get.mockReset().mockResolvedValue(null);
    setex.mockReset().mockResolvedValue('OK');
    sadd.mockReset().mockResolvedValue(1);
    expire.mockReset().mockResolvedValue(1);
    findMany.mockReset().mockResolvedValue([]);
    updateMany.mockReset().mockResolvedValue({ count: 0 });
    service = new CampusEventsService(
      stub<PrismaService>({ campusEvent: { findMany, updateMany } }),
      stub<CampusAccessService>(),
      stub<RedisService>({
        getClient: () => stub<Redis>({ get, setex, sadd, expire }),
      }),
    );
  });

  it('caches the first page under a key without a cursor', async () => {
    await service.listByScope('me', 'upcoming', { campusId: 'c1', limit: 20 });
    expect(setex.mock.calls[0][0]).toBe('campus-events:v2:c1:upcoming:20');
    expect(sadd).toHaveBeenCalledWith(
      'campus-events:tag:c1',
      'campus-events:v2:c1:upcoming:20',
    );
  });

  it('does not touch Redis for any page reached by cursor', async () => {
    for (let i = 0; i < 25; i++) {
      await service.listByScope('me', 'past', {
        campusId: 'c1',
        cursor: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z|id${i}`,
      });
    }
    await service.listByScope('me', 'past', {
      campusId: 'c1',
      cursor: 'x'.repeat(10 * 1024),
    });
    expect(get).not.toHaveBeenCalled();
    expect(setex).not.toHaveBeenCalled();
    expect(sadd).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledTimes(26);
  });

  it('keeps the tag set to first-page keys only: at most one per scope and limit', async () => {
    for (const scope of ['upcoming', 'ongoing', 'past'] as const) {
      for (const limit of [1, 20, 50, 500]) {
        await service.listByScope('me', scope, { campusId: 'c1', limit });
      }
    }
    const members = new Set(sadd.mock.calls.map((c) => c[1]));
    // 3 scopes x limits clamped to 1..50 (1, 20, 50, and 500 -> 50).
    expect(members.size).toBe(9);
  });
});
