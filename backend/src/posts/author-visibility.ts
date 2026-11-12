import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * The one rule for a private account's own posts, next to the community rule
 * in `community-visibility.ts`.
 *
 * A user with `UserSettings.privateProfile = true` shares their posts only
 * with themselves and with the people who FOLLOW them (a `Follow` row from the
 * viewer to the author). A pending `FollowRequest` grants nothing: until the
 * author accepts, the requester is a stranger.
 *
 * The rule covers an author's OWN posts only (`communityId IS NULL`). A post
 * made inside a community stays governed by that community's rules, which
 * already decide who may read it, so it is never hidden here.
 *
 * It exists in several forms because the callers read posts several ways; they
 * all state the same condition:
 *  - `authorVisibilitySql`    raw SQL feeds (ranked and chronological home feed,
 *                             trending);
 *  - `authorVisibilityWhere`  Prisma `where` (profile posts, search, bookmarks,
 *                             post detail, comments, the realtime room, link
 *                             previews), which refuses inside the query the
 *                             caller already runs, so it costs no round trip;
 *  - `canSeeAuthorPosts`      one small query, for routes that already hold a
 *                             post and only need a yes or no;
 *  - `accountContentVisibleTo` the decision on an account row already loaded
 *                             (`authorPrivacySelect`), also used for follower
 *                             and following lists;
 *  - `authorAudienceAmong`    which of a set of users may see the author's
 *                             posts, for deciding who to notify.
 */

/**
 * SQL form, for a query that has the post as `<postAlias>`. A boolean
 * expression to AND into the WHERE clause.
 *
 * Written as `EXISTS` / `NOT EXISTS` rather than a `LEFT JOIN "UserSettings"`:
 * the feeds are already large multi-join statements, a join would have to be
 * added to each one's FROM (and could multiply rows if the unique index on
 * `userId` ever went), whereas a subquery is self-contained and a probe on
 * `UserSettings_userId_key` / the `Follow` primary key. The cheap tests come
 * first so the common rows (community posts, the viewer's own, public authors
 * with a settings row that is not private) never reach the Follow probe.
 *
 * A missing settings row is a public author, as everywhere else in the app.
 * With no viewer only the public authors' posts (and community posts, which
 * their own rules gate) pass.
 */
export function authorVisibilitySql(
  viewerId: string | undefined,
  postAlias = 'p',
): Prisma.Sql {
  // The alias is interpolated as an identifier, never a value: refuse anything
  // that is not a plain one, so a caller cannot smuggle SQL through it.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(postAlias)) {
    throw new Error(`Invalid SQL alias: ${postAlias}`);
  }
  const post = Prisma.raw(postAlias);
  const notPrivate = Prisma.sql`NOT EXISTS (
    SELECT 1 FROM "UserSettings" us
    WHERE us."userId" = ${post}."authorId" AND us."privateProfile" = true
  )`;
  if (!viewerId) {
    return Prisma.sql`(${post}."communityId" IS NOT NULL OR ${notPrivate})`;
  }
  return Prisma.sql`(
    ${post}."communityId" IS NOT NULL
    OR ${post}."authorId" = ${viewerId}
    OR ${notPrivate}
    OR EXISTS (
      SELECT 1 FROM "Follow" fv
      WHERE fv."followerId" = ${viewerId} AND fv."followingId" = ${post}."authorId"
    )
  )`;
}

/**
 * Prisma `where` form of the same condition, to put inside an `AND: [...]`
 * (it is an `OR` at the top level, so it must not be spread next to another
 * `OR`).
 */
export function authorVisibilityWhere(
  viewerId: string | undefined,
): Prisma.PostWhereInput {
  return {
    OR: [
      { communityId: { not: null } },
      ...(viewerId ? [{ authorId: viewerId }] : []),
      {
        author: {
          OR: [
            { settings: { is: null } },
            { settings: { is: { privateProfile: false } } },
            ...(viewerId
              ? [{ followers: { some: { followerId: viewerId } } }]
              : []),
          ],
        },
      },
    ],
  };
}

/** What `accountContentVisibleTo` needs from an author row. */
export interface AuthorPrivacyFields {
  settings?: { privateProfile: boolean } | null;
  /** The viewer's own follow row, if any (at most one is needed). */
  followers?: Array<{ followerId: string }>;
}

/**
 * The author's privacy fields plus the viewer's own follow row, selected on
 * `User`. An absent viewer matches nothing, as `communityAccessSelect` does.
 */
export function authorPrivacySelect(viewerId: string | undefined) {
  return {
    settings: { select: { privateProfile: true } },
    followers: {
      where: { followerId: viewerId || '' },
      select: { followerId: true },
      take: 1,
    },
  } satisfies Prisma.UserSelect;
}

/**
 * The decision on an account row loaded with `authorPrivacySelect`. Not only
 * for posts: a private account's follower and following lists follow the same
 * audience (themselves and their followers).
 */
export function accountContentVisibleTo(
  viewerId: string | undefined,
  authorId: string,
  author: AuthorPrivacyFields,
): boolean {
  if (viewerId && viewerId === authorId) return true;
  if (!author.settings?.privateProfile) return true;
  return !!viewerId && (author.followers?.length ?? 0) > 0;
}

/**
 * May `viewerId` see `authorId`'s own (non-community) posts? One statement:
 * the author's setting and the viewer's follow row come back together (the
 * schema enables `relationJoins`). A viewer reading their own posts needs no
 * query; an author who cannot be found is refused, so the answer fails closed.
 */
export async function canSeeAuthorPosts(
  viewerId: string | undefined,
  authorId: string,
  prisma: Pick<PrismaService, 'user'>,
): Promise<boolean> {
  if (viewerId && viewerId === authorId) return true;
  const author = await prisma.user.findUnique({
    where: { id: authorId },
    select: authorPrivacySelect(viewerId),
  });
  if (!author) return false;
  return accountContentVisibleTo(viewerId, authorId, author);
}

/**
 * Which of `userIds` may see `authorId`'s own posts? For deciding who to
 * notify about a post (or a comment under it) that a stranger could not open.
 * One statement: the author's setting and the follow rows of exactly these
 * users come back together. A public author's audience is everyone; an author
 * who cannot be found has none.
 */
export async function authorAudienceAmong(
  authorId: string,
  userIds: string[],
  prisma: Pick<PrismaService, 'user'>,
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const author = await prisma.user.findUnique({
    where: { id: authorId },
    select: {
      settings: { select: { privateProfile: true } },
      followers: {
        where: { followerId: { in: userIds } },
        select: { followerId: true },
      },
    },
  });
  if (!author) return [];
  if (!author.settings?.privateProfile) return userIds;
  const followers = new Set(author.followers.map((f) => f.followerId));
  return userIds.filter((id) => id === authorId || followers.has(id));
}
