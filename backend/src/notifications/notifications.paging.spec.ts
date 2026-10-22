import { Test, TestingModule } from '@nestjs/testing';
import { BlocksService } from '../users/blocks.service';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventService } from '../events/domain-event.service';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationType } from '@prisma/client';

/**
 * Paging through the notification feed returns every row exactly once.
 *
 * The page used to fetch `limit + 1` rows, pop the extra one, and hand back
 * ITS id as the cursor. The next page resumes `skip: 1` past the cursor, so the
 * popped row was never returned by either page: one notification vanished at
 * every page boundary.
 *
 * The fake below applies `cursor`/`skip`/`take` the way Prisma does, over rows
 * already in the requested order, so the test exercises the service's own
 * cursor arithmetic rather than a mocked answer.
 */
type Row = {
  id: string;
  createdAt: Date;
  type: NotificationType;
  metadata: null;
};
type FindManyArgs = { take: number; skip?: number; cursor?: { id: string } };

const rows: Row[] = Array.from({ length: 7 }, (_, i) => ({
  id: `n${7 - i}`,
  // Rows share timestamps in pairs; the id tiebreak keeps their order stable.
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, Math.ceil((7 - i) / 2))),
  type: NotificationType.LIKE,
  metadata: null,
}));

function page({ take, skip = 0, cursor }: FindManyArgs): Promise<Row[]> {
  const start = cursor ? rows.findIndex((r) => r.id === cursor.id) : 0;
  return Promise.resolve(rows.slice(start + skip, start + skip + take));
}

describe('NotificationsService — paging', () => {
  let service: NotificationsService;
  const findMany = jest.fn<Promise<Row[]>, [FindManyArgs]>(page);

  beforeEach(async () => {
    findMany.mockClear();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        EventEmitter2,
        {
          provide: PrismaService,
          useValue: {
            notification: { findMany },
            activityInvitation: { findMany: jest.fn().mockResolvedValue([]) },
          },
        },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: RedisService,
          useValue: { getClient: jest.fn().mockReturnValue(null) },
        },
        {
          provide: BlocksService,
          useValue: {
            getExcludedUserIds: jest.fn().mockResolvedValue([]),
            isBlocked: jest.fn().mockResolvedValue(false),
            filterBlockedUsers: jest.fn((_u: string, ids: string[]) =>
              Promise.resolve(ids),
            ),
            injectBlockFilter: jest.fn((_u: string, w: unknown) =>
              Promise.resolve(w),
            ),
            invalidateBlockCache: jest.fn(),
          },
        },
      ],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('returns every notification exactly once across pages', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i += 1) {
      const res = await service.getNotifications('user-1', 3, cursor);
      seen.push(...res.data.map((n) => n.id));
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(rows.map((r) => r.id));
  });

  it('points the cursor at the last row it returned', async () => {
    const res = await service.getNotifications('user-1', 3);
    expect(res.data.map((n) => n.id)).toEqual(['n7', 'n6', 'n5']);
    expect(res.nextCursor).toBe('n5');
  });

  it('has no cursor on the last page', async () => {
    const res = await service.getNotifications('user-1', 3, 'n2');
    expect(res.data.map((n) => n.id)).toEqual(['n1']);
    expect(res.nextCursor).toBeUndefined();
  });

  it('breaks createdAt ties by id, so a cursor resumes in a stable order', async () => {
    await service.getNotifications('user-1', 3);
    const args = findMany.mock.calls[0][0] as unknown as { orderBy: unknown };
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });
});
