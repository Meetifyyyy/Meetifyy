import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { BlocksService } from '../users/blocks.service';
import { RedisService } from '../redis/redis.service';
import { ActivityAuthorizationService } from '../activities/activity-authorization.service';

/** How long (seconds) search results are cached per (query, userId) pair. */
const SEARCH_CACHE_TTL = 15;
/** How long (seconds) typeahead suggestions are cached — short since results are small and per-keystroke. */
const SUGGESTIONS_CACHE_TTL = 10;

interface SearchCursor {
  /** `${createdAt ISO}__${id}` for posts (ordered createdAt desc). */
  p?: string;
  /** `${startDate ISO}__${id}` for activities (ordered startDate asc). */
  a?: string;
}

function encodeCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(raw?: string): SearchCursor {
  if (!raw) return {};
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as SearchCursor;
  } catch {
    return {};
  }
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger('SEARCH');
  private readonly redis: ReturnType<RedisService['getClient']>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly blocksService: BlocksService,
    private readonly activityPolicy: ActivityAuthorizationService,
    @Optional() private readonly redisService?: RedisService,
  ) {
    this.redis = this.redisService?.getClient() ?? null;
  }

  /** Trusted viewer context (id + collegeId) straight from the database. */
  private async resolveViewer(userId?: string) {
    if (!userId) return null;
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, collegeId: true },
    });
    return u ? { id: u.id, collegeId: u.collegeId } : null;
  }

  async globalSearch(query?: string, currentUserId?: string, limit = 15, type?: string, cursorParam?: string) {
    const searchQuery = (query || '').trim();
    const cleanQuery = searchQuery.toLowerCase();
    const isDiscovery = searchQuery.length === 0;
    const now = new Date();
    const cursor = decodeCursor(cursorParam);
    const isPaginating = Boolean(cursor.p || cursor.a);

    const cacheKey = `search:${cleanQuery || 'discovery'}:${type || 'all'}:${currentUserId ?? 'anon'}:${limit}:${cursorParam || 'first'}`;

    // 1. Cache read
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          this.logger.debug(`Cache hit: "${searchQuery || 'discovery'}"`);
          return JSON.parse(cached);
        }
      } catch {
        // Redis unavailable — fall through to DB
      }
    }

    let postCursorDate: Date | undefined;
    let postCursorId: string | undefined;
    if (cursor.p) {
      const [dateStr, id] = cursor.p.split('__');
      if (dateStr && id) {
        postCursorDate = new Date(dateStr);
        postCursorId = id;
      }
    }

    let activityCursorDate: Date | undefined;
    let activityCursorId: string | undefined;
    if (cursor.a) {
      const [dateStr, id] = cursor.a.split('__');
      if (dateStr && id) {
        activityCursorDate = new Date(dateStr);
        activityCursorId = id;
      }
    }

    const [excludedUserIds, viewer] = await Promise.all([
      currentUserId ? this.blocksService.getExcludedUserIds(currentUserId) : Promise.resolve([]),
      this.resolveViewer(currentUserId),
    ]);
    const searchExcludedUserIds = currentUserId ? [...excludedUserIds, currentUserId] : excludedUserIds;
    const startTime = performance.now();

    // Users/communities aren't paginated (small, relevance-capped lists) — only re-fetched on the first page.
    const fetchUsers = !isPaginating && (!type || type === 'all' || type === 'people' || type === 'users');
    const fetchCommunities = !isPaginating && (!type || type === 'all' || type === 'communities');
    const fetchPosts = !type || type === 'all' || type === 'posts';
    const fetchActivities = !type || type === 'all' || type === 'activities';
    const postFetchLimit = (isDiscovery ? 6 : limit) + 1;
    const activityFetchLimit = (isDiscovery ? 6 : limit) + 1;

    const postAndConditions: Prisma.PostWhereInput[] = [
      {
        OR: [
          { communityId: null },
          { community: { is: { isPrivate: false } } },
          ...(currentUserId ? [{ community: { is: { members: { some: { userId: currentUserId } } } } }] : []),
        ],
      },
      ...(postCursorDate && postCursorId
        ? [{
            OR: [
              { createdAt: { lt: postCursorDate } },
              { createdAt: postCursorDate, id: { lt: postCursorId } },
            ],
          } as Prisma.PostWhereInput]
        : []),
    ];

    const activityAndConditions: Prisma.CrewActivityWhereInput[] = [
      // Search is a discovery surface: restricted activities are excluded by the
      // shared policy at the query layer, never fetched-then-filtered.
      this.activityPolicy.discoveryWhere(viewer),
      {
        OR: [
          { endDate: null },
          { endDate: { gte: now } },
        ],
      },
      ...(isDiscovery
        ? []
        : [{
            OR: [
              { title: { contains: searchQuery, mode: 'insensitive' as Prisma.QueryMode } },
              { description: { contains: searchQuery, mode: 'insensitive' as Prisma.QueryMode } },
              { location: { contains: searchQuery, mode: 'insensitive' as Prisma.QueryMode } },
            ],
          } as Prisma.CrewActivityWhereInput]),
      ...(activityCursorDate && activityCursorId
        ? [{
            OR: [
              { startDate: { gt: activityCursorDate } },
              { startDate: activityCursorDate, id: { gt: activityCursorId } },
            ],
          } as Prisma.CrewActivityWhereInput]
        : []),
    ];

    const [users, communities, rawPostsPage, activitiesPage] = await Promise.all([
      fetchUsers
        ? this.prisma.user.findMany({
            where: {
              ...(isDiscovery
                ? {}
                : {
                    OR: [
                      { username: { contains: searchQuery, mode: 'insensitive' } },
                      { displayName: { contains: searchQuery, mode: 'insensitive' } },
                      { bio: { contains: searchQuery, mode: 'insensitive' } },
                    ],
                  }),
              deletedAt: null,
              ...(searchExcludedUserIds.length > 0 ? { id: { notIn: searchExcludedUserIds } } : {}),
            },
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
              bio: true,
              isCampusRep: true,
              collegeId: true,
              college: { select: { id: true, name: true } },
              followers: { select: { followerId: true } },
            },
            take: isDiscovery ? 6 : limit * 2,
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),

      fetchCommunities
        ? this.prisma.community.findMany({
            where: {
              ...(isDiscovery
                ? {}
                : {
                    OR: [
                      { name: { contains: searchQuery, mode: 'insensitive' } },
                      { slug: { contains: searchQuery, mode: 'insensitive' } },
                      { description: { contains: searchQuery, mode: 'insensitive' } },
                    ],
                  }),
              deletedAt: null,
            },
            select: {
              id: true,
              name: true,
              slug: true,
              avatarKey: true,
              description: true,
              memberCount: true,
              isPrivate: true,
            },
            take: isDiscovery ? 6 : limit * 2,
            orderBy: { memberCount: 'desc' },
          })
        : Promise.resolve([]),

      // Main feed posts: public posts or public community posts
      fetchPosts
        ? this.prisma.post.findMany({
            where: {
              deletedAt: null,
              ...(isDiscovery ? {} : { text: { contains: searchQuery, mode: 'insensitive' as Prisma.QueryMode } }),
              ...(searchExcludedUserIds.length > 0 ? { authorId: { notIn: searchExcludedUserIds } } : {}),
              AND: postAndConditions,
            },
            select: {
              id: true,
              text: true,
              createdAt: true,
              likeCount: true,
              commentCount: true,
              author: { select: { id: true, username: true, displayName: true, avatar: true, isCampusRep: true, collegeId: true, college: { select: { id: true, name: true } } } },
              media: {
                orderBy: [{ order: 'asc' }, { id: 'asc' }],
                select: {
                  id: true,
                  objectKey: true,
                  width: true,
                  height: true,
                  mimeType: true,
                  type: true,
                },
              },
              pollOptions: {
                orderBy: { id: 'asc' },
                include: {
                  _count: { select: { votes: true } }
                }
              },
              pollVotes: currentUserId ? { where: { userId: currentUserId } } : false,
            },
            take: postFetchLimit,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          })
        : Promise.resolve([]),

      // Activities: set to visibility PUBLIC (visible to anyone) and haven't ended yet
      fetchActivities
        ? this.prisma.crewActivity.findMany({
            where: {
              status: 'OPEN',
              deletedAt: null,
              ...(searchExcludedUserIds.length > 0 ? { creatorId: { notIn: searchExcludedUserIds } } : {}),
              AND: activityAndConditions,
            },
            select: {
              id: true,
              title: true,
              description: true,
              location: true,
              startDate: true,
              endDate: true,
              createdAt: true,
              maxMembers: true,
              coverImage: true,
              coverColor: true,
              members: {
                select: {
                  userId: true,
                  user: { select: { id: true, username: true, displayName: true, avatar: true, isCampusRep: true, collegeId: true, college: { select: { id: true, name: true } } } },
                },
              },
              creator: { select: { id: true, username: true, displayName: true, avatar: true, isCampusRep: true, collegeId: true, college: { select: { id: true, name: true } } } },
            },
            take: activityFetchLimit,
            orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
          })
        : Promise.resolve([]),
    ]);

    let nextPostCursor: string | undefined;
    const rawPosts = [...rawPostsPage];
    if (rawPosts.length > postFetchLimit - 1) {
      const extra = rawPosts.pop();
      if (extra) nextPostCursor = `${new Date(extra.createdAt).toISOString()}__${extra.id}`;
    }

    let nextActivityCursor: string | undefined;
    const activities = [...activitiesPage];
    if (activities.length > activityFetchLimit - 1) {
      const extra = activities.pop();
      if (extra?.startDate) nextActivityCursor = `${new Date(extra.startDate).toISOString()}__${extra.id}`;
    }

    // Rank Users
    const rankedUsers = users
      .map(u => {
        const uName = u.username.toLowerCase();
        const dName = u.displayName.toLowerCase();
        let score = 0;
        if (!isDiscovery) {
          if (uName === cleanQuery || dName === cleanQuery) score += 100;
          else if (uName.startsWith(cleanQuery) || dName.startsWith(cleanQuery)) score += 50;
          else score += 10;
        }
        return { ...u, isFollowing: u.followers?.some(f => f.followerId === currentUserId) || false, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, isDiscovery ? 6 : limit);

    // Rank Communities
    const rankedCommunities = communities
      .map(c => {
        const name = c.name.toLowerCase();
        let score = 0;
        if (!isDiscovery) {
          if (name === cleanQuery) score += 100;
          else if (name.startsWith(cleanQuery)) score += 50;
          else score += 10;
        }
        return { ...c, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, isDiscovery ? 6 : limit);

    // Fetch Likes and Bookmarks for Posts
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

      const media = (p.media || []).map((m: any) => ({
        ...m,
        url: m.url || (m.objectKey ? `/api/media/${m.objectKey}` : null),
      }));

      const pollOptions = p.pollOptions || [];
      let poll = null;
      if (pollOptions.length > 0) {
        const sortedOptions = [...pollOptions].sort((a: any, b: any) => (a.id || '').localeCompare(b.id || ''));
        const options = sortedOptions.map((opt: any) => ({
          id: opt.id,
          text: opt.text,
          votes: Number(opt._count?.votes || opt.voteCount || 0),
        }));
        const totalVotes = options.reduce((sum: number, o: any) => sum + o.votes, 0);

        const userVotedOptionId = (Array.isArray(p.pollVotes) && p.pollVotes.length > 0) ? p.pollVotes[0]?.optionId : null;
        const userVotedIndex = userVotedOptionId ? options.findIndex((o: any) => o.id === userVotedOptionId) : -1;
        const myVotes = userVotedIndex >= 0 ? [userVotedIndex] : [];
        const selectedUsers = currentUserId && myVotes.length > 0 ? { [currentUserId]: myVotes } : {};

        poll = {
          question: p.text,
          options,
          totalVotes,
          userVotedOptionId: userVotedOptionId || undefined,
          votedOptionIndex: userVotedIndex >= 0 ? userVotedIndex : undefined,
          myVotes,
          selectedUsers,
        };
      }

      return {
        ...p,
        media,
        pollOptions,
        poll,
        hasLiked: isLiked,
        isLiked,
        isLikedByMe: isLiked,
        hasBookmarked: isBookmarked,
        isBookmarked,
        likesCount: p.likeCount ?? 0,
        commentsCount: p.commentCount ?? 0,
      };
    });

    const formattedActivities = activities.map(a => ({
      ...a,
      slotsFilled: a.members?.length || 1,
    }));

    const totalResults = rankedUsers.length + rankedCommunities.length + posts.length + formattedActivities.length;
    const duration = (performance.now() - startTime).toFixed(0);
    this.logger.log(`"${searchQuery || 'discovery'}" ${totalResults} results (${duration}ms)`);

    const nextCursor = (nextPostCursor || nextActivityCursor)
      ? encodeCursor({ p: nextPostCursor, a: nextActivityCursor })
      : undefined;

    const result = { users: rankedUsers, communities: rankedCommunities, posts, activities: formattedActivities, nextCursor };

    // 2. Cache write
    if (this.redis) {
      try {
        await this.redis.setex(cacheKey, SEARCH_CACHE_TTL, JSON.stringify(result));
      } catch {
        // Non-fatal
      }
    }

    return result;
  }

  async getSuggestions(query: string, currentUserId?: string) {
    const searchQuery = (query || '').trim();
    // Require ≥2 chars: single-char patterns match nearly everything and can't use the
    // pg_trgm indexes (trigrams need 3 chars), so they'd force a full scan for noise.
    // The typeahead dropdown isn't useful for 1 char anyway.
    if (searchQuery.length < 2) {
      return { users: [], communities: [], activities: [], keywords: [] };
    }
    const cacheKey = `search:suggestions:${searchQuery.toLowerCase()}:${currentUserId ?? 'anon'}`;

    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch {
        // Redis unavailable — fall through to DB
      }
    }

    const [excludedUserIds, suggestionViewer] = await Promise.all([
      currentUserId ? this.blocksService.getExcludedUserIds(currentUserId) : Promise.resolve([]),
      this.resolveViewer(currentUserId),
    ]);
    const suggestionExcludedUserIds = currentUserId ? [...excludedUserIds, currentUserId] : excludedUserIds;

    const [users, communities, activities] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          OR: [
            { username: { contains: searchQuery, mode: 'insensitive' } },
            { displayName: { contains: searchQuery, mode: 'insensitive' } },
          ],
          deletedAt: null,
          ...(suggestionExcludedUserIds.length > 0 ? { id: { notIn: suggestionExcludedUserIds } } : {}),
        },
        select: { id: true, username: true, displayName: true, avatar: true, isCampusRep: true, collegeId: true, college: { select: { id: true, name: true } } },
        take: 5,
      }),
      this.prisma.community.findMany({
        where: {
          name: { contains: searchQuery, mode: 'insensitive' },
          deletedAt: null,
        },
        select: { id: true, name: true, avatarKey: true, memberCount: true },
        take: 5,
      }),
      this.prisma.crewActivity.findMany({
        // Autocomplete leaks titles, so it runs the same discovery policy as the
        // full search rather than a looser "public only" heuristic.
        where: {
          AND: [
            {
              title: { contains: searchQuery, mode: 'insensitive' },
              status: 'OPEN',
              deletedAt: null,
              ...(suggestionExcludedUserIds.length > 0 ? { creatorId: { notIn: suggestionExcludedUserIds } } : {}),
            },
            this.activityPolicy.discoveryWhere(suggestionViewer),
          ],
        },
        select: { id: true, title: true, location: true },
        take: 5,
      }),
    ]);

    const result = { users, communities, activities, keywords: [] };

    if (this.redis) {
      try {
        await this.redis.setex(cacheKey, SUGGESTIONS_CACHE_TTL, JSON.stringify(result));
      } catch {
        // Non-fatal
      }
    }

    return result;
  }

  async getRecentSearches(userId: string) {
    if (!userId) return [];
    try {
      const recents = await this.prisma.recentSearch.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        take: 15,
        select: { term: true },
      });
      return recents.map(r => r.term);
    } catch {
      return [];
    }
  }

  async addRecentSearch(userId: string, term: string) {
    if (!userId || !term || !term.trim()) return [];
    const cleanTerm = term.trim();
    try {
      await this.prisma.recentSearch.upsert({
        where: { userId_term: { userId, term: cleanTerm } },
        create: { userId, term: cleanTerm },
        update: { updatedAt: new Date() },
      });
      return this.getRecentSearches(userId);
    } catch {
      return [];
    }
  }

  async removeRecentSearch(userId: string, term: string) {
    if (!userId || !term) return [];
    try {
      await this.prisma.recentSearch.deleteMany({
        where: { userId, term: term.trim() },
      });
      return this.getRecentSearches(userId);
    } catch {
      return [];
    }
  }

  async clearRecentSearches(userId: string) {
    if (!userId) return [];
    try {
      await this.prisma.recentSearch.deleteMany({
        where: { userId },
      });
      return [];
    } catch {
      return [];
    }
  }
}
