import { ForbiddenException } from '@nestjs/common';
import { stub } from '../../common/testing/stub';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventService } from '../../events/domain-event.service';
import { ActivityAuthorizationService } from '../activity-authorization.service';
import { BlocksService } from '../../users/blocks.service';
import { ActivityDiscussionService } from './activity-discussion.service';

/**
 * A discussion is read a page at a time, newest first, by keyset. These specs
 * hold the bounds that keep a thread from being fetched in one request, and the
 * scoping of the cursor.
 */
describe('ActivityDiscussionService — paging', () => {
  const author = {
    id: 'u1',
    username: 'sam',
    displayName: 'Sam',
    avatar: null,
    isCampusRep: false,
    accountStatus: 'ACTIVE',
    deletedAt: null,
  };
  const row = (n: number) => ({
    id: `m${n}`,
    text: `t${n}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 12, n)),
    userId: 'u1',
    user: author,
  });
  /** Newest first, as the query returns them. */
  const rows = (count: number) =>
    Array.from({ length: count }, (_, i) => row(count - i));

  const build = (
    opts: { found?: ReturnType<typeof row>[]; cursor?: object | null } = {},
  ) => {
    const findMany = jest.fn().mockResolvedValue(opts.found ?? []);
    const findFirst = jest.fn().mockResolvedValue(opts.cursor ?? null);
    const injectBlockFilter = jest.fn((_user: string, where: object) =>
      Promise.resolve(where),
    );
    const assertCanView = jest.fn();
    const service = new ActivityDiscussionService(
      stub<PrismaService>({
        activityDiscussionMessage: { findMany, findFirst },
        crewActivity: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'act', creatorId: 'host' }),
        },
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'v' }) },
      }),
      stub<DomainEventService>(),
      stub<ActivityAuthorizationService>({ assertCanView }),
      stub<BlocksService>({
        injectBlockFilter,
        isBlocked: jest.fn().mockResolvedValue(false),
      }),
    );
    return { service, findMany, findFirst, assertCanView };
  };

  it('never takes more than the maximum page, whatever limit is asked for', async () => {
    const { service, findMany } = build();
    await service.getMessages('act', 'v', undefined, 100_000);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 51 }),
    );
  });

  it('reports whether older messages remain and hands back a cursor for them', async () => {
    const { service } = build({ found: rows(21) });
    const page = await service.getMessages('act', 'v', undefined, 20);
    expect(page.messages).toHaveLength(20);
    expect(page.hasMore).toBe(true);
    // The oldest message of the page, which is the next `before`.
    expect(page.nextCursor).toBe(page.messages[0].id);
    // Chronological order within the page.
    expect(page.messages[0].createdAt.getTime()).toBeLessThan(
      page.messages[19].createdAt.getTime(),
    );
  });

  it('says there is nothing older on the last page', async () => {
    const { service } = build({ found: rows(5) });
    const page = await service.getMessages('act', 'v', undefined, 20);
    expect(page).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it('looks the cursor up inside this activity only', async () => {
    const { service, findFirst } = build({
      cursor: { id: 'm9', createdAt: new Date(Date.UTC(2026, 0, 1, 12, 9)) },
    });
    await service.getMessages('act', 'v', 'm9', 20);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm9', activityId: 'act' } }),
    );
  });

  it('pages strictly before the cursor, with the id as the tiebreak', async () => {
    const at = new Date(Date.UTC(2026, 0, 1, 12, 9));
    const { service, findMany } = build({
      cursor: { id: 'm9', createdAt: at },
    });
    await service.getMessages('act', 'v', 'm9', 20);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { activityId: 'act' },
            {
              OR: [
                { createdAt: { lt: at } },
                { createdAt: at, id: { lt: 'm9' } },
              ],
            },
          ],
        },
      }),
    );
  });

  it('returns nothing when the viewer may not see the activity', async () => {
    const { service, assertCanView, findMany } = build({ found: rows(3) });
    assertCanView.mockImplementation(() => {
      throw new ForbiddenException();
    });
    await expect(service.getMessages('act', 'v')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // Authorisation failed, so no page was returned to anyone.
    expect(findMany).not.toHaveBeenCalled();
  });
});
