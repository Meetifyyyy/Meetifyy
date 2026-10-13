import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export interface TrendingTag {
  name: string;
  /** Posts using it inside the trending window. */
  posts: number;
  /** Distinct people who used it inside the window. */
  authors: number;
}

export interface TrendingResult {
  /** `campus` when the viewer's own college has enough activity, else
   *  `everywhere` (all colleges), so a quiet campus still sees something. */
  scope: 'campus' | 'everywhere';
  tags: TrendingTag[];
}

interface TrendingRow {
  name: string;
  posts: number;
  authors: number;
}

/** "Now" for trending. Long enough for a campus-sized audience to register. */
export const TRENDING_WINDOW_HOURS = 48;
/** The baseline a tag is compared against: its usual rate before the window. */
export const TRENDING_BASELINE_DAYS = 7;
/** A tag one person keeps posting is not a trend. Campuses are small, so the
 *  bar is lower there than across every college. */
export const MIN_AUTHORS_CAMPUS = 2;
export const MIN_AUTHORS_EVERYWHERE = 3;
const TOP = 10;
const CACHE_TTL_S = 15 * 60;

/**
 * What is rising on the viewer's campus.
 *
 *   score = posts_in_window / (usual_posts_per_window + 1) × ln(1 + authors)
 *
 * Rising, not merely popular: a tag used every week (#placements) has a high
 * baseline and scores low unless it spikes. The authors term rewards breadth,
 * and the minimum-authors rule keeps one person from manufacturing a trend.
 *
 * Only posts anyone on the campus could see count: public posts, and posts in
 * public communities (a campus-only one only for its own campus). Private
 * community content never leaks into the list.
 *
 * Computed on demand and cached per college for 15 minutes — one bounded
 * aggregate per campus per quarter hour, shared by everyone on it, with no
 * background job to keep alive.
 */
@Injectable()
export class TrendingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async forUser(userId: string): Promise<TrendingResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { collegeId: true },
    });
    const collegeId = user?.collegeId ?? null;
    if (collegeId) {
      const campus = await this.cached(collegeId);
      if (campus.length > 0) return { scope: 'campus', tags: campus };
    }
    return { scope: 'everywhere', tags: await this.cached(null) };
  }

  private async cached(collegeId: string | null): Promise<TrendingTag[]> {
    const redis = this.redisService.getClient();
    const key = `trending:v1:${collegeId ?? 'everywhere'}`;
    if (redis) {
      try {
        const hit = await redis.get(key);
        if (hit) return parseTags(hit);
      } catch {
        // Unreachable Redis is a cache miss.
      }
    }
    const tags = await this.compute(collegeId);
    if (redis) {
      // Fire-and-forget: a failed cache write only costs a recompute.
      void redis
        .set(key, JSON.stringify(tags), 'EX', CACHE_TTL_S)
        .catch(() => undefined);
    }
    return tags;
  }

  async compute(
    collegeId: string | null,
    now: Date = new Date(),
  ): Promise<TrendingTag[]> {
    const windowStart = new Date(
      now.getTime() - TRENDING_WINDOW_HOURS * 3_600_000,
    );
    const baselineStart = new Date(
      windowStart.getTime() - TRENDING_BASELINE_DAYS * 86_400_000,
    );
    const windowsInBaseline =
      (TRENDING_BASELINE_DAYS * 24) / TRENDING_WINDOW_HOURS;
    const minAuthors = collegeId ? MIN_AUTHORS_CAMPUS : MIN_AUTHORS_EVERYWHERE;
    const rows = await this.prisma.$queryRaw<TrendingRow[]>`
      WITH recent AS (
        SELECT p."id", p."authorId", p."createdAt"
        FROM "Post" p
        JOIN "User" u ON u."id" = p."authorId"
        LEFT JOIN "Community" c ON c."id" = p."communityId"
        WHERE p."deletedAt" IS NULL
          AND p."createdAt" >= ${baselineStart}
          AND p."createdAt" <= ${now}
          AND u."deletedAt" IS NULL
          AND u."accountStatus" = 'ACTIVE'
          AND (${collegeId}::text IS NULL OR u."collegeId" = ${collegeId})
          AND (
            p."communityId" IS NULL
            OR (
              c."deletedAt" IS NULL
              AND c."isPrivate" = false
              AND (c."isCampusCommunity" = false OR c."collegeId" = ${collegeId})
            )
          )
      ),
      counts AS (
        SELECT
          h."name",
          COUNT(DISTINCT r."id") FILTER (WHERE r."createdAt" >= ${windowStart})::int AS "posts",
          COUNT(DISTINCT r."authorId") FILTER (WHERE r."createdAt" >= ${windowStart})::int AS "authors",
          COUNT(DISTINCT r."id") FILTER (WHERE r."createdAt" < ${windowStart})::int AS "before"
        FROM recent r
        JOIN "PostHashtag" ph ON ph."postId" = r."id"
        JOIN "Hashtag" h ON h."id" = ph."hashtagId"
        GROUP BY h."name"
      )
      SELECT "name", "posts", "authors"
      FROM counts
      WHERE "authors" >= ${minAuthors}
      ORDER BY
        ("posts" / ("before" / ${windowsInBaseline}::float + 1)) * ln(1 + "authors") DESC,
        "posts" DESC,
        "name"
      LIMIT ${TOP}
    `;
    return rows.map((r) => ({
      name: r.name,
      posts: Number(r.posts),
      authors: Number(r.authors),
    }));
  }
}

function parseTags(raw: string): TrendingTag[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.flatMap((v: unknown) => {
      if (
        typeof v === 'object' &&
        v !== null &&
        'name' in v &&
        typeof v.name === 'string' &&
        'posts' in v &&
        typeof v.posts === 'number' &&
        'authors' in v &&
        typeof v.authors === 'number'
      ) {
        return [{ name: v.name, posts: v.posts, authors: v.authors }];
      }
      return [];
    });
  } catch {
    return [];
  }
}
