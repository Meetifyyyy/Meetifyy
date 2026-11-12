import { describe, beforeEach, it, expect, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import {
  MAX_CACHED_TERM_LENGTH,
  SearchService,
  globalSearchCacheKey,
} from './search.service';
import { ActivityAuthorizationService } from '../activities/activity-authorization.service';
import { PrismaService } from '../prisma/prisma.service';
import { BlocksService } from '../users/blocks.service';
import { RedisService } from '../redis/redis.service';

const resolves = <T>(value: T) =>
  jest.fn<() => Promise<T>>().mockResolvedValue(value);

describe('global search cache key', () => {
  it('is the same for spellings that differ only in case and edge space', () => {
    expect(globalSearchCacheKey('  Priya', 'all', 'u1', 15, undefined)).toBe(
      globalSearchCacheKey('priya ', undefined, 'u1', 15, undefined),
    );
  });

  it('keeps viewers, types, limits and terms apart', () => {
    const base = globalSearchCacheKey('priya', 'all', 'u1', 15, undefined);
    expect(globalSearchCacheKey('priya', 'all', 'u2', 15, undefined)).not.toBe(
      base,
    );
    expect(
      globalSearchCacheKey('priya', 'posts', 'u1', 15, undefined),
    ).not.toBe(base);
    expect(globalSearchCacheKey('priya', 'all', 'u1', 20, undefined)).not.toBe(
      base,
    );
    expect(globalSearchCacheKey('priyb', 'all', 'u1', 15, undefined)).not.toBe(
      base,
    );
  });

  it('has the same length for a 100-character term as for a short one', () => {
    const short = globalSearchCacheKey('a', 'all', 'u1', 15, undefined);
    const long = globalSearchCacheKey(
      'a'.repeat(MAX_CACHED_TERM_LENGTH),
      'all',
      'u1',
      15,
      undefined,
    );
    expect(long).not.toBeNull();
    expect(long?.length).toBe(short?.length);
  });

  it('does not cache a 10 kB term, a cursor, an unknown type or a stray limit', () => {
    expect(
      globalSearchCacheKey('x'.repeat(10 * 1024), 'all', 'u1', 15, undefined),
    ).toBeNull();
    expect(globalSearchCacheKey('a', 'all', 'u1', 15, 'abc')).toBeNull();
    expect(
      globalSearchCacheKey('a', 'whatever', 'u1', 15, undefined),
    ).toBeNull();
    expect(globalSearchCacheKey('a', 'all', 'u1', 5000, undefined)).toBeNull();
    expect(globalSearchCacheKey('a', 'all', 'u1', NaN, undefined)).toBeNull();
  });

  it('keeps discovery apart from any typed term', () => {
    expect(globalSearchCacheKey('', 'all', 'u1', 15, undefined)).toContain(
      ':discovery:',
    );
  });
});

describe('SearchService Redis writes', () => {
  let service: SearchService;
  const get = jest.fn<(key: string) => Promise<string | null>>();
  const setex =
    jest.fn<(key: string, ttl: number, value: string) => Promise<'OK'>>();

  beforeEach(async () => {
    get.mockReset().mockResolvedValue(null);
    setex.mockReset().mockResolvedValue('OK');
    const prisma = {
      $queryRaw: resolves([]),
      user: { findMany: resolves([]), findUnique: resolves(null) },
      community: { findMany: resolves([]) },
      post: { findMany: resolves([]) },
      crewActivity: { findMany: resolves([]) },
      postLike: { findMany: resolves([]) },
      postBookmark: { findMany: resolves([]) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        SearchService,
        ActivityAuthorizationService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: BlocksService,
          useValue: { getExcludedUserIds: resolves([]) },
        },
        {
          provide: RedisService,
          useValue: { getClient: () => ({ get, setex }) },
        },
      ],
    }).compile();
    service = moduleRef.get(SearchService);
  });

  it('stores a first page under a fixed-length key', async () => {
    await service.globalSearch('Priya', 'u1', 15);
    expect(setex).toHaveBeenCalledTimes(1);
    expect(setex.mock.calls[0][0]).toMatch(
      /^search:v5:[0-9a-f]{16}:all:u1:15$/,
    );
  });

  it('writes nothing for a deep page or a 10 kB term', async () => {
    await service.globalSearch('priya', 'u1', 15, undefined, 'eyJwIjoieCJ9');
    await service.globalSearch('x'.repeat(10 * 1024), 'u1', 15);
    expect(get).not.toHaveBeenCalled();
    expect(setex).not.toHaveBeenCalled();
  });

  it('keys suggestions by digest too, and skips a 10 kB term', async () => {
    await service.getSuggestions('Priya', 'u1');
    expect(setex.mock.calls[0][0]).toMatch(
      /^search:suggestions:v4:[0-9a-f]{16}:u1$/,
    );
    setex.mockClear();
    await service.getSuggestions('x'.repeat(10 * 1024), 'u1');
    expect(setex).not.toHaveBeenCalled();
  });
});
