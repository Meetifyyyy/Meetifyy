import { Prisma } from '@prisma/client';
import {
  accountContentVisibleTo,
  authorAudienceAmong,
  authorVisibilitySql,
  authorVisibilityWhere,
  canSeeAuthorPosts,
} from './author-visibility';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_AUTHOR, privateAuthor } from './testing/author-privacy.fake';
import type { AuthorPrivacyFields } from './author-visibility';

/**
 * A private account's own posts are for the account and its followers. The SQL
 * and `where` forms are asserted by shape here; what Postgres does with them
 * is checked against a real database, not in this file.
 */
describe('author visibility', () => {
  const collapse = (sql: string) => sql.replace(/\s+/g, ' ').trim();

  describe('SQL form', () => {
    const built = (viewer: string | undefined, alias?: string) =>
      Prisma.sql`SELECT 1 WHERE ${authorVisibilitySql(viewer, alias)}`;

    it('passes community posts, the viewer, public authors and the viewer’s follows', () => {
      const q = built('viewer-1');
      const sql = collapse(q.sql);
      expect(sql).toContain('p."communityId" IS NOT NULL');
      expect(sql).toContain('p."authorId" = ?');
      expect(sql).toContain(
        'NOT EXISTS ( SELECT 1 FROM "UserSettings" us WHERE us."userId" = p."authorId" AND us."privateProfile" = true )',
      );
      expect(sql).toContain(
        'EXISTS ( SELECT 1 FROM "Follow" fv WHERE fv."followerId" = ? AND fv."followingId" = p."authorId" )',
      );
      // A pending request is not a follow: the request table is not read.
      expect(sql).not.toContain('FollowRequest');
    });

    it('binds the viewer, never interpolates it', () => {
      const q = built('viewer-1');
      expect(q.values).toEqual(['viewer-1', 'viewer-1']);
      expect(q.sql).not.toContain('viewer-1');
    });

    it('with no viewer admits only community posts and public authors', () => {
      const q = built(undefined);
      const sql = collapse(q.sql);
      expect(q.values).toEqual([]);
      expect(sql).toContain('p."communityId" IS NOT NULL');
      expect(sql).toContain('NOT EXISTS ( SELECT 1 FROM "UserSettings" us');
      expect(sql).not.toContain('"Follow"');
      expect(sql).not.toContain('p."authorId" = ?');
    });

    it('uses the alias it is given', () => {
      const sql = collapse(built('v', 'post').sql);
      expect(sql).toContain('post."communityId" IS NOT NULL');
      expect(sql).toContain('us."userId" = post."authorId"');
    });

    it.each(['p; DROP TABLE "Post"', 'p"', '1p', '', 'a b'])(
      'refuses a non-identifier alias (%j)',
      (alias) => {
        expect(() => authorVisibilitySql('v', alias)).toThrow(
          /Invalid SQL alias/,
        );
      },
    );
  });

  describe('Prisma where form', () => {
    it('is community posts, the viewer’s own, public authors, or authors the viewer follows', () => {
      expect(authorVisibilityWhere('viewer-1')).toEqual({
        OR: [
          { communityId: { not: null } },
          { authorId: 'viewer-1' },
          {
            author: {
              OR: [
                { settings: { is: null } },
                { settings: { is: { privateProfile: false } } },
                { followers: { some: { followerId: 'viewer-1' } } },
              ],
            },
          },
        ],
      });
    });

    it('with no viewer drops the viewer and follow branches', () => {
      expect(authorVisibilityWhere(undefined)).toEqual({
        OR: [
          { communityId: { not: null } },
          {
            author: {
              OR: [
                { settings: { is: null } },
                { settings: { is: { privateProfile: false } } },
              ],
            },
          },
        ],
      });
      // An empty id (how a missing viewer sometimes arrives) is no viewer.
      expect(authorVisibilityWhere('')).toEqual(
        authorVisibilityWhere(undefined),
      );
    });
  });

  describe('accountContentVisibleTo', () => {
    const decide = (viewer: string | undefined, row: AuthorPrivacyFields) =>
      accountContentVisibleTo(viewer, 'author', row);

    it('shows a public account to everyone, signed in or not', () => {
      expect(decide('stranger', PUBLIC_AUTHOR)).toBe(true);
      expect(decide(undefined, PUBLIC_AUTHOR)).toBe(true);
      expect(decide('stranger', { settings: { privateProfile: false } })).toBe(
        true,
      );
    });

    it('shows a private account to itself and its followers only', () => {
      expect(decide('author', privateAuthor())).toBe(true);
      expect(decide('fan', privateAuthor(['fan']))).toBe(true);
      expect(decide('stranger', privateAuthor())).toBe(false);
      expect(decide(undefined, privateAuthor())).toBe(false);
      // An anonymous caller never counts as anyone's follower.
      expect(decide(undefined, privateAuthor(['fan']))).toBe(false);
    });
  });

  describe('canSeeAuthorPosts', () => {
    const lookup = (row: AuthorPrivacyFields | null) => {
      const findUnique = jest.fn((_args: unknown) => Promise.resolve(row));
      return {
        findUnique,
        prisma: stub<PrismaService>({ user: { findUnique } }),
      };
    };

    it('asks once, for the author’s setting and the viewer’s follow row together', async () => {
      const { findUnique, prisma } = lookup(privateAuthor());
      await canSeeAuthorPosts('viewer', 'author', prisma);
      expect(findUnique).toHaveBeenCalledTimes(1);
      expect(findUnique).toHaveBeenCalledWith({
        where: { id: 'author' },
        select: {
          settings: { select: { privateProfile: true } },
          followers: {
            where: { followerId: 'viewer' },
            select: { followerId: true },
            take: 1,
          },
        },
      });
    });

    it('hides a private author from a stranger', async () => {
      const { prisma } = lookup(privateAuthor());
      expect(await canSeeAuthorPosts('stranger', 'author', prisma)).toBe(false);
    });

    it('hides a private author from a pending requester (only a Follow row counts)', async () => {
      // A pending request leaves no follow row, which is all the lookup reads.
      const { prisma } = lookup(privateAuthor([]));
      expect(await canSeeAuthorPosts('requester', 'author', prisma)).toBe(
        false,
      );
    });

    it('shows a private author to a follower', async () => {
      const { prisma } = lookup(privateAuthor(['fan']));
      expect(await canSeeAuthorPosts('fan', 'author', prisma)).toBe(true);
    });

    it('shows a private author to themselves without a query', async () => {
      const { findUnique, prisma } = lookup(privateAuthor());
      expect(await canSeeAuthorPosts('author', 'author', prisma)).toBe(true);
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('shows a public author to a stranger and to a signed-out reader', async () => {
      const { prisma } = lookup(PUBLIC_AUTHOR);
      expect(await canSeeAuthorPosts('stranger', 'author', prisma)).toBe(true);
      expect(await canSeeAuthorPosts(undefined, 'author', prisma)).toBe(true);
    });

    it('hides a private author from a signed-out reader', async () => {
      const { prisma } = lookup(privateAuthor());
      expect(await canSeeAuthorPosts(undefined, 'author', prisma)).toBe(false);
    });

    it('refuses an author who cannot be found', async () => {
      const { prisma } = lookup(null);
      expect(await canSeeAuthorPosts('viewer', 'ghost', prisma)).toBe(false);
    });
  });

  describe('authorAudienceAmong', () => {
    const lookup = (row: AuthorPrivacyFields | null) => {
      const findUnique = jest.fn((_args: unknown) => Promise.resolve(row));
      return {
        findUnique,
        prisma: stub<PrismaService>({ user: { findUnique } }),
      };
    };

    it('is everyone for a public author', async () => {
      const { prisma } = lookup(PUBLIC_AUTHOR);
      expect(await authorAudienceAmong('author', ['a', 'b'], prisma)).toEqual([
        'a',
        'b',
      ]);
    });

    it('is only the followers among them for a private author', async () => {
      const { findUnique, prisma } = lookup(privateAuthor(['a']));
      expect(await authorAudienceAmong('author', ['a', 'b'], prisma)).toEqual([
        'a',
      ]);
      expect(findUnique).toHaveBeenCalledTimes(1);
      expect(findUnique.mock.calls[0][0]).toMatchObject({
        select: {
          followers: {
            where: { followerId: { in: ['a', 'b'] } },
            select: { followerId: true },
          },
        },
      });
    });

    it('has no one for an author who cannot be found, and asks nothing for no one', async () => {
      const gone = lookup(null);
      expect(await authorAudienceAmong('ghost', ['a'], gone.prisma)).toEqual(
        [],
      );
      const none = lookup(PUBLIC_AUTHOR);
      expect(await authorAudienceAmong('author', [], none.prisma)).toEqual([]);
      expect(none.findUnique).not.toHaveBeenCalled();
    });
  });
});
