import { describe, beforeEach, it, expect, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { PrismaService } from '../prisma/prisma.service';
import { BlocksService } from '../users/blocks.service';
import { RedisService } from '../redis/redis.service';

describe('SearchService', () => {
  let service: SearchService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      user: { findMany: (jest.fn() as any).mockResolvedValue([]), findUnique: (jest.fn() as any).mockResolvedValue(null) },
      community: { findMany: (jest.fn() as any).mockResolvedValue([]) },
      post: { findMany: (jest.fn() as any).mockResolvedValue([]) },
      crewActivity: { findMany: (jest.fn() as any).mockResolvedValue([]) },
      recentSearch: {
        findMany: (jest.fn() as any).mockResolvedValue([]),
        upsert: (jest.fn() as any).mockResolvedValue({}),
        deleteMany: (jest.fn() as any).mockResolvedValue({ count: 1 }),
      },
      postLike: { findMany: (jest.fn() as any).mockResolvedValue([]) },
      postBookmark: { findMany: (jest.fn() as any).mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: BlocksService, useValue: { getExcludedUserIds: (jest.fn() as any).mockResolvedValue([]) } },
        { provide: RedisService, useValue: { getClient: (jest.fn() as any).mockReturnValue(null) } },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return empty results for empty query', async () => {
    const res = await service.globalSearch('');
    expect(res).toEqual({ users: [], communities: [], posts: [], activities: [] });
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
