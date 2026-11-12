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
 * A campus community's posts reach only people whose ACTIVE affiliation is
 * that college. The membership row outlives a revoked or changed affiliation,
 * so both home feeds must check the affiliation themselves instead of
 * trusting the row.
 *
 * These tests read the SQL each feed sends. They prove the guard is present
 * and shaped to fail closed; what Postgres does with it is checked against a
 * real database, not here.
 */
describe('PostsService home feeds - campus communities', () => {
  type RawCall = { sql: string; values: unknown[] };

  let calls: RawCall[];
  let service: PostsService;

  // Whitespace and the padding inside brackets vary with how the query is laid
  // out, so match on the tokens only.
  const collapse = (sql: string) =>
    sql.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')');

  beforeEach(() => {
    calls = [];
    const queryRaw = jest.fn(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        // Prisma flattens nested fragments the same way when it runs a query.
        const built = Prisma.sql(strings, ...values);
        calls.push({ sql: collapse(built.sql), values: built.values });
        return Promise.resolve([]);
      },
    );
    service = new PostsService(
      stub<PrismaService>({ $queryRaw: queryRaw }),
      stub<NotificationsService>(),
      stub<NotificationFactory>(),
      stub<BlocksService>({
        getExcludedUserIds: jest.fn(() => Promise.resolve([])),
      }),
      stub<DomainEventService>(),
      stub<RedisService>(),
      stub<MentionsService>(),
      stub<StorageService>(),
      stub<ContentDeletionAuthorizer>(),
    );
  });

  describe('ranked feed', () => {
    it("admits a campus-community post only for the viewer's own college", async () => {
      await service['buildRankedSession']('viewer-1');

      expect(calls).toHaveLength(1);
      const { sql } = calls[0];
      // Taken from the `me` CTE, which already holds the active college, so
      // no second affiliation lookup is added to the query.
      expect(sql).toContain(
        'c."isCampusCommunity" = false OR COALESCE(c."collegeId" = (SELECT me."collegeId" FROM me), false)',
      );
      expect(sql).toContain('FROM "CollegeAffiliation" a');
    });

    it('keeps the guard inside the community branch, after the membership test', async () => {
      await service['buildRankedSession']('viewer-1');

      const { sql } = calls[0];
      const membership = sql.indexOf('FROM "CommunityMember" cm');
      const guard = sql.indexOf('c."isCampusCommunity" = false');
      const end = sql.indexOf('ORDER BY p."createdAt" DESC');
      expect(membership).toBeGreaterThan(-1);
      expect(guard).toBeGreaterThan(membership);
      expect(guard).toBeLessThan(end);
      // Personal posts (no community) are not subject to it.
      expect(sql).toContain('p."communityId" IS NULL OR (');
    });
  });

  describe('chronological feed', () => {
    it("admits a campus-community post only for the viewer's active college", async () => {
      await service.getChronologicalFeed('viewer-1', 10);

      expect(calls).toHaveLength(1);
      const { sql, values } = calls[0];
      expect(sql).toContain(
        'c."isCampusCommunity" = false OR COALESCE(c."collegeId" = (SELECT a."collegeId" FROM "CollegeAffiliation" a',
      );
      expect(sql).toContain('AND a."revokedAt" IS NULL');
      expect(sql).toContain('ac."status" = \'APPROVED\'');
      // The viewer is bound, never interpolated into the text.
      expect(values).toContain('viewer-1');
      expect(sql).not.toContain('viewer-1');
    });

    it('ends the guard in `false`, so a viewer with no active college is excluded', async () => {
      await service.getChronologicalFeed('viewer-1', 10);

      // `x = NULL` is NULL, not false: COALESCE is what turns "no college"
      // into a refusal rather than a post that slips through.
      expect(calls[0].sql).toMatch(
        /COALESCE\(c\."collegeId" = \(SELECT a\."collegeId"[^]*?\), false\)/,
      );
    });

    it('joins the community the guard reads', async () => {
      await service.getChronologicalFeed('viewer-1', 10);

      expect(calls[0].sql).toContain(
        'LEFT JOIN "Community" c ON p."communityId" = c.id',
      );
    });
  });
});
