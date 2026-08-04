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

  async globalSearch(query?: string, currentUserId?: string, limit = 15, type?: string) {
    const searchQuery = (query || '').trim();
    const cleanQuery = searchQuery.toLowerCase();
    const isDiscovery = searchQuery.length === 0;
    const now = new Date();

    const cacheKey = `search:${cleanQuery || 'discovery'}:${type || 'all'}:${currentUserId ?? 'anon'}:${limit}`;

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

    const excludedUserIds = currentUserId ? await this.blocksService.getExcludedUserIds(currentUserId) : [];
    const searchExcludedUserIds = currentUserId ? [...excludedUserIds, currentUserId] : excludedUserIds;
    const startTime = performance.now();

    const fetchUsers = !type || type === 'all' || type === 'people' || type === 'users';
    const fetchCommunities = !type || type === 'all' || type === 'communities';
    const fetchPosts = !type || type === 'all' || type === 'posts';
    const fetchActivities = !type || type === 'all' || type === 'activities';

    const [users, communities, rawPosts, activities] = await Promise.all([
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
              ...(isDiscovery ? {} : { text: { contains: searchQuery, mode: 'insensitive' } }),
              ...(searchExcludedUserIds.length > 0 ? { authorId: { notIn: searchExcludedUserIds } } : {}),
              OR: [
                { communityId: null },
                { community: { is: { isPrivate: false } } },
                ...(currentUserId ? [{ community: { is: { members: { some: { userId: currentUserId } } } } }] : []),
              ],
            },
            select: {
              id: true,
              text: true,
              createdAt: true,
              likeCount: true,
              commentCount: true,
              author: { select: { id: true, username: true, displayName: true, avatar: true } },
              media: {
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
                include: {
                  _count: { select: { votes: true } }
                }
              },
              pollVotes: currentUserId ? { where: { userId: currentUserId } } : false,
            },
            take: isDiscovery ? 6 : limit,
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),

      // Activities: set to visibility PUBLIC (visible to anyone) and haven't ended yet
      fetchActivities
        ? this.prisma.crewActivity.findMany({
            where: {
              status: 'OPEN',
              deletedAt: null,
              visibility: ActivityVisibility.PUBLIC,
              ...(searchExcludedUserIds.length > 0 ? { creatorId: { notIn: searchExcludedUserIds } } : {}),
              OR: [
                { endDate: null },
                { endDate: { gte: now } },
              ],
              ...(isDiscovery
                ? {}
                : {
                    OR: [
                      { title: { contains: searchQuery, mode: 'insensitive' } },
                      { description: { contains: searchQuery, mode: 'insensitive' } },
                      { location: { contains: searchQuery, mode: 'insensitive' } },
                    ],
                  }),
            },
            select: {
              id: true,
              title: true,
              description: true,
              location: true,
              startDate: true,
              endDate: true,
              maxMembers: true,
              coverImage: true,
              members: {
                select: {
                  userId: true,
                  user: { select: { id: true, username: true, displayName: true, avatar: true } },
                },
              },
              creator: { select: { id: true, username: true, displayName: true, avatar: true } },
            },
            take: isDiscovery ? 6 : limit,
            orderBy: { startDate: 'asc' },
          })
        : Promise.resolve([]),
    ]);

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

    const result = { users: rankedUsers, communities: rankedCommunities, posts, activities: formattedActivities };

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
    if (!query || query.trim().length === 0) {
      return { users: [], communities: [], activities: [], keywords: [] };
    }

    const searchQuery = query.trim();
    const [users, communities, activities] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          OR: [
            { username: { contains: searchQuery, mode: 'insensitive' } },
            { displayName: { contains: searchQuery, mode: 'insensitive' } },
          ],
          deletedAt: null,
          ...(currentUserId ? { id: { not: currentUserId } } : {}),
        },
        select: { id: true, username: true, displayName: true, avatar: true },
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
        where: {
          title: { contains: searchQuery, mode: 'insensitive' },
          status: 'OPEN',
          visibility: ActivityVisibility.PUBLIC,
          deletedAt: null,
        },
        select: { id: true, title: true, location: true },
        take: 5,
      }),
    ]);

    return { users, communities, activities, keywords: [] };
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
