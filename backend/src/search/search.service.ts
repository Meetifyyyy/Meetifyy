import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityVisibility } from '@prisma/client';
import { BlocksService } from '../users/blocks.service';
import { RedisService } from '../redis/redis.service';

/** How long (seconds) search results are cached per (query, userId) pair. */
const SEARCH_CACHE_TTL = 15;

@Injectable()
export class SearchService {
  private readonly logger = new Logger('SEARCH');
  private readonly redis: ReturnType<RedisService['getClient']>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly blocksService: BlocksService,
    @Optional() private readonly redisService?: RedisService,
  ) {
    this.redis = this.redisService?.getClient() ?? null;
  }

  async globalSearch(query: string, currentUserId?: string, limit = 10) {
    if (!query || query.trim().length < 2) {
      return { users: [], communities: [], posts: [], activities: [] };
    }

    const searchQuery = query.trim();
    const cacheKey = `search:${searchQuery.toLowerCase()}:${currentUserId ?? 'anon'}:${limit}`;

    // 1. Cache read — return instantly if a recent identical query is cached
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          this.logger.debug(`Cache hit: "${searchQuery}"`);
          return JSON.parse(cached);
        }
      } catch {
        // Redis unavailable — fall through to DB
      }
    }

    const [excludedUserIds, currentUser] = await Promise.all([
      currentUserId ? this.blocksService.getExcludedUserIds(currentUserId) : Promise.resolve([]),
      currentUserId ? this.prisma.user.findUnique({ where: { id: currentUserId }, select: { collegeId: true } }) : Promise.resolve(null),
    ]);
    const searchExcludedUserIds = currentUserId ? [...excludedUserIds, currentUserId] : excludedUserIds;
    const startTime = performance.now();

    const [users, communities, rawPosts, activities] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          OR: [
            { username: { contains: searchQuery, mode: 'insensitive' } },
            { displayName: { contains: searchQuery, mode: 'insensitive' } }
          ],
          deletedAt: null,
          ...(searchExcludedUserIds.length > 0 ? { id: { notIn: searchExcludedUserIds } } : {})
        },
        select: {
          id: true,
          username: true,
          displayName: true,
          avatar: true,
          bio: true,
        },
        take: limit,
      }),
      this.prisma.community.findMany({
        where: {
          OR: [
            { name: { contains: searchQuery, mode: 'insensitive' } },
            { slug: { contains: searchQuery, mode: 'insensitive' } },
            { description: { contains: searchQuery, mode: 'insensitive' } }
          ],
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          avatarKey: true,
          description: true,
          memberCount: true,
        },
        take: limit,
      }),
      this.prisma.post.findMany({
        where: {
          deletedAt: null,
          text: { contains: searchQuery, mode: 'insensitive' },
          authorId: { notIn: excludedUserIds },
        },
        select: {
          id: true, text: true, createdAt: true, likeCount: true, commentCount: true,
          author: { select: { id: true, username: true, displayName: true, avatar: true } },
        },
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.crewActivity.findMany({
        where: {
          status: 'OPEN',
          deletedAt: null,
          creatorId: { notIn: excludedUserIds },
          OR: [
            { title: { contains: searchQuery, mode: 'insensitive' } },
            { description: { contains: searchQuery, mode: 'insensitive' } },
          ],
          AND: [
            {
              OR: [
                { visibility: ActivityVisibility.PUBLIC },
                ...(currentUser?.collegeId ? [
                  { visibility: ActivityVisibility.COLLEGE_ONLY, collegeId: currentUser.collegeId },
                  { shareToCampus: true, collegeId: currentUser.collegeId }
                ] : [])
              ]
            }
          ]
        },
        select: {
          id: true, title: true, description: true, location: true, startDate: true, maxMembers: true,
          creator: { select: { id: true, username: true, displayName: true, avatar: true } },
        },
        take: limit,
      }),
    ]);

    const searchPostIds = rawPosts.map(p => p.id);
    const [userLikes, userBookmarks] = await Promise.all([
      currentUserId && searchPostIds.length > 0
        ? this.prisma.postLike.findMany({ where: { userId: currentUserId, postId: { in: searchPostIds } }, select: { postId: true } })
        : [],
      currentUserId && searchPostIds.length > 0
        ? this.prisma.postBookmark.findMany({ where: { userId: currentUserId, postId: { in: searchPostIds } }, select: { postId: true } })
        : [],
    ]);

    const likedSet = new Set(userLikes.map(l => l.postId));
    const bookmarkedSet = new Set(userBookmarks.map(b => b.postId));

    const posts = rawPosts.map(p => {
      const isLiked = likedSet.has(p.id);
      const isBookmarked = bookmarkedSet.has(p.id);
      return {
        ...p,
        hasLiked: isLiked,
        isLiked,
        isLikedByMe: isLiked,
        hasBookmarked: isBookmarked,
        isBookmarked,
        likesCount: p.likeCount ?? 0,
        commentsCount: p.commentCount ?? 0,
      };
    });

    const totalResults = users.length + communities.length + posts.length + activities.length;
    const duration = (performance.now() - startTime).toFixed(0);
    this.logger.log(`"${searchQuery}" ${totalResults} results (${duration}ms)`);

    const result = { users, communities, posts, activities };

    // 2. Cache write — store for 15s so rapid/repeated identical queries skip the DB
    if (this.redis) {
      try {
        await this.redis.setex(cacheKey, SEARCH_CACHE_TTL, JSON.stringify(result));
      } catch {
        // Non-fatal
      }
    }

    return result;
  }
}
