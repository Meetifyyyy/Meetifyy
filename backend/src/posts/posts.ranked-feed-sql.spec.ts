import { Prisma } from '@prisma/client';
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

/**
 * The shape of the For You ranking statement. It is read here, not run: what
 * Postgres does with it (and that its output equals the correlated form it
 * replaced) is checked against a real database. These tests pin what must not
 * drift: the signals are computed once per feed build rather than once per
 * candidate, and the candidate rules and scoring weights are untouched.
 */
describe('PostsService ranking statement', () => {
  const VIEWER = 'viewer-1';

  type RawCall = { sql: string; values: unknown[] };

  const collapse = (sql: string) =>
    sql
      .replace(/--[^\n]*/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\( /g, '(')
      .replace(/ \)/g, ')')
      .trim();

  const build = (excluded: string[] = []) => {
    const calls: RawCall[] = [];
    const queryRaw = jest.fn(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const built = Prisma.sql(strings, ...values);
        calls.push({ sql: collapse(built.sql), values: built.values });
        return Promise.resolve([]);
      },
    );
    const service = new PostsService(
      stub<PrismaService>({ $queryRaw: queryRaw }),
      stub<NotificationsService>(),
      stub<NotificationFactory>(),
      stub<BlocksService>({
        getExcludedUserIds: jest.fn(() => Promise.resolve(excluded)),
      }),
      stub<DomainEventService>(),
      stub<RedisService>(),
      stub<MentionsService>(),
      stub<StorageService>(),
      stub<ContentDeletionAuthorizer>(),
    );
    return { service, calls };
  };

  /** The text of the final SELECT, after every CTE. */
  const finalSelect = (sql: string) =>
    sql.slice(sql.lastIndexOf(') SELECT cd.id'));

  describe('per-candidate signals are computed set-wise', () => {
    it('reads the viewer’s own follow and affinity rows once, by their key prefix', async () => {
      const { service, calls } = build();
      await service['buildRankedSession'](VIEWER);

      expect(calls).toHaveLength(1);
      const { sql, values } = calls[0];
      expect(sql).toContain(
        'my_follows AS MATERIALIZED (SELECT f."followingId" FROM "Follow" f WHERE f."followerId" = ?',
      );
      expect(sql).toContain(
        'my_affinity AS MATERIALIZED (SELECT ua."targetId", ua."score" FROM "UserAffinity" ua WHERE ua."userId" = ?',
      );
      // Bound to the viewer, never interpolated into the text.
      expect(sql).not.toContain(VIEWER);
      expect(values.filter((v) => v === VIEWER).length).toBeGreaterThanOrEqual(
        5,
      );
    });

    it('joins those sets to the candidates instead of probing per row', async () => {
      const { service, calls } = build();
      await service['buildRankedSession'](VIEWER);

      const last = finalSelect(calls[0].sql);
      expect(last).toContain(
        'LEFT JOIN my_follows mf ON mf."followingId" = cd."authorId"',
      );
      expect(last).toContain(
        'LEFT JOIN my_affinity ua ON ua."targetId" = cd."authorId"',
      );
      expect(last).toContain('LEFT JOIN tag_hits th ON th."postId" = cd.id');
      expect(last).toContain(
        'JOIN author_signals asg ON asg."authorId" = cd."authorId"',
      );
      // None of the old per-candidate sub-queries remain in the scoring.
      expect(last).not.toContain('EXISTS');
      expect(last).not.toContain('(SELECT');
      expect(last).not.toContain('FROM "Follow"');
      expect(last).not.toContain('FROM "PostHashtag"');
      expect(last).not.toContain('FROM "CollegeAffiliation"');
      expect(last).not.toContain('INTERSECT');
      expect(last).not.toContain('LEFT JOIN "UserAffinity"');
    });

    it('counts matching hashtags and shared interests in grouped CTEs', async () => {
      const { service, calls } = build();
      await service['buildRankedSession'](VIEWER);

      const { sql } = calls[0];
      expect(sql).toContain(
        'tag_hits AS (SELECT ph."postId", COUNT(*) AS "hits" FROM me CROSS JOIN candidates cd JOIN "PostHashtag" ph ON ph."postId" = cd.id JOIN "Hashtag" h ON h.id = ph."hashtagId" WHERE lower(h.name) = ANY(me."interests") GROUP BY ph."postId")',
      );
      expect(sql).toContain('author_interests AS (');
      expect(sql).toContain('GROUP BY t."authorId"');
      expect(sql).toContain('unnest(ca."authorInterests")');
      // Same campus is an active affiliation to the viewer's own college.
      expect(sql).toContain(
        'LEFT JOIN "CollegeAffiliation" aa ON aa."userId" = ca."authorId" AND aa."revokedAt" IS NULL AND aa."collegeId" = me."collegeId"',
      );
      expect(sql).toContain(
        '(me."collegeId" IS NOT NULL AND aa."userId" IS NOT NULL) AS "sameCampus"',
      );
    });
  });

  describe('the candidate rules are unchanged', () => {
    it('keeps the private-author rule, bound to the viewer, inside the candidates', async () => {
      const { service, calls } = build();
      await service['buildRankedSession'](VIEWER);

      const { sql } = calls[0];
      const candidates = sql.indexOf('candidates AS (');
      const privateRule = sql.indexOf('us."privateProfile" = true');
      const followRule = sql.indexOf('FROM "Follow" fv');
      const order = sql.indexOf('ORDER BY p."createdAt" DESC');
      expect(candidates).toBeGreaterThan(-1);
      expect(privateRule).toBeGreaterThan(candidates);
      expect(privateRule).toBeLessThan(order);
      expect(followRule).toBeGreaterThan(candidates);
      expect(followRule).toBeLessThan(order);
      expect(sql).toContain('p."communityId" IS NOT NULL OR p."authorId" = ?');
    });

    it('keeps the campus-community guard, deleted-author and blocked-author filters', async () => {
      const { service, calls } = build(['blocked-1', 'blocked-2']);
      await service['buildRankedSession'](VIEWER);

      const { sql, values } = calls[0];
      const candidates = sql.slice(
        sql.indexOf('candidates AS ('),
        sql.indexOf('my_follows AS'),
      );
      expect(candidates).toContain('u."deletedAt" IS NULL');
      expect(candidates).toContain('c."deletedAt" IS NULL');
      expect(candidates).toContain('FROM "CommunityMember" cm');
      expect(candidates).toContain(
        'c."isCampusCommunity" = false OR COALESCE(c."collegeId" = (SELECT me."collegeId" FROM me), false)',
      );
      expect(candidates).toContain('p."authorId" NOT IN (?');
      expect(values).toEqual(
        expect.arrayContaining(['blocked-1', 'blocked-2']),
      );
    });

    it('keeps the window, the candidate limit and the ordering', async () => {
      const { service, calls } = build();
      const before = Date.now();
      await service['buildRankedSession'](VIEWER);
      const after = Date.now();

      const { sql, values } = calls[0];
      expect(sql).toContain('ORDER BY p."createdAt" DESC, p.id DESC LIMIT ?');
      expect(values).toContain(300);
      const since = values.find((v): v is Date => v instanceof Date);
      expect(since).toBeDefined();
      const week = 7 * 24 * 60 * 60 * 1000;
      expect(since!.getTime()).toBeGreaterThanOrEqual(before - week);
      expect(since!.getTime()).toBeLessThanOrEqual(after - week);
    });
  });

  describe('the score formula is unchanged', () => {
    it('keeps every weight and term, in order', async () => {
      const { service, calls } = build();
      await service['buildRankedSession'](VIEWER);

      const last = finalSelect(calls[0].sql);
      const terms = [
        '1.0 / power(EXTRACT(EPOCH FROM (now() - cd."createdAt")) / 3600.0 + 2, 1.5)',
        '1 + CASE WHEN mf."followingId" IS NOT NULL THEN 3.0 ELSE 0 END',
        '+ CASE WHEN cd."communityId" IS NOT NULL THEN 1.5 ELSE 0 END',
        '+ CASE WHEN asg."sameCampus" THEN 1.0 ELSE 0 END',
        '+ 3.0 * COALESCE(ua."score", 0)',
        '+ 1.5 * LEAST(COALESCE(th."hits", 0), 2) / 2.0',
        '+ 1.0 * LEAST(asg."sharedInterests", 3) / 3.0',
        '+ LEAST(0.35 * ln(1 + cd."likeCount" + 2 * cd."commentCount"), 1.5)',
        ') * 100 AS "score"',
      ];
      let at = -1;
      for (const term of terms) {
        const next = last.indexOf(term, at + 1);
        expect(next).toBeGreaterThan(at);
        at = next;
      }
      expect(last).toContain(
        '(mf."followingId" IS NOT NULL) AS "followsAuthor"',
      );
      expect(last).toContain('(cd."authorId" = me.id) AS "isOwn"');
    });
  });
});
