import { Prisma } from '@prisma/client';
import { PostsService } from './posts.service';
import { stub } from '../common/testing/stub';
import {
  authorVisibilitySql,
  authorVisibilityWhere,
} from './author-visibility';
import { privateAuthor, PUBLIC_AUTHOR } from './testing/author-privacy.fake';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { NotificationFactory } from '../notifications/notification.factory';
import type { BlocksService } from '../users/blocks.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { RedisService } from '../redis/redis.service';
import type {
  MentionsService,
  SanitizedMention,
} from '../mentions/mentions.service';
import type { StorageService } from '../uploads/uploads.service';
import type { ContentDeletionAuthorizer } from './content-deletion.authorizer';

/**
 * A private account's own posts are for the account and its followers, and
 * every way of listing posts has to say so: both home feeds, a profile, the
 * bookmarks list, and the notifications a mention sends.
 *
 * The SQL and `where` are read here, not run: they prove the rule is present in
 * each query and bound to the viewer. What Postgres makes of them is checked
 * against a real database. Community posts are never hidden by this rule (their
 * own community rules govern them), which the shared `p."communityId" IS NOT
 * NULL` branch encodes.
 */
describe('PostsService — a private author’s own posts', () => {
  const VIEWER = 'viewer-1';

  const collapse = (sql: string) => sql.replace(/\s+/g, ' ').trim();
  /** The exact fragment the shared builder yields, as the query flattens it. */
  const ruleSql = (viewer: string | undefined) =>
    collapse(Prisma.sql`${authorVisibilitySql(viewer, 'p')}`.sql);

  type RawCall = { sql: string; values: unknown[] };

  const build = (over: { prisma?: object } = {}) => {
    const calls: RawCall[] = [];
    const queryRaw = jest.fn(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const built = Prisma.sql(strings, ...values);
        calls.push({ sql: collapse(built.sql), values: built.values });
        return Promise.resolve([]);
      },
    );
    const persistAndNotify = jest.fn((_p: unknown) => Promise.resolve());
    const prisma = { $queryRaw: queryRaw, ...over.prisma };
    const service = new PostsService(
      stub<PrismaService>(prisma),
      stub<NotificationsService>(),
      stub<NotificationFactory>(),
      stub<BlocksService>({
        getExcludedUserIds: jest.fn(() => Promise.resolve([])),
        isBlocked: jest.fn(() => Promise.resolve(false)),
        injectBlockFilter: <T extends object>(_u: string, w: T) =>
          Promise.resolve(w),
      }),
      stub<DomainEventService>(),
      stub<RedisService>(),
      stub<MentionsService>({ persistAndNotify }),
      stub<StorageService>(),
      stub<ContentDeletionAuthorizer>(),
    );
    return { service, calls, persistAndNotify };
  };

  describe('home feeds (SQL)', () => {
    it('the ranked feed’s candidates carry the rule, bound to the viewer', async () => {
      const { service, calls } = build();
      await service['buildRankedSession'](VIEWER);

      expect(calls).toHaveLength(1);
      const { sql, values } = calls[0];
      expect(sql).toContain(ruleSql(VIEWER));
      // Inside the candidates CTE, before its ORDER BY / LIMIT, so the 400
      // newest rows are chosen from posts the viewer may see.
      const candidates = sql.indexOf('candidates AS (');
      const rule = sql.indexOf('us."privateProfile" = true');
      const order = sql.indexOf('ORDER BY p."createdAt" DESC');
      expect(candidates).toBeGreaterThan(-1);
      expect(rule).toBeGreaterThan(candidates);
      expect(rule).toBeLessThan(order);
      expect(sql).not.toContain(VIEWER);
      expect(values.filter((v) => v === VIEWER).length).toBeGreaterThanOrEqual(
        3,
      );
    });

    it('the chronological feed carries the rule', async () => {
      const { service, calls } = build();
      await service.getChronologicalFeed(VIEWER, 10);

      expect(calls[0].sql).toContain(ruleSql(VIEWER));
      expect(calls[0].sql).not.toContain(VIEWER);
    });

    it('the ranked feed’s page loads (restrictToIds) carry the rule too', async () => {
      const { service, calls } = build();
      await service.getChronologicalFeed(VIEWER, 10, undefined, undefined, [
        'p1',
        'p2',
      ]);

      const { sql } = calls[0];
      expect(sql).toContain(ruleSql(VIEWER));
      expect(sql).toContain('AND p.id IN (?,?)');
    });

    it('a community feed carries it as well (a community post passes on its own branch)', async () => {
      const { service, calls } = build({
        prisma: {
          community: {
            findUnique: jest.fn(() => Promise.resolve(null)),
          },
        },
      });
      await service.getChronologicalFeed(VIEWER, 10, undefined, 'c1');

      expect(calls[0].sql).toContain(ruleSql(VIEWER));
      expect(calls[0].sql).toContain('p."communityId" IS NOT NULL OR');
    });

    it('a signed-out read admits only public authors’ posts', async () => {
      const { service, calls } = build();
      await service.getChronologicalFeed('', 10);

      const { sql } = calls[0];
      expect(sql).toContain(ruleSql(undefined));
      // No follow branch for someone who follows nobody.
      expect(sql).not.toContain('fv."followerId"');
    });
  });

  describe('profile posts', () => {
    const profile = (author: { id: string }) => {
      const findMany = jest.fn((_args: unknown) => Promise.resolve([]));
      const { service } = build({
        prisma: {
          user: { findUnique: jest.fn(() => Promise.resolve(author)) },
          post: { findMany },
        },
      });
      return { service, findMany };
    };

    it.each([
      ['a stranger', VIEWER],
      ['a follower', 'fan'],
      ['the author', 'author-id'],
      ['a pending requester', 'requester'],
    ])(
      'puts the rule in the query for %s, so the decision is made by the database',
      async (_who, viewer) => {
        const { service, findMany } = profile({ id: 'author-id' });
        await service.getUserPosts(viewer, 'someone');

        expect(findMany.mock.calls[0][0]).toMatchObject({
          where: {
            authorId: 'author-id',
            communityId: null,
            AND: [authorVisibilityWhere(viewer)],
          },
        });
      },
    );

    it('answers a page the rule empties with the same empty shape', async () => {
      const { service } = profile({ id: 'author-id' });
      await expect(service.getUserPosts(VIEWER, 'someone')).resolves.toEqual({
        posts: [],
        nextCursor: undefined,
      });
    });
  });

  describe('bookmarks', () => {
    it('stops resolving a bookmark whose author is private and not followed', async () => {
      const findMany = jest.fn((_args: unknown) => Promise.resolve([]));
      const { service } = build({
        prisma: {
          collegeAffiliation: {
            findUnique: jest.fn(() => Promise.resolve(null)),
          },
          postBookmark: { findMany },
        },
      });
      await expect(service.getBookmarks(VIEWER)).resolves.toEqual({
        posts: [],
        nextCursor: undefined,
      });

      const where = (
        findMany.mock.calls[0][0] as { where: { post: { AND: unknown[] } } }
      ).where;
      expect(where.post.AND).toContainEqual(authorVisibilityWhere(VIEWER));
    });
  });

  describe('mentions', () => {
    const mention = (userId: string, start: number): SanitizedMention => ({
      userId,
      username: userId,
      start,
      end: start + 4,
    });
    const mentions = [mention('fan', 0), mention('stranger', 6)];

    const withAuthor = (row: object | null) => {
      const findUnique = jest.fn((_args: unknown) => Promise.resolve(row));
      return {
        findUnique,
        ...build({ prisma: { user: { findUnique } } }),
      };
    };

    it('drops the mention of someone who cannot open a private author’s post', async () => {
      const { service, findUnique } = withAuthor(privateAuthor(['fan']));
      const kept = await service['mentionsWhoCanSeePost'](mentions, {
        authorId: 'author',
        communityId: null,
      });
      expect(kept.map((m) => m.userId)).toEqual(['fan']);
      // One statement for the whole set, not one per mention.
      expect(findUnique).toHaveBeenCalledTimes(1);
    });

    it('keeps every mention of a public author’s post', async () => {
      const { service } = withAuthor(PUBLIC_AUTHOR);
      const kept = await service['mentionsWhoCanSeePost'](mentions, {
        authorId: 'author',
        communityId: null,
      });
      expect(kept).toEqual(mentions);
    });

    it('leaves a community post to the community’s own behaviour, without a query', async () => {
      const { service, findUnique } = withAuthor(privateAuthor());
      const kept = await service['mentionsWhoCanSeePost'](mentions, {
        authorId: 'author',
        communityId: 'c1',
      });
      expect(kept).toEqual(mentions);
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('a comment under a private author’s post notifies only mentioned users who can open it', async () => {
      const comment = {
        id: 'c1',
        postId: 'p1',
        parentId: null,
        authorId: 'fan',
        text: '@fan @stranger',
        likeCount: 0,
        author: { id: 'fan', username: 'fan' },
      };
      const sanitize = jest.fn(
        (_t: string, _m: unknown, _a: string): Promise<SanitizedMention[]> =>
          Promise.resolve(mentions),
      );
      const persistAndNotify = jest.fn((_p: unknown) => Promise.resolve());
      const prisma = {
        post: {
          findUnique: jest.fn(() =>
            Promise.resolve({
              id: 'p1',
              authorId: 'author',
              communityId: null,
              deletedAt: null,
            }),
          ),
          update: jest.fn(() => Promise.resolve({ id: 'p1' })),
        },
        // Both the access check and the audience filter read the author.
        user: {
          findUnique: jest.fn(() => Promise.resolve(privateAuthor(['fan']))),
        },
        comment: { create: jest.fn(() => Promise.resolve(comment)) },
        $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
      };
      const service = new PostsService(
        stub<PrismaService>(prisma),
        stub<NotificationsService>({
          createNotification: jest.fn(() => Promise.resolve()),
        }),
        stub<NotificationFactory>({
          createComment: jest.fn(() => ({})),
        }),
        stub<BlocksService>({ getExcludedUserIds: () => Promise.resolve([]) }),
        stub<DomainEventService>({ emit: jest.fn(() => Promise.resolve()) }),
        stub<RedisService>(),
        stub<MentionsService>({ sanitize, persistAndNotify }),
        stub<StorageService>(),
        stub<ContentDeletionAuthorizer>(),
      );

      await service.addComment('p1', 'fan', '@fan @stranger');
      // The notification runs after the write, off the request path.
      await new Promise((resolve) => setImmediate(resolve));

      expect(persistAndNotify).toHaveBeenCalledTimes(1);
      const [params] = persistAndNotify.mock.calls[0] as [
        { mentions: SanitizedMention[] },
      ];
      expect(params.mentions.map((m) => m.userId)).toEqual(['fan']);
    });
  });
});
