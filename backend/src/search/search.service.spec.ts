import { describe, beforeEach, it, expect, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { ActivityAuthorizationService } from '../activities/activity-authorization.service';
import { PrismaService } from '../prisma/prisma.service';
import { BlocksService } from '../users/blocks.service';
import { RedisService } from '../redis/redis.service';
import { studentYearPolicyMockProvider } from '../common/student-year/testing/student-year-policy.mock';

/** A mock that resolves to `value`, typed by it. */
const resolves = <T>(value: T) =>
  jest.fn<() => Promise<T>>().mockResolvedValue(value);

const makePrisma = () => ({
  user: {
    findMany: resolves([]),
    findUnique: resolves(null),
  },
  community: { findMany: resolves([]) },
  post: { findMany: resolves([]) },
  crewActivity: { findMany: resolves([]) },
  recentSearch: {
    findMany: resolves([]),
    upsert: resolves({}),
    deleteMany: resolves({ count: 1 }),
  },
  postLike: { findMany: resolves([]) },
  postBookmark: { findMany: resolves([]) },
});

describe('SearchService', () => {
  let service: SearchService;
  let prismaMock: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prismaMock = makePrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        studentYearPolicyMockProvider(),
        SearchService,
        ActivityAuthorizationService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: BlocksService,
          useValue: {
            getExcludedUserIds: resolves([]),
          },
        },
        {
          provide: RedisService,
          useValue: { getClient: jest.fn<() => null>().mockReturnValue(null) },
        },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return empty results for empty query', async () => {
    const res = await service.globalSearch('');
    expect(res).toEqual({
      users: [],
      communities: [],
      posts: [],
      activities: [],
    });
  });

  it('should fetch suggestions for valid query', async () => {
    const res = await service.getSuggestions('test');
    expect(res).toHaveProperty('users');
    expect(res).toHaveProperty('communities');
    expect(res).toHaveProperty('activities');
  });

  it('should handle recent searches CRUD', async () => {
    const getRes = await service.getRecentSearches('user-1');
    expect(getRes).toEqual([]);

    await service.addRecentSearch('user-1', 'react');
    expect(prismaMock.recentSearch.upsert).toHaveBeenCalled();

    await service.removeRecentSearch('user-1', 'react');
    expect(prismaMock.recentSearch.deleteMany).toHaveBeenCalled();

    await service.clearRecentSearches('user-1');
    expect(prismaMock.recentSearch.deleteMany).toHaveBeenCalled();
  });
});
