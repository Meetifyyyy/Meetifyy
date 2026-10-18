import { Prisma } from '@prisma/client';
import {
  activeAffiliationCollegeIdSql,
  affiliatedToCollegeSql,
} from '../common/campus/campus-affiliation.sql';

/**
 * Search ranking. The rule for this surface is different from every other
 * ranked list in the app: the viewer typed something specific, so how well a
 * result MATCHES what they typed decides its place, and who they are only
 * breaks ties within a match tier.
 *
 * That is enforced numerically. Each tier is at least `TIER_GAP` above the
 * next, and the personal signals together are capped below it, so no amount
 * of "you follow them" can lift a contains-match above a prefix-match.
 *
 * Ranking happens in SQL, before the LIMIT. The previous implementation
 * fetched the newest N rows that merely contained the text and ranked those in
 * JavaScript, so an exact username match older than N newer partial matches
 * was never fetched at all.
 */

export const TIER = {
  exact: 200,
  prefix: 150,
  contains: 100,
  secondary: 75,
  body: 25,
} as const;

/** Smallest gap between adjacent tiers; the personal score stays below it. */
export const TIER_GAP = 25;
export const PERSONAL_CAP = 24;

/** Candidates scored per query. Tiers are applied first, so this keeps the
 *  best text matches, and the personal joins run over this many rows at most. */
const CANDIDATES = 200;

/** Escapes LIKE metacharacters so a typed `%` or `_` matches itself. Prisma's
 *  `contains` does this; raw SQL has to do it by hand. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface UserSearchRow {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  bio: string | null;
  isCampusRep: boolean;
  collegeId: string | null;
  collegeName: string | null;
  isFollowing: boolean;
  score: number;
}

export interface CommunitySearchRow {
  id: string;
  name: string;
  slug: string;
  avatarKey: string | null;
  description: string | null;
  memberCount: number;
  isPrivate: boolean;
  score: number;
}

/**
 * People matching `query`. Tiers: exact username or display name; prefix of
 * either, or of any word in the display name ("sha" finds "Asha Sharma");
 * contained in either; contained only in the bio (when `includeBio`).
 *
 * Ties break on: you follow them, they follow you, mutual follows, same
 * college (both hold an active affiliation to it), recently active. Unavailable accounts — deleted, suspended,
 * blocked either way, and the viewer — never match.
 */
export function userSearchSql(opts: {
  query: string;
  viewerId: string | null;
  excludedIds: string[];
  includeBio: boolean;
  take: number;
}): Prisma.Sql {
  const q = opts.query.toLowerCase();
  const contains = `%${escapeLike(q)}%`;
  const prefix = `${escapeLike(q)}%`;
  const wordPrefix = `% ${escapeLike(q)}%`;
  const viewer = opts.viewerId ?? '';
  return Prisma.sql`
    WITH me AS (
      -- The viewer's campus is their ACTIVE affiliation, not the
      -- User.collegeId mirror (legacy rows the backfill skipped keep it).
      SELECT mu."id",
        ${activeAffiliationCollegeIdSql(Prisma.raw('mu."id"'))} AS "collegeId"
      FROM "User" mu WHERE mu."id" = ${viewer}
    ),
    candidates AS (
      SELECT u."id",
        CASE
          WHEN lower(u."username") = ${q} OR lower(u."displayName") = ${q}
            THEN ${TIER.exact}
          WHEN lower(u."username") LIKE ${prefix}
            OR lower(u."displayName") LIKE ${prefix}
            OR lower(u."displayName") LIKE ${wordPrefix}
            THEN ${TIER.prefix}
          WHEN lower(u."username") LIKE ${contains}
            OR lower(u."displayName") LIKE ${contains}
            THEN ${TIER.contains}
          ELSE ${TIER.body}
        END AS "tier"
      FROM "User" u
      WHERE u."deletedAt" IS NULL
        AND u."accountStatus" = 'ACTIVE'
        AND (
          u."username" ILIKE ${contains}
          OR u."displayName" ILIKE ${contains}
          ${opts.includeBio ? Prisma.sql`OR u."bio" ILIKE ${contains}` : Prisma.empty}
        )
        ${opts.excludedIds.length > 0 ? Prisma.sql`AND u."id" NOT IN (${Prisma.join(opts.excludedIds)})` : Prisma.empty}
      ORDER BY "tier" DESC, lower(u."username")
      LIMIT ${CANDIDATES}
    )
    SELECT
      u."id", u."username", u."displayName", u."avatar", u."bio",
      u."isCampusRep", u."collegeId", col."name" AS "collegeName",
      EXISTS (
        SELECT 1 FROM "Follow" f, me
        WHERE f."followerId" = me."id" AND f."followingId" = u."id"
      ) AS "isFollowing",
      (
        c."tier" + LEAST(${PERSONAL_CAP},
          CASE WHEN EXISTS (
            SELECT 1 FROM "Follow" f, me
            WHERE f."followerId" = me."id" AND f."followingId" = u."id"
          ) THEN 7 ELSE 0 END
          + CASE WHEN EXISTS (
            SELECT 1 FROM "Follow" f, me
            WHERE f."followerId" = u."id" AND f."followingId" = me."id"
          ) THEN 5 ELSE 0 END
          + LEAST(6, 3 * ln(1 + (
            SELECT COUNT(*) FROM "Follow" f1
            JOIN "Follow" f2 ON f2."followerId" = f1."followingId"
            CROSS JOIN me
            WHERE f1."followerId" = me."id" AND f2."followingId" = u."id"
          )))
          + CASE WHEN EXISTS (
            SELECT 1 FROM me
            WHERE me."collegeId" IS NOT NULL
              AND ${affiliatedToCollegeSql(Prisma.raw('u."id"'), Prisma.raw('me."collegeId"'))}
          ) THEN 4 ELSE 0 END
          + CASE WHEN u."lastSeenAt" > now() - interval '7 days' THEN 1 ELSE 0 END
        )
      )::float AS "score"
    FROM candidates c
    JOIN "User" u ON u."id" = c."id"
    LEFT JOIN "College" col ON col."id" = u."collegeId"
    ORDER BY "score" DESC, lower(u."username")
    LIMIT ${opts.take}
  `;
}

/**
 * Communities matching `query`. Tiers: exact name; name prefix or a word in
 * it; name contains; slug contains; description only.
 *
 * Ties break on: the viewer is a member (search is often navigation), friends
 * in it, posts in the last 14 days, size. Another college's campus-only
 * community never matches — it is hidden everywhere else too.
 */
export function communitySearchSql(opts: {
  query: string;
  viewerId: string | null;
  includeDescription: boolean;
  take: number;
}): Prisma.Sql {
  const q = opts.query.toLowerCase();
  const contains = `%${escapeLike(q)}%`;
  const prefix = `${escapeLike(q)}%`;
  const wordPrefix = `% ${escapeLike(q)}%`;
  const viewer = opts.viewerId ?? '';
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  return Prisma.sql`
    WITH me AS (
      -- The viewer's campus is their ACTIVE affiliation, not the
      -- User.collegeId mirror (legacy rows the backfill skipped keep it).
      SELECT mu."id",
        ${activeAffiliationCollegeIdSql(Prisma.raw('mu."id"'))} AS "collegeId"
      FROM "User" mu WHERE mu."id" = ${viewer}
    ),
    candidates AS (
      SELECT c."id",
        CASE
          WHEN lower(c."name") = ${q} THEN ${TIER.exact}
          WHEN lower(c."name") LIKE ${prefix} OR lower(c."name") LIKE ${wordPrefix}
            THEN ${TIER.prefix}
          WHEN lower(c."name") LIKE ${contains} THEN ${TIER.contains}
          WHEN lower(c."slug") LIKE ${contains} THEN ${TIER.secondary}
          ELSE ${TIER.body}
        END AS "tier"
      FROM "Community" c
      LEFT JOIN me ON true
      WHERE c."deletedAt" IS NULL
        AND (c."isCampusCommunity" = false OR c."collegeId" = me."collegeId")
        AND (
          c."name" ILIKE ${contains}
          OR c."slug" ILIKE ${contains}
          ${opts.includeDescription ? Prisma.sql`OR c."description" ILIKE ${contains}` : Prisma.empty}
        )
      ORDER BY "tier" DESC, c."memberCount" DESC
      LIMIT ${CANDIDATES}
    )
    SELECT
      c."id", c."name", c."slug", c."avatarKey", c."description",
      c."memberCount", c."isPrivate",
      (
        k."tier" + LEAST(${PERSONAL_CAP},
          CASE WHEN EXISTS (
            SELECT 1 FROM "CommunityMember" cm, me
            WHERE cm."communityId" = c."id" AND cm."userId" = me."id"
          ) THEN 5 ELSE 0 END
          + LEAST(6, 3 * ln(1 + (
            SELECT COUNT(*) FROM "Follow" f
            JOIN "CommunityMember" cm ON cm."userId" = f."followingId"
            CROSS JOIN me
            WHERE f."followerId" = me."id" AND cm."communityId" = c."id"
          )))
          + LEAST(4, 1.5 * ln(1 + (
            SELECT COUNT(*) FROM "Post" p
            WHERE p."communityId" = c."id" AND p."deletedAt" IS NULL
              AND p."createdAt" >= ${since}
          )))
          + LEAST(4, 0.5 * ln(1 + c."memberCount"))
        )
      )::float AS "score"
    FROM candidates k
    JOIN "Community" c ON c."id" = k."id"
    ORDER BY "score" DESC, c."memberCount" DESC, c."id"
    LIMIT ${opts.take}
  `;
}
