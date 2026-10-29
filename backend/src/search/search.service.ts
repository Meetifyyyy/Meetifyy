import { Injectable, Logger, Optional } from '@nestjs/common';
import { buildPollView, withMediaUrl } from '../posts/post-view';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { BlocksService } from '../users/blocks.service';
import { RedisService } from '../redis/redis.service';
import { ActivityAuthorizationService } from '../activities/activity-authorization.service';
import { hashtagQuery } from '../posts/hashtags.util';
import {
  ACTIVE_AFFILIATION_SELECT,
  activeAffiliationCollegeId,
} from '../common/campus/campus-access.service';
import {
  CommunitySearchRow,
  UserSearchRow,
  communitySearchSql,
  userSearchSql,
} from './search-ranking';

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
    return JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as SearchCursor;
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

  /**
   * Trusted viewer context straight from the database. `collegeId` is the
   * college of the viewer's ACTIVE affiliation (campus access), read in the
   * same query — not the `User.collegeId` mirror — so campus-only results
   * (COLLEGE_ONLY activities, campus communities) follow the campus gate.
   */
  private async resolveViewer(userId?: string) {
    if (!userId) return null;
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        collegeAffiliation: { select: ACTIVE_AFFILIATION_SELECT },
      },
    });
    if (!u) return null;
    return {
      id: u.id,
      collegeId: activeAffiliationCollegeId(u.collegeAffiliation),
    };
  }

  async globalSearch(
    query?: string,
    currentUserId?: string,
    limit = 15,
    type?: string,
    cursorParam?: string,
  ): Promise<GlobalSearchResult> {
    const searchQuery = (query || '').trim();
    const cleanQuery = searchQuery.toLowerCase();
    // `v4`: results are now ranked in SQL and carry a different user shape
    // (no `followers` array). The key is scoped by viewer, which is what
    // makes caching a block-filtered result safe.
    const cacheKey = `search:v4:${cleanQuery || 'discovery'}:${type || 'all'}:${currentUserId ?? 'anon'}:${limit}:${cursorParam || 'first'}`;

    // 1. Cache read
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          this.logger.debug(`Cache hit: "${searchQuery || 'discovery'}"`);
          return JSON.parse(cached) as GlobalSearchResult;
        }
      } catch {
        // Redis unavailable — fall through to DB
      }
    }

    const result = await this.runGlobalSearch(
      query,
      currentUserId,
      limit,
      type,
      cursorParam,
    );

    // 2. Cache write
    if (this.redis) {
      try {
        await this.redis.setex(
          cacheKey,
          SEARCH_CACHE_TTL,
          JSON.stringify(result),
        );
      } catch {
        // Non-fatal
      }
    }

    return result;
  }

  private async runGlobalSearch(
    query?: string,
    currentUserId?: string,
    limit = 15,
    type?: string,
    cursorParam?: string,
  ) {
    const searchQuery = (query || '').trim();
    const isDiscovery = searchQuery.length === 0;
    // "#music" (what a tapped hashtag opens) searches the tag itself: posts
    // indexed with it, exactly. A text search would also match "#musical".
    const tag = hashtagQuery(searchQuery);
    const now = new Date();
    const cursor = decodeCursor(cursorParam);
    const isPaginating = Boolean(cursor.p || cursor.a);

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
      currentUserId
        ? this.blocksService.getExcludedUserIds(currentUserId)
        : Promise.resolve([]),
      this.resolveViewer(currentUserId),
    ]);
    const searchExcludedUserIds = currentUserId
      ? [...excludedUserIds, currentUserId]
      : excludedUserIds;
    const startTime = performance.now();

    // Users/communities aren't paginated (small, relevance-capped lists) — only re-fetched on the first page.
    const fetchUsers =
      !tag &&
      !isPaginating &&
      (!type || type === 'all' || type === 'people' || type === 'users');
    const fetchCommunities =
      !tag &&
      !isPaginating &&
      (!type || type === 'all' || type === 'communities');
    const fetchPosts = !type || type === 'all' || type === 'posts';
    const fetchActivities =
      !tag && (!type || type === 'all' || type === 'activities');
    const postFetchLimit = (isDiscovery ? 6 : limit) + 1;
    const activityFetchLimit = (isDiscovery ? 6 : limit) + 1;

    // A community post is searchable only when its community is live and, if it
    // is a campus community, belongs to the viewer's own college (the same rule
    // the feed applies). Without this a foreign campus's public posts, and
    // posts from deleted communities, were returned to anyone.
    const campusScope: Prisma.CommunityWhereInput = {
      deletedAt: null,
      OR: [
        { isCampusCommunity: false },
        { collegeId: null },
        ...(viewer?.collegeId ? [{ collegeId: viewer.collegeId }] : []),
      ],
    };
    const postAndConditions: Prisma.PostWhereInput[] = [
      {
        OR: [
          { communityId: null },
          { community: { is: { ...campusScope, isPrivate: false } } },
          ...(currentUserId
            ? [
                {
                  community: {
                    is: {
                      ...campusScope,
                      members: { some: { userId: currentUserId } },
                    },
                  },
                },
              ]
            : []),
        ],
      },
      ...(postCursorDate && postCursorId
        ? [
            {
              OR: [
                { createdAt: { lt: postCursorDate } },
                { createdAt: postCursorDate, id: { lt: postCursorId } },
              ],
            } as Prisma.PostWhereInput,
          ]
        : []),
    ];

    const activityAndConditions: Prisma.CrewActivityWhereInput[] = [
      // Search is a discovery surface: restricted activities are excluded by the
      // shared policy at the query layer, never fetched-then-filtered.
      this.activityPolicy.discoveryWhere(viewer),
      {
        OR: [{ endDate: null }, { endDate: { gte: now } }],
      },
      ...(isDiscovery
        ? []
        : [
            {
              OR: [
                {
                  title: {
                    contains: searchQuery,
                    mode: 'insensitive' as Prisma.QueryMode,
                  },
                },
                {
                  description: {
                    contains: searchQuery,
                    mode: 'insensitive' as Prisma.QueryMode,
                  },
                },
                {
                  location: {
                    contains: searchQuery,
                    mode: 'insensitive' as Prisma.QueryMode,
                  },
                },
              ],
            } as Prisma.CrewActivityWhereInput,
          ]),
      ...(activityCursorDate && activityCursorId
        ? [
            {
              OR: [
                { startDate: { gt: activityCursorDate } },
                { startDate: activityCursorDate, id: { gt: activityCursorId } },
              ],
            } as Prisma.CrewActivityWhereInput,
          ]
        : []),
    ];

    const [users, communities, rawPostsPage, activitiesPage] =
      await Promise.all([
        fetchUsers
          ? isDiscovery
            ? this.discoveryUsers(searchExcludedUserIds, currentUserId)
            : this.prisma.$queryRaw<UserSearchRow[]>(
                userSearchSql({
                  query: searchQuery,
                  viewerId: currentUserId ?? null,
                  excludedIds: searchExcludedUserIds,
                  includeBio: true,
                  take: limit,
                }),
              )
          : Promise.resolve([]),

        fetchCommunities
          ? isDiscovery
            ? this.discoveryCommunities(viewer?.collegeId ?? null)
            : this.prisma.$queryRaw<CommunitySearchRow[]>(
                communitySearchSql({
                  query: searchQuery,
                  viewerId: currentUserId ?? null,
                  includeDescription: true,
                  take: limit,
                }),
              )
          : Promise.resolve([]),

        // Main feed posts: public posts or public community posts
        fetchPosts
          ? this.prisma.post.findMany({
              where: {
                deletedAt: null,
                // The author must still be an available account. Users are
                // already filtered this way everywhere in this service; posts
                // were not, so a search could surface content from an account
                // whose profile the same search refused to show.
                author: { deletedAt: null, accountStatus: 'ACTIVE' },
                ...(isDiscovery
                  ? {}
                  : tag
                    ? { hashtags: { some: { hashtag: { name: tag } } } }
                    : {
                        text: {
                          contains: searchQuery,
                          mode: 'insensitive',
                        },
                      }),
                ...(searchExcludedUserIds.length > 0
                  ? { authorId: { notIn: searchExcludedUserIds } }
                  : {}),
                AND: postAndConditions,
              },
              select: {
                id: true,
                text: true,
                createdAt: true,
                likeCount: true,
                commentCount: true,
                author: {
                  select: {
                    id: true,
                    username: true,
                    displayName: true,
                    avatar: true,
                    isCampusRep: true,
                    collegeId: true,
                    college: { select: { id: true, name: true } },
                  },
                },
                media: {
                  orderBy: [{ order: 'asc' }, { id: 'asc' }],
                  select: {
                    id: true,
                    objectKey: true,
                    width: true,
                    height: true,
                    mimeType: true,
                    type: true,
                    placeholder: true,
                  },
                },
                pollOptions: {
                  orderBy: [{ position: 'asc' }, { id: 'asc' }],
                  include: {
                    _count: { select: { votes: true } },
                  },
                },
                pollVotes: currentUserId
                  ? { where: { userId: currentUserId } }
                  : false,
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
                ...(searchExcludedUserIds.length > 0
                  ? { creatorId: { notIn: searchExcludedUserIds } }
                  : {}),
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
                    user: {
                      select: {
                        id: true,
                        username: true,
                        displayName: true,
                        avatar: true,
                        isCampusRep: true,
                        collegeId: true,
                        college: { select: { id: true, name: true } },
                      },
                    },
                  },
                },
                creator: {
                  select: {
                    id: true,
                    username: true,
                    displayName: true,
                    avatar: true,
                    isCampusRep: true,
                    collegeId: true,
                    college: { select: { id: true, name: true } },
                  },
                },
              },
              take: activityFetchLimit,
              orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
            })
          : Promise.resolve([]),
      ]);

    let nextPostCursor: string | undefined;
    const rawPosts = [...rawPostsPage];
    if (rawPosts.length > postFetchLimit - 1) {
      // Continue from the last post actually returned: the next page is
      // strictly after the cursor, so the popped look-ahead row would be lost.
      rawPosts.pop();
      const last = rawPosts[rawPosts.length - 1];
      if (last)
        nextPostCursor = `${new Date(last.createdAt).toISOString()}__${last.id}`;
    }

    let nextActivityCursor: string | undefined;
    const activities = [...activitiesPage];
    if (activities.length > activityFetchLimit - 1) {
      activities.pop();
      const last = activities[activities.length - 1];
      if (last?.startDate)
        nextActivityCursor = `${new Date(last.startDate).toISOString()}__${last.id}`;
    }

    // Already ranked by the query (see search-ranking.ts): match quality
    // first, the viewer's relationship to the result only within a tier.
    const rankedUsers = users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatar: u.avatar,
      bio: u.bio,
      isCampusRep: u.isCampusRep,
      collegeId: u.collegeId,
      college:
        u.collegeId && u.collegeName
          ? { id: u.collegeId, name: u.collegeName }
          : null,
      isFollowing: !!u.isFollowing,
      score: Number(u.score) || 0,
    }));
    const rankedCommunities = communities.map((c) => ({
      ...c,
      memberCount: Number(c.memberCount) || 0,
      score: Number(c.score) || 0,
    }));

    // Fetch Likes and Bookmarks for Posts
    const searchPostIds = rawPosts.map((p) => p.id);
    const [userLikes, userBookmarks] = await Promise.all([
      currentUserId && searchPostIds.length > 0
        ? this.prisma.postLike.findMany({
            where: { userId: currentUserId, postId: { in: searchPostIds } },
            select: { postId: true },
          })
        : [],
      currentUserId && searchPostIds.length > 0
        ? this.prisma.postBookmark.findMany({
            where: { userId: currentUserId, postId: { in: searchPostIds } },
            select: { postId: true },
          })
        : [],
    ]);

    const likedSet = new Set(userLikes.map((l) => l.postId));
    const bookmarkedSet = new Set(userBookmarks.map((b) => b.postId));

    const posts = rawPosts.map((p) => {
      const isLiked = likedSet.has(p.id);
      const isBookmarked = bookmarkedSet.has(p.id);

      const media = (p.media || []).map(withMediaUrl);

      // Counted from `_count` first, as the post detail page counts them.
      const pollOptions = p.pollOptions || [];
      const poll =
        pollOptions.length > 0
          ? buildPollView(
              p.text,
              pollOptions,
              (opt) => Number(opt.voteCount ?? opt._count?.votes ?? 0),
              Array.isArray(p.pollVotes) && p.pollVotes.length > 0
                ? p.pollVotes[0]?.optionId
                : null,
              currentUserId,
            )
          : null;

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

    const formattedActivities = activities.map((a) => ({
      ...a,
      slotsFilled: a.members?.length || 1,
    }));

    const totalResults =
      rankedUsers.length +
      rankedCommunities.length +
      posts.length +
      formattedActivities.length;
    const duration = (performance.now() - startTime).toFixed(0);
    this.logger.log(
      `"${searchQuery || 'discovery'}" ${totalResults} results (${duration}ms)`,
    );

    const nextCursor =
      nextPostCursor || nextActivityCursor
        ? encodeCursor({ p: nextPostCursor, a: nextActivityCursor })
        : undefined;

    const result = {
      users: rankedUsers,
      communities: rankedCommunities,
      posts,
      activities: formattedActivities,
      nextCursor,
    };

    return result;
  }

  /**
   * The empty-query people strip: the newest available accounts. Not ranked by
   * relevance (there is no query); kept to the shape of a ranked search row.
   * `isFollowing` is read for the viewer only — this used to load every
   * follower of every account to answer one yes/no.
   */
  private async discoveryUsers(
    excludedIds: string[],
    viewerId?: string,
  ): Promise<UserSearchRow[]> {
    const rows = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        accountStatus: 'ACTIVE',
        ...(excludedIds.length > 0 ? { id: { notIn: excludedIds } } : {}),
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        bio: true,
        isCampusRep: true,
        collegeId: true,
        college: { select: { name: true } },
        followers: viewerId
          ? { where: { followerId: viewerId }, select: { followerId: true } }
          : false,
      },
      take: 6,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatar: u.avatar,
      bio: u.bio,
      isCampusRep: u.isCampusRep,
      collegeId: u.collegeId,
      collegeName: u.college?.name ?? null,
      isFollowing: Array.isArray(u.followers) && u.followers.length > 0,
      score: 0,
    }));
  }

  /** The empty-query community strip: largest first, campus-only communities
   *  of other colleges excluded as they are everywhere else. */
  private async discoveryCommunities(
    collegeId: string | null,
  ): Promise<CommunitySearchRow[]> {
    const rows = await this.prisma.community.findMany({
      where: {
        deletedAt: null,
        OR: [
          { isCampusCommunity: false },
          ...(collegeId ? [{ isCampusCommunity: true, collegeId }] : []),
        ],
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
      take: 6,
      orderBy: { memberCount: 'desc' },
    });
    return rows.map((c) => ({ ...c, score: 0 }));
  }

  async getSuggestions(
    query: string,
    currentUserId?: string,
  ): Promise<SuggestionsResult> {
    const searchQuery = (query || '').trim();
    // Too short to search: answered without touching the cache, as before.
    if (searchQuery.length < 2)
      return this.runSuggestions(query, currentUserId);
    // `v3` for the same reason as the full-search key above.
    const cacheKey = `search:suggestions:v3:${searchQuery.toLowerCase()}:${currentUserId ?? 'anon'}`;

    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return JSON.parse(cached) as SuggestionsResult;
      } catch {
        // Redis unavailable — fall through to DB
      }
    }

    const result = await this.runSuggestions(query, currentUserId);

    if (this.redis) {
      try {
        await this.redis.setex(
          cacheKey,
          SUGGESTIONS_CACHE_TTL,
          JSON.stringify(result),
        );
      } catch {
        // Non-fatal
      }
    }

    return result;
  }

  private async runSuggestions(query: string, currentUserId?: string) {
    const searchQuery = (query || '').trim();
    // Require ≥2 chars: single-char patterns match nearly everything and can't use the
    // pg_trgm indexes (trigrams need 3 chars), so they'd force a full scan for noise.
    // The typeahead dropdown isn't useful for 1 char anyway.
    if (searchQuery.length < 2) {
      return { users: [], communities: [], activities: [], keywords: [] };
    }

    const [excludedUserIds, suggestionViewer] = await Promise.all([
      currentUserId
        ? this.blocksService.getExcludedUserIds(currentUserId)
        : Promise.resolve([]),
      this.resolveViewer(currentUserId),
    ]);
    const suggestionExcludedUserIds = currentUserId
      ? [...excludedUserIds, currentUserId]
      : excludedUserIds;

    // Typeahead is the most "I mean this exact thing" surface of all, so it
    // uses the same tiered ranking as the full search, without the bio and
    // description matches that only make sense on a results page.
    const [users, communities, activities] = await Promise.all([
      this.prisma.$queryRaw<UserSearchRow[]>(
        userSearchSql({
          query: searchQuery,
          viewerId: currentUserId ?? null,
          excludedIds: suggestionExcludedUserIds,
          includeBio: false,
          take: 5,
        }),
      ),
      this.prisma.$queryRaw<CommunitySearchRow[]>(
        communitySearchSql({
          query: searchQuery,
          viewerId: currentUserId ?? null,
          includeDescription: false,
          take: 5,
        }),
      ),
      this.prisma.crewActivity.findMany({
        // Autocomplete leaks titles, so it runs the same discovery policy as the
        // full search rather than a looser "public only" heuristic.
        where: {
          AND: [
            {
              title: { contains: searchQuery, mode: 'insensitive' },
              status: 'OPEN',
              deletedAt: null,
              ...(suggestionExcludedUserIds.length > 0
                ? { creatorId: { notIn: suggestionExcludedUserIds } }
                : {}),
            },
            this.activityPolicy.discoveryWhere(suggestionViewer),
          ],
        },
        select: { id: true, title: true, location: true },
        take: 5,
      }),
    ]);

    const result = {
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatar: u.avatar,
        isCampusRep: u.isCampusRep,
        collegeId: u.collegeId,
        college:
          u.collegeId && u.collegeName
            ? { id: u.collegeId, name: u.collegeName }
            : null,
      })),
      communities: communities.map((c) => ({
        id: c.id,
        name: c.name,
        avatarKey: c.avatarKey,
        memberCount: Number(c.memberCount) || 0,
      })),
      activities,
      keywords: [],
    };

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
      return recents.map((r) => r.term);
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

/** A global search response, as served and as cached. */
type GlobalSearchResult = Awaited<ReturnType<SearchService['runGlobalSearch']>>;

/** A typeahead response, as served and as cached. */
type SuggestionsResult = Awaited<ReturnType<SearchService['runSuggestions']>>;
