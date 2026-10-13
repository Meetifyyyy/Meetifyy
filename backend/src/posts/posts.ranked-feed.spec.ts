import type Redis from 'ioredis';
import { PostsService } from './posts.service';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { NotificationFactory } from '../notifications/notification.factory';
import type { BlocksService } from '../users/blocks.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { RedisService } from '../redis/redis.service';
import type { MentionsService } from '../mentions/mentions.service';
import type { StorageService } from '../uploads/uploads.service';
import type { ContentDeletionAuthorizer } from './content-deletion.authorizer';
import { parseRankedCursor } from './feed-ranking';

/**
 * The For You feed's paging: one ranking per session, walked by offset, then
 * continued chronologically. The ranking SQL itself is checked against a real
 * database; here `$queryRaw` hands back scored rows and the chronological
 * loader is spied, so what is tested is the session and cursor handling.
 */
describe('PostsService ranked feed', () => {
  const ago = (min: number) => new Date(Date.now() - min * 60_000);
  const scored = Array.from({ length: 25 }, (_, i) => ({
    id: `p${String(i).padStart(2, '0')}`,
    authorId: `a${i}`,
    createdAt: ago(120 + i),
    followsAuthor: false,
    isOwn: false,
    score: 100 - i,
  }));

  let store: Map<string, string>;
  let queryRaw: jest.Mock;
  let redisAvailable: boolean;
  let service: PostsService;
  let chrono: jest.SpyInstance;

  beforeEach(() => {
    store = new Map();
    redisAvailable = true;
    queryRaw = jest.fn(() => Promise.resolve(scored));
    const redis = stub<Redis>({
      get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      set: jest.fn((key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve('OK');
      }),
    });
    service = new PostsService(
      stub<PrismaService>({ $queryRaw: queryRaw }),
      stub<NotificationsService>(),
      stub<NotificationFactory>(),
      stub<BlocksService>({
        getExcludedUserIds: jest.fn(() => Promise.resolve([])),
      }),
      stub<DomainEventService>(),
      stub<RedisService>({
        getClient: () => (redisAvailable ? redis : null),
      }),
      stub<MentionsService>(),
      stub<StorageService>(),
      stub<ContentDeletionAuthorizer>(),
    );
    // Echo back the requested ids in database (chronological) order, as the
    // real loader does, so the test proves the ranked order is restored.
    chrono = jest.spyOn(service, 'getChronologicalFeed').mockImplementation(
      (_u: string, _l?: number, _c?: string, _cid?: string, ids?: string[]) =>
        Promise.resolve({
          posts: [...(ids ?? [])]
            .sort()
            .reverse()
            .map((id) => ({ id })),
          nextCursor: ids ? undefined : 'chrono-next',
        }) as ReturnType<PostsService['getChronologicalFeed']>,
    );
  });

  it('serves the first page in ranked order with a ranked cursor', async () => {
    const page = await service.getFeed('me', 10);
    expect(page.posts.map((p) => p.id)).toEqual(
      scored.slice(0, 10).map((r) => r.id),
    );
    expect(parseRankedCursor(page.nextCursor)?.offset).toBe(10);
  });

  it('walks the same ranking on later pages without re-ranking', async () => {
    const first = await service.getFeed('me', 10);
    const second = await service.getFeed('me', 10, first.nextCursor);
    expect(second.posts.map((p) => p.id)).toEqual(
      scored.slice(10, 20).map((r) => r.id),
    );
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('continues chronologically once the ranked list is used up', async () => {
    const first = await service.getFeed('me', 10);
    const second = await service.getFeed('me', 10, first.nextCursor);
    const third = await service.getFeed('me', 10, second.nextCursor);
    expect(third.posts).toHaveLength(5);
    // Fewer than the candidate cap, so it continues from the window's start.
    expect(third.nextCursor).toMatch(/^\d{4}-\d\d-\d\dT.*Z\|$/);
  });

  it('reuses the order for a first-page refetch moments later', async () => {
    const a = await service.getFeed('me', 10);
    const b = await service.getFeed('me', 10);
    expect(b.nextCursor).toBe(a.nextCursor);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('falls back to chronological, not a new ranking, when a session expired mid-scroll', async () => {
    const first = await service.getFeed('me', 10);
    store.clear();
    const next = await service.getFeed('me', 10, first.nextCursor);
    expect(next.nextCursor).toBe('chrono-next');
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('is chronological for a community feed, a legacy cursor, or no Redis', async () => {
    await service.getFeed('me', 10, undefined, 'community-1');
    await service.getFeed('me', 10, '2026-10-01T00:00:00.000Z|p1');
    redisAvailable = false;
    await service.getFeed('me', 10);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(chrono).toHaveBeenCalledTimes(3);
  });
});
