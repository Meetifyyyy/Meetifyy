import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma, MentionSource, NotificationEntityType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { BlocksService } from '../users/blocks.service';
import { DomainEventService } from '../events/domain-event.service';
import { RedisService } from '../redis/redis.service';
import { MentionsService } from '../mentions/mentions.service';
import { StorageService } from '../uploads/uploads.service';
import { MentionDto } from '../common/dto/mention.dto';
import { ContentDeletionAuthorizer } from './content-deletion.authorizer';

@Injectable()
export class PostsService {
  private readonly logger = new Logger('PostsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationFactory: NotificationFactory,
    private readonly blocksService: BlocksService,
    private readonly domainEventService: DomainEventService,
    private readonly redisService: RedisService,
    private readonly mentionsService: MentionsService,
    private readonly storageService: StorageService,
    private readonly contentDeletionAuthorizer: ContentDeletionAuthorizer,
  ) {}

  /**
   * Stamp `canDelete` on posts on their way to a client.
   *
   * Every path that returns posts must call this. `getFeed` alone had it, and
   * getFeed has an early-return branch for its raw-SQL query that skipped it —
   * so the flag was missing from the community feed, the post detail page,
   * profile posts and bookmarks, and owners and moderators saw no delete
   * control anywhere except one code path. The client falls back to
   * authorship when the field is absent, which fails closed and made the
   * omission silent rather than loud.
   *
   * Answered by the same authorizer the DELETE endpoint enforces with, so
   * what the UI offers and what the API allows cannot disagree.
   */
  private async attachCanDelete<
    T extends { authorId?: string; communityId?: string | null },
  >(posts: T[], userId?: string): Promise<T[]> {
    if (!posts.length) return posts;
    const flags = await this.contentDeletionAuthorizer.canDeleteEach(
      userId,
      posts.map((p) => ({
        authorId: (p as any).authorId,
        communityId: (p as any).communityId ?? null,
      })),
    );
    posts.forEach((p: any, i) => {
      p.canDelete = flags[i];
    });
    return posts;
  }

  private formatPost(
    post: any,
    likedSet: Set<string>,
    bookmarkedSet: Set<string>,
    currentUserId?: string,
  ) {
    const isLiked = likedSet.has(post.id);
    const isBookmarked = bookmarkedSet.has(post.id);
    const likeCount = post.likeCount ?? 0;
    const commentCount = post.commentCount ?? 0;

    const media = Array.isArray(post.media)
      ? post.media.map((m: any) => ({
          ...m,
          url: m.url || (m.objectKey ? `/api/media/${m.objectKey}` : null),
        }))
      : [];

    const pollOptions = post.pollOptions || [];
    let poll = post.poll || null;
    if (!poll && pollOptions.length > 0) {
      const sortedOptions = [...pollOptions].sort((a: any, b: any) =>
        (a.id || '').localeCompare(b.id || ''),
      );
      const options = sortedOptions.map((opt: any) => ({
        id: opt.id,
        text: opt.text,
        votes: Number(opt.voteCount ?? opt._count?.votes ?? 0),
      }));
      const totalVotes = options.reduce(
        (sum: number, o: any) => sum + o.votes,
        0,
      );

      const userVotedOptionId =
        post.userVotedOptionId ||
        (Array.isArray(post.pollVotes) && post.pollVotes.length > 0
          ? post.pollVotes[0]?.optionId
          : null);
      const userVotedIndex = userVotedOptionId
        ? options.findIndex((o: any) => o.id === userVotedOptionId)
        : -1;
      const myVotes = userVotedIndex >= 0 ? [userVotedIndex] : [];
      const selectedUsers =
        currentUserId && myVotes.length > 0 ? { [currentUserId]: myVotes } : {};

      poll = {
        question: post.text,
        options,
        totalVotes,
        userVotedOptionId: userVotedOptionId || undefined,
        votedOptionIndex: userVotedIndex >= 0 ? userVotedIndex : undefined,
        myVotes,
        selectedUsers,
      };
    }

    return {
      ...post,
      media,
      pollOptions,
      poll,
      likeCount,
      likesCount: likeCount,
      commentCount,
      commentsCount: commentCount,
      hasLiked: isLiked,
      isLiked: isLiked,
      isLikedByMe: isLiked,
      hasBookmarked: isBookmarked,
      isBookmarked: isBookmarked,
    };
  }

  async createPost(
    authorId: string,
    text: string,
    mediaKey?: string,
    communityId?: string,
    poll?: any,
    mentions?: MentionDto[],
  ) {
    if (communityId) {
      await this.assertCanPostInCommunity(authorId, communityId);
    }

    // Re-derive the true mention set from the actual text before it's ever
    // persisted — never trust client-claimed indices/usernames as-is.
    const sanitizedMentions = await this.mentionsService.sanitize(
      text,
      mentions,
      authorId,
    );

    // ── Safe media attach ──────────────────────────────────────────────────────
    // Verify the media BEFORE creating the post so a bad/missing key produces a
    // clear 400 instead of an opaque Prisma P2025 that fails the whole request
    // (and never silently drops the reference). Only the owner's own, not-yet-
    // attached media may be linked.
    let mediaToConnect: string | undefined;
    if (mediaKey) {
      const objectKey = mediaKey.replace('/api/media/', '');
      const media = await this.prisma.media.findUnique({
        where: { objectKey },
        select: { id: true, ownerId: true, postId: true },
      });
      if (!media || media.ownerId !== authorId) {
        this.logger.warn(
          `createPost: media not found or not owned (author=${authorId}, key=${objectKey})`,
        );
        throw new BadRequestException('Media not found or not owned');
      }
      // The Media row is written when the presigned URL is issued, i.e. BEFORE
      // the browser has uploaded anything. A PUT that never completed — dropped
      // connection, closed tab, a storage outage — therefore leaves a perfectly
      // valid-looking row pointing at an object that does not exist, and
      // attaching it produced a post whose image 404s forever with no clue why.
      //
      // One HeadObject at attach time turns that into a retryable error while
      // the user still has the file selected.
      const stored = await this.storageService.exists(objectKey);
      if (!stored) {
        this.logger.warn(
          `createPost: media row exists but object is missing from storage (key=${objectKey})`,
        );
        throw new BadRequestException(
          'Image upload did not finish. Please re-select the image and try again.',
        );
      }
      if (media.postId && media.postId !== '') {
        this.logger.warn(
          `createPost: media already attached to another post (key=${objectKey}, postId=${media.postId})`,
        );
        throw new BadRequestException('Media is already attached to a post');
      }
      mediaToConnect = media.id;
      this.logger.log(
        `createPost: attaching media id=${media.id} key=${objectKey} author=${authorId}`,
      );
    }

    const post = await this.prisma.post.create({
      data: {
        authorId,
        text,
        communityId,
        mentions:
          sanitizedMentions.length > 0 ? (sanitizedMentions as any) : undefined,
        media: mediaToConnect
          ? {
              connect: { id: mediaToConnect },
            }
          : undefined,
      },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            displayName: true,
            isCampusRep: true,
            avatar: true,
            collegeId: true,
            college: { select: { id: true, name: true } },
          },
        },
        media: true,
        community: {
          select: {
            id: true,
            name: true,
            deletedAt: true,
          },
        },
      },
    });

    let createdPollOptions: any[] = [];
    if (poll && Array.isArray(poll.options) && poll.options.length > 0) {
      await this.prisma.pollOption.createMany({
        data: poll.options.map((opt: string) => ({
          postId: post.id,
          text: opt,
        })),
      });
      createdPollOptions = await this.prisma.pollOption.findMany({
        where: { postId: post.id },
      });
    }

    const formattedMedia = (post.media || []).map((m: any) => ({
      ...m,
      url: m.url || (m.objectKey ? `/api/media/${m.objectKey}` : null),
    }));

    const formattedPost = {
      ...post,
      media: formattedMedia,
      pollOptions: createdPollOptions,
      poll:
        createdPollOptions.length > 0
          ? {
              question: post.text,
              options: createdPollOptions.map((o) => ({
                id: o.id,
                text: o.text,
                votes: 0,
              })),
              totalVotes: 0,
            }
          : null,
    };

    // Fire-and-forget: indexing + notifying mentioned users must never add
    // latency to the post-creation request or roll back the already-committed post.
    if (sanitizedMentions.length > 0 && post.author) {
      this.mentionsService
        .persistAndNotify({
          mentions: sanitizedMentions,
          sourceType: MentionSource.POST,
          sourceId: post.id,
          actor: post.author,
          entityType: NotificationEntityType.POST,
          entityId: post.id,
          contextText: text,
        })
        .catch((err) =>
          this.logger.warn('Failed to process post mentions', err),
        );
    }

    this.logger.log(
      `createPost: created post id=${post.id} author=${authorId} media=${formattedMedia.length} community=${post.communityId || 'none'}`,
    );
    this.domainEventService.emit('post.created', {
      postId: post.id,
      authorId,
      communityId: post.communityId || undefined,
      post: formattedPost,
    });
    return formattedPost;
  }

  async deletePost(postId: string, userId: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');

    // Server-side, on the one path every client shares. Hiding the delete
    // button is a courtesy; this is the rule.
    const authority = await this.contentDeletionAuthorizer.assertCanDelete(
      {
        actorId: userId,
        authorId: post.authorId,
        communityId: post.communityId ?? null,
      },
      'post',
    );

    await this.prisma.$transaction([
      this.prisma.post.update({
        where: { id: postId },
        data: { deletedAt: new Date() },
      }),
      // isDeleted must be set alongside deletedAt — every other read path
      // (shapeComments, fetchCommentPage) branches on isDeleted, not deletedAt,
      // to decide whether to scrub/placeholder a comment. Leaving isDeleted
      // false here would have been a latent inconsistency for any future code
      // path that reads a comment by id independent of its (now-gone) post.
      this.prisma.comment.updateMany({
        where: { postId },
        data: { deletedAt: new Date(), isDeleted: true },
      }),
      this.prisma.postBookmark.deleteMany({ where: { postId } }),
    ]);

    // Community posts already reach every member via the community_<id> room
    // (handled by the gateway's commId branch). For a personal post there's no
    // such room, so explicitly target the deleting user's OTHER devices/tabs —
    // this device already removed the post optimistically with no network
    // round-trip needed.
    this.domainEventService.emit(
      'post.deleted',
      { postId, communityId: post.communityId || undefined },
      [userId],
    );

    // Removed by someone else: the author is told. Fired here, at the point of
    // deletion, so no caller can skip it by using a different entry point.
    if (authority !== 'author') {
      this.notifyContentRemoved({
        actorId: userId,
        authorId: post.authorId,
        authority,
        contentType: 'post',
        entityId: postId,
        postId,
        communityId: post.communityId ?? null,
        preview: (post as any).text || '',
      });
    }

    return { success: true };
  }

  /**
   * Tell an author their content was removed by a moderator or the owner.
   *
   * Fire-and-forget: the deletion has already committed, and a notification
   * that fails to send must not turn a successful moderation action into an
   * error the moderator sees as "it didn't work" and retries.
   */
  private notifyContentRemoved(opts: {
    actorId: string;
    authorId: string;
    authority: 'owner' | 'moderator';
    contentType: 'post' | 'comment';
    entityId: string;
    postId: string | null;
    communityId: string | null;
    preview: string;
  }): void {
    (async () => {
      const [actor, community] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: opts.actorId },
          select: { id: true, username: true, displayName: true, avatar: true },
        }),
        opts.communityId
          ? this.prisma.community.findUnique({
              where: { id: opts.communityId },
              select: { name: true },
            })
          : Promise.resolve(null),
      ]);

      const dto = this.notificationFactory.createContentRemoved(actor, {
        recipientId: opts.authorId,
        contentType: opts.contentType,
        removedBy: opts.authority,
        entityId: opts.entityId,
        postId: opts.postId,
        communityId: opts.communityId,
        communityName: community?.name ?? null,
        contentPreview: opts.preview,
      });
      if (dto) await this.notificationsService.createNotification(dto);
    })().catch((err) =>
      this.logger.warn('Failed to send content-removed notification', err),
    );
  }

  /**
   * Authorizes writing a post into a community.
   *
   * This used to check only that the community existed and was not deleted.
   * Membership, privacy and campus eligibility were all enforced on the read
   * path and nowhere on the write path, so passing a communityId straight to
   * the API let anyone post into any community — including a private one they
   * could not open, or a campus community they were not eligible to join.
   * Their post would then be visible to that community's members while they
   * could not read the community themselves.
   *
   * The UI never offered it, which is why it went unnoticed; it was reachable
   * with a single API call regardless. The rules here deliberately mirror
   * getFeed's, so what a user may write into is exactly what they may read.
   */
  private async assertCanPostInCommunity(
    userId: string,
    communityId: string,
  ): Promise<void> {
    const community = await this.prisma.community.findUnique({
      where: { id: communityId },
      select: {
        id: true,
        deletedAt: true,
        isPrivate: true,
        isCampusCommunity: true,
        collegeId: true,
        ownerId: true,
      },
    });

    if (!community || community.deletedAt) {
      throw new NotFoundException('Community not found or has been deleted');
    }

    // The owner always may, whether or not a membership row exists for them —
    // the same allowance every other owner check in the app makes.
    if (community.ownerId && community.ownerId === userId) return;

    const membership = await this.prisma.communityMember.findUnique({
      where: { userId_communityId: { userId, communityId } },
      select: { role: true },
    });

    if (!membership) {
      throw new ForbiddenException('Join this community to post in it');
    }

    // Campus communities are restricted to their college even for members —
    // a membership row predating a college change must not grant access.
    if (community.isCampusCommunity && community.collegeId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { collegeId: true },
      });
      if (!user || user.collegeId !== community.collegeId) {
        throw new ForbiddenException(
          'This community is limited to verified students of its college',
        );
      }
    }
  }

  async getFeed(
    userId: string,
    limit = 10,
    cursor?: string,
    communityId?: string,
  ) {
    if (communityId) {
      const community = await this.prisma.community.findUnique({
        where: { id: communityId },
        select: {
          id: true,
          isPrivate: true,
          isCampusCommunity: true,
          collegeId: true,
          ownerId: true,
        },
      });
      if (community) {
        if (community.isCampusCommunity && community.collegeId) {
          const user = userId
            ? await this.prisma.user.findUnique({
                where: { id: userId },
                select: { collegeId: true },
              })
            : null;
          if (!user || user.collegeId !== community.collegeId) {
            return { posts: [], nextCursor: undefined };
          }
        }
        if (community.isPrivate) {
          const isOwner = userId && community.ownerId === userId;
          const isMember = userId
            ? await this.prisma.communityMember.findUnique({
                where: { userId_communityId: { userId, communityId } },
              })
            : null;
          if (!isOwner && !isMember) {
            return { posts: [], nextCursor: undefined };
          }
        }
      }
    }

    const excludedUserIds = userId
      ? await this.blocksService.getExcludedUserIds(userId)
      : [];
    // Compound keyset cursor: "<iso>__<postId>". The trailing post id is a
    // stable tiebreaker so two posts sharing an exact createdAt (same
    // millisecond) can never straddle a page boundary — one being skipped or
    // repeated. Legacy cursors (a bare ISO date, or a bare post id) still parse.
    let cursorDate: Date | undefined = undefined;
    let cursorId: string | undefined = undefined;
    if (cursor) {
      const delimiter = cursor.includes('|') ? '|' : '__';
      const [datePart, idPart] = cursor.split(delimiter);
      const parsed = new Date(datePart);
      if (!isNaN(parsed.getTime()) && datePart.includes('T')) {
        cursorDate = parsed;
        cursorId = idPart || undefined;
      } else {
        const cursorPost = await this.prisma.post.findUnique({
          where: { id: cursor },
          select: { createdAt: true, id: true },
        });
        if (cursorPost) {
          cursorDate = cursorPost.createdAt;
          cursorId = cursorPost.id;
        }
      }
    }

    const fetchLimit = limit + 1;

    const rawPosts: any[] = await this.prisma.$queryRaw`
      SELECT 
        p.id,
        p."authorId",
        p."communityId",
        p.text,
        p.mentions,
        p."likeCount",
        p."commentCount",
        p."createdAt",
        p."updatedAt",
        JSON_BUILD_OBJECT(
          'id', u.id,
          'username', u.username,
          'displayName', u."displayName",
          'avatar', u.avatar,
          'isCampusRep', u."isCampusRep",
          'collegeId', u."collegeId",
          'collegeName', col.name,
          'college', CASE WHEN col.id IS NOT NULL THEN JSON_BUILD_OBJECT('id', col.id, 'name', col.name) ELSE NULL END
        ) AS author,
        COALESCE(
          (
            SELECT JSON_AGG(
              JSON_BUILD_OBJECT(
                'id', m.id,
                'objectKey', m."objectKey",
                'width', m.width,
                'height', m.height,
                'mimeType', m."mimeType",
                'type', m.type
              )
            )
            FROM "Media" m 
            WHERE m."postId" = p.id
          ),
          '[]'::json
        ) AS media,
        COALESCE(
          (
            SELECT JSON_AGG(
              JSON_BUILD_OBJECT(
                'id', po.id,
                'text', po.text,
                'voteCount', po."voteCount"
              )
            )
            FROM "PollOption" po 
            WHERE po."postId" = p.id
          ),
          '[]'::json
        ) AS "pollOptions",
        CASE WHEN ${userId ? userId : ''}::text != '' THEN
          EXISTS(SELECT 1 FROM "PostLike" pl WHERE pl."userId" = ${userId || ''} AND pl."postId" = p.id)
        ELSE false END AS "isLiked",
        CASE WHEN ${userId ? userId : ''}::text != '' THEN
          EXISTS(SELECT 1 FROM "PostBookmark" pb WHERE pb."userId" = ${userId || ''} AND pb."postId" = p.id)
        ELSE false END AS "isBookmarked",
        CASE WHEN ${userId ? userId : ''}::text != '' THEN
          (SELECT pv."optionId" FROM "PollVote" pv WHERE pv."postId" = p.id AND pv."userId" = ${userId || ''} LIMIT 1)
        ELSE NULL END AS "userVotedOptionId",
        -- The community the post belongs to, taken from the join that was
        -- already here for the deleted-community filter. Without it the
        -- client had only a bare communityId and had to resolve the name
        -- against its own cached community list -- which is paginated to 30
        -- entries, so a post from the user's 31st community silently rendered
        -- with no tag at all. Now the tag travels with the post.
        CASE WHEN c.id IS NOT NULL THEN JSON_BUILD_OBJECT(
          'id', c.id,
          'name', c.name,
          'slug', c.slug,
          -- Both spellings: the column is avatarKey, but every community
          -- consumer on the client reads .avatar, so a row carrying only
          -- avatarKey rendered the letter placeholder instead of the picture.
          'avatar', c."avatarKey",
          'avatarKey', c."avatarKey",
          'color', c.color,
          'isPrivate', c."isPrivate",
          'isCampusCommunity', c."isCampusCommunity"
        ) ELSE NULL END AS community
      FROM "Post" p
      JOIN "User" u ON p."authorId" = u.id
      LEFT JOIN "College" col ON u."collegeId" = col.id
      LEFT JOIN "Community" c ON p."communityId" = c.id
      WHERE p."deletedAt" IS NULL
        AND (p."communityId" IS NULL OR c."deletedAt" IS NULL)
        ${
          communityId
            ? Prisma.sql`AND p."communityId" = ${communityId}`
            : userId
              ? Prisma.sql`AND (
                p."communityId" IS NULL 
                OR EXISTS (
                  SELECT 1 FROM "CommunityMember" cm 
                  WHERE cm."communityId" = p."communityId" 
                  AND cm."userId" = ${userId}
                )
              )`
              : Prisma.sql`AND p."communityId" IS NULL`
        }
        ${
          cursorDate
            ? cursorId
              ? Prisma.sql`AND (p."createdAt" < ${cursorDate} OR (p."createdAt" = ${cursorDate} AND p.id < ${cursorId}))`
              : Prisma.sql`AND p."createdAt" < ${cursorDate}`
            : Prisma.empty
        }
        ${excludedUserIds.length > 0 ? Prisma.sql`AND p."authorId" NOT IN (${Prisma.join(excludedUserIds)})` : Prisma.empty}
      ORDER BY p."createdAt" DESC, p.id DESC
      LIMIT ${fetchLimit};
    `;

    let nextCursor: string | undefined = undefined;
    if (rawPosts.length > limit) {
      const nextItem = rawPosts.pop();
      nextCursor = nextItem?.createdAt
        ? `${new Date(nextItem.createdAt).toISOString()}|${nextItem.id}`
        : undefined;
    }

    if (rawPosts.length === 0) {
      return { posts: [], nextCursor: undefined };
    }

    const formattedPosts = rawPosts.map((post) => {
      const isLiked = !!post.isLiked;
      const isBookmarked = !!post.isBookmarked;
      const likeCount = Number(post.likeCount ?? 0);
      const commentCount = Number(post.commentCount ?? 0);

      const media = (post.media || []).map((m: any) => ({
        ...m,
        url: m.url || (m.objectKey ? `/api/media/${m.objectKey}` : null),
      }));

      const pollOptions = post.pollOptions || [];
      let poll = null;
      if (pollOptions.length > 0) {
        const sortedOptions = [...pollOptions].sort((a: any, b: any) =>
          (a.id || '').localeCompare(b.id || ''),
        );
        const options = sortedOptions.map((opt: any) => ({
          id: opt.id,
          text: opt.text,
          votes: Number(opt.voteCount || 0),
        }));
        const totalVotes = options.reduce(
          (sum: number, o: any) => sum + o.votes,
          0,
        );

        const userVotedOptionId = post.userVotedOptionId || null;
        const userVotedIndex = userVotedOptionId
          ? options.findIndex((o: any) => o.id === userVotedOptionId)
          : -1;
        const myVotes = userVotedIndex >= 0 ? [userVotedIndex] : [];
        const selectedUsers =
          userId && myVotes.length > 0 ? { [userId]: myVotes } : {};

        poll = {
          question: post.text,
          options,
          totalVotes,
          userVotedOptionId: userVotedOptionId || undefined,
          votedOptionIndex: userVotedIndex >= 0 ? userVotedIndex : undefined,
          myVotes,
          selectedUsers,
        };
      }

      return {
        id: post.id,
        authorId: post.authorId,
        communityId: post.communityId,
        community: post.community || null,
        text: post.text,
        mentions: post.mentions || [],
        likeCount,
        likesCount: likeCount,
        commentCount,
        commentsCount: commentCount,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
        author: post.author,
        media,
        pollOptions,
        poll,
        hasLiked: isLiked,
        isLiked: isLiked,
        isLikedByMe: isLiked,
        hasBookmarked: isBookmarked,
        isBookmarked: isBookmarked,
      };
    });

    await this.attachCanDelete(formattedPosts as any[], userId);

    return {
      posts: formattedPosts,
      nextCursor,
    };
  }

  async getUserPosts(
    userId: string,
    username: string,
    limit = 10,
    cursor?: string,
  ) {
    const targetAuthor = await this.prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
      select: { id: true },
    });
    if (!targetAuthor) return { posts: [], nextCursor: undefined };

    if (
      userId &&
      (await this.blocksService.isBlocked(userId, targetAuthor.id))
    ) {
      return { posts: [], nextCursor: undefined };
    }

    // Compound keyset cursor "<iso>__<postId>" — the id tiebreaker keeps posts
    // with an identical createdAt from straddling a page boundary. Legacy
    // bare-date / bare-id cursors still parse.
    let cursorDate: Date | undefined = undefined;
    let cursorId: string | undefined = undefined;
    if (cursor) {
      const delimiter = cursor.includes('|') ? '|' : '__';
      const [datePart, idPart] = cursor.split(delimiter);
      const parsed = new Date(datePart);
      if (!isNaN(parsed.getTime()) && datePart.includes('T')) {
        cursorDate = parsed;
        cursorId = idPart || undefined;
      } else {
        const cursorPost = await this.prisma.post.findUnique({
          where: { id: cursor },
          select: { createdAt: true, id: true },
        });
        if (cursorPost) {
          cursorDate = cursorPost.createdAt;
          cursorId = cursorPost.id;
        }
      }
    }

    const posts = await this.prisma.post.findMany({
      take: limit + 1,
      where: {
        deletedAt: null,
        authorId: targetAuthor.id,
        communityId: null, // STRICTLY ONLY PROFILE POSTS — NO COMMUNITY POSTS
        ...(cursorDate
          ? cursorId
            ? {
                OR: [
                  { createdAt: { lt: cursorDate } },
                  { createdAt: cursorDate, id: { lt: cursorId } },
                ],
              }
            : { createdAt: { lt: cursorDate } }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        author: {
          select: {
            id: true,
            username: true,
            displayName: true,
            isCampusRep: true,
            avatar: true,
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
          },
        },
        pollOptions: {
          orderBy: { id: 'asc' },
          include: {
            _count: {
              select: { votes: true },
            },
          },
        },
        pollVotes: userId ? { where: { userId } } : false,
      },
    });

    let nextCursor: string | undefined = undefined;
    if (posts.length > limit) {
      const nextItem = posts.pop();
      nextCursor = nextItem
        ? `${nextItem.createdAt.toISOString()}|${nextItem.id}`
        : undefined;
    }

    if (posts.length === 0) {
      return { posts: [], nextCursor: undefined };
    }

    const postIds = posts.map((p) => p.id);

    const [userLikes, userBookmarks] = await Promise.all([
      userId
        ? this.prisma.postLike.findMany({
            where: { userId, postId: { in: postIds } },
            select: { postId: true },
          })
        : [],
      userId
        ? this.prisma.postBookmark.findMany({
            where: { userId, postId: { in: postIds } },
            select: { postId: true },
          })
        : [],
    ]);

    const likedSet = new Set(userLikes.map((l) => l.postId));
    const bookmarkedSet = new Set(userBookmarks.map((b) => b.postId));

    const formattedPosts = posts.map((post) =>
      this.formatPost(post, likedSet, bookmarkedSet, userId),
    );

    await this.attachCanDelete(formattedPosts, userId);

    return {
      posts: formattedPosts,
      nextCursor,
    };
  }

  async likePost(postId: string, userId: string) {
    const [post, excludedUserIds] = await Promise.all([
      this.prisma.post.findUnique({ where: { id: postId } }),
      this.blocksService.getExcludedUserIds(userId),
    ]);
    if (!post || post.deletedAt || excludedUserIds.includes(post.authorId))
      throw new NotFoundException('Post not found');

    const lockKey = `toggle:like:${userId}:${postId}`;

    return this.redisService.withLock(lockKey, 2000, async () => {
      // Single round-trip: the INSERT ... ON CONFLICT and the counter increment
      // run as one atomic statement (a CTE), so we pay one backend↔DB round trip
      // instead of two. `inserted` reflects whether a new like row was created.
      const rows: any[] = await this.prisma.$queryRaw`
        WITH ins AS (
          INSERT INTO "PostLike" ("userId", "postId", "createdAt")
          VALUES (${userId}, ${postId}, NOW())
          ON CONFLICT ("userId", "postId") DO NOTHING
          RETURNING 1
        )
        UPDATE "Post"
        SET "likeCount" = "likeCount" + (SELECT count(*)::int FROM ins)
        WHERE id = ${postId}
        RETURNING "likeCount", (SELECT count(*)::int FROM ins) AS inserted
      `;
      const inserted = Number(rows?.[0]?.inserted ?? 0);
      const updatedCount = Number(rows?.[0]?.likeCount ?? post.likeCount);
      if (inserted === 1) {
        if (post.authorId !== userId) {
          this.prisma.user
            .findUnique({
              where: { id: userId },
              select: {
                id: true,
                displayName: true,
                username: true,
                avatar: true,
              },
            })
            .then((actor) => {
              if (actor) {
                const dto = this.notificationFactory.createLike(
                  actor,
                  post,
                  post.authorId,
                );
                this.notificationsService
                  .createNotification(dto)
                  .catch((err) => {
                    this.logger.warn('Failed to send like notification', err);
                  });
              }
            })
            .catch((err) => {
              this.logger.warn(
                'Failed to fetch actor for like notification',
                err,
              );
            });
        }

        this.domainEventService.emit(
          'post.liked',
          { postId, userId, likeCount: updatedCount },
          [post.authorId],
        );
      }

      return {
        success: true,
        postId,
        hasLiked: true,
        isLiked: true,
        isLikedByMe: true,
        likeCount: updatedCount,
        likesCount: updatedCount,
      };
    });
  }

  async unlikePost(postId: string, userId: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.deletedAt)
      throw new NotFoundException('Post has been deleted');

    // Share the SAME lock key as likePost so like/unlike for a given user+post
    // can never interleave. The decrement is tied to an atomic DELETE — it only
    // fires when this call actually removed a row, so concurrent/duplicate
    // unlikes can't double-decrement the counter, and the count is floored at 0.
    const lockKey = `toggle:like:${userId}:${postId}`;

    return this.redisService.withLock(lockKey, 2000, async () => {
      // One atomic round-trip: DELETE the like and decrement the counter only if a
      // row was actually removed (floored at 0), via a single CTE statement.
      const rows: any[] = await this.prisma.$queryRaw`
        WITH del AS (
          DELETE FROM "PostLike" WHERE "userId" = ${userId} AND "postId" = ${postId}
          RETURNING 1
        )
        UPDATE "Post"
        SET "likeCount" = GREATEST(0, "likeCount" - (SELECT count(*)::int FROM del))
        WHERE id = ${postId}
        RETURNING "likeCount", (SELECT count(*)::int FROM del) AS deleted
      `;
      const deleted = Number(rows?.[0]?.deleted ?? 0);
      const updatedCount = Number(rows?.[0]?.likeCount ?? post.likeCount);
      if (deleted === 1) {
        this.domainEventService.emit(
          'post.unliked',
          { postId, userId, likeCount: updatedCount },
          [post.authorId],
        );
      }

      return {
        success: true,
        postId,
        hasLiked: false,
        isLiked: false,
        isLikedByMe: false,
        likeCount: Math.max(0, updatedCount),
        likesCount: Math.max(0, updatedCount),
      };
    });
  }

  async deleteComment(commentId: string, userId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        _count: { select: { replies: { where: { isDeleted: false } } } },
        // The comment's community is the community of the post it sits under —
        // comments carry no communityId of their own, so moderation rights have
        // to be resolved through the post.
        post: { select: { communityId: true } },
      },
    });

    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.isDeleted)
      throw new NotFoundException('Comment already deleted');

    // Identical rule to posts, from the same authorizer — see its docblock.
    const authority = await this.contentDeletionAuthorizer.assertCanDelete(
      {
        actorId: userId,
        authorId: comment.authorId,
        communityId: (comment as any).post?.communityId ?? null,
      },
      'comment',
    );

    // Captured before the update scrubs them.
    const originalAuthorId = comment.authorId;
    const originalText = comment.text || '';

    const hasActiveReplies = (comment as any)._count.replies > 0;

    await this.prisma.comment.update({
      where: { id: commentId },
      data: {
        isDeleted: true,
        deletedByUser: true,
        deletedAt: new Date(),
        // Scrub content and attribution — preserve only structural fields
        text: '',
        mentions: Prisma.DbNull,
        authorId: comment.authorId, // keep FK to avoid cascade issues
        likeCount: 0,
      },
    });

    // Always decrement. `addComment` increments unconditionally, so anything
    // conditional here drifts: deleting a comment that had replies used to leave
    // the count permanently one too high, while the client decremented anyway —
    // so the number changed on screen and then jumped back on the next refetch.
    //
    // A comment that survives as a structural placeholder is still not a comment
    // anyone wrote, and it is no longer rendered unless it is holding replies up,
    // so counting it would be wrong on its own terms.
    await this.prisma.post
      .update({
        where: { id: comment.postId },
        data: { commentCount: { decrement: 1 } },
      })
      .catch(() => {}); // best-effort — don't fail the whole operation

    // Remove all likes on this comment
    await this.prisma.commentLike
      .deleteMany({ where: { commentId } })
      .catch(() => {});

    this.domainEventService.emit('comment.deleted', {
      commentId,
      postId: comment.postId,
      userId,
    });

    if (authority !== 'author') {
      this.notifyContentRemoved({
        actorId: userId,
        authorId: originalAuthorId,
        authority,
        contentType: 'comment',
        entityId: commentId,
        postId: comment.postId,
        communityId: (comment as any).post?.communityId ?? null,
        preview: originalText,
      });
    }

    return { success: true, isDeleted: true, hasActiveReplies };
  }

  async likeComment(commentId: string, userId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });
    if (!comment || comment.isDeleted)
      throw new NotFoundException('Comment has been deleted');

    const post = await this.prisma.post.findUnique({
      where: { id: comment.postId },
    });
    if (!post || post.deletedAt)
      throw new NotFoundException('Post has been deleted');

    const lockKey = `toggle:commentlike:${userId}:${commentId}`;

    return this.redisService.withLock(lockKey, 2000, async () => {
      // One atomic round-trip: INSERT ... ON CONFLICT + increment via a single CTE
      // (never throws P2002, counter can't be double-incremented).
      const rows: any[] = await this.prisma.$queryRaw`
        WITH ins AS (
          INSERT INTO "CommentLike" ("userId", "commentId", "createdAt")
          VALUES (${userId}, ${commentId}, NOW())
          ON CONFLICT ("userId", "commentId") DO NOTHING
          RETURNING 1
        )
        UPDATE "Comment"
        SET "likeCount" = "likeCount" + (SELECT count(*)::int FROM ins)
        WHERE id = ${commentId}
        RETURNING "likeCount", (SELECT count(*)::int FROM ins) AS inserted
      `;
      const inserted = Number(rows?.[0]?.inserted ?? 0);
      const updated = {
        likeCount: Number(rows?.[0]?.likeCount ?? comment.likeCount),
      };

      if (inserted === 1) {
        if (comment.authorId !== userId) {
          this.prisma.user
            .findUnique({
              where: { id: userId },
              select: {
                id: true,
                displayName: true,
                username: true,
                avatar: true,
              },
            })
            .then((actor) => {
              if (actor) {
                const dto = this.notificationFactory.createCommentLike(
                  actor,
                  comment,
                  comment.authorId,
                );
                this.notificationsService
                  .createNotification(dto)
                  .catch((err) => {
                    this.logger.warn(
                      'Failed to send comment like notification',
                      err,
                    );
                  });
              }
            })
            .catch((err) => {
              this.logger.warn(
                'Failed to fetch actor for comment like notification',
                err,
              );
            });
        }

        // Carry the authoritative likeCount so post-room viewers apply an
        // absolute value (idempotent) rather than a relative bump.
        this.domainEventService.emit('comment.liked', {
          commentId,
          postId: comment.postId,
          userId,
          likeCount: updated.likeCount,
        });
      }

      return { success: true };
    });
  }

  async unlikeComment(commentId: string, userId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });
    if (!comment || comment.isDeleted)
      throw new NotFoundException('Comment has been deleted');

    // Same lock key as likeComment so like/unlike can't interleave; decrement is
    // tied to an atomic DELETE and floored at 0 (no double-decrement drift).
    const lockKey = `toggle:commentlike:${userId}:${commentId}`;

    return this.redisService.withLock(lockKey, 2000, async () => {
      // One atomic round-trip: DELETE + floored decrement via a single CTE.
      const rows: any[] = await this.prisma.$queryRaw`
        WITH del AS (
          DELETE FROM "CommentLike" WHERE "userId" = ${userId} AND "commentId" = ${commentId}
          RETURNING 1
        )
        UPDATE "Comment"
        SET "likeCount" = GREATEST(0, "likeCount" - (SELECT count(*)::int FROM del))
        WHERE id = ${commentId}
        RETURNING "likeCount", (SELECT count(*)::int FROM del) AS deleted
      `;
      const deleted = Number(rows?.[0]?.deleted ?? 0);
      if (deleted === 1) {
        const likeCount = Number(rows?.[0]?.likeCount ?? 0);
        this.domainEventService.emit('comment.unliked', {
          commentId,
          postId: comment.postId,
          userId,
          likeCount,
        });
      }

      return { success: true };
    });
  }

  async addComment(
    postId: string,
    authorId: string,
    text: string,
    parentId?: string,
    mentions?: MentionDto[],
  ) {
    // Independent reads — run them in one parallel round-trip instead of two.
    const [post, excludedUserIds] = await Promise.all([
      this.prisma.post.findUnique({ where: { id: postId } }),
      this.blocksService.getExcludedUserIds(authorId),
    ]);
    if (!post || post.deletedAt || excludedUserIds.includes(post.authorId))
      throw new NotFoundException('Post not found');

    let parentComment: any = null;
    if (parentId) {
      parentComment = await this.prisma.comment.findUnique({
        where: { id: parentId },
      });
      // The parent was accepted on trust: an id for a comment on a *different*
      // post was stored happily, producing a reply that belongs to a thread it
      // can never be rendered in (the tree builder finds no parent and promotes
      // it to a root on the wrong post). A deleted parent is refused too —
      // replying under a tombstone resurrects it as a visible placeholder.
      if (!parentComment || parentComment.postId !== postId) {
        throw new NotFoundException('Comment not found');
      }
      if (parentComment.isDeleted) {
        throw new BadRequestException('This comment has been deleted');
      }
    }

    // Re-derive the true mention set from the actual comment text before persisting.
    const sanitizedMentions = await this.mentionsService.sanitize(
      text,
      mentions,
      authorId,
    );

    const comment = await this.prisma.$transaction(async (tx) => {
      const createdComment = await tx.comment.create({
        data: {
          postId,
          authorId,
          text,
          parentId,
          mentions:
            sanitizedMentions.length > 0
              ? (sanitizedMentions as any)
              : undefined,
        },
        include: { author: { select: PostsService.COMMENT_AUTHOR_SELECT } },
      });

      await tx.post.update({
        where: { id: postId },
        data: { commentCount: { increment: 1 } },
      });

      return createdComment;
    });

    // The created row already carries the author, so reuse it for notifications
    // (one fewer query) and for the realtime payload below.
    const actor = comment.author;
    if (actor) {
      // 1. Notify parent comment author if replying to another comment
      if (
        parentComment &&
        parentComment.authorId &&
        parentComment.authorId !== authorId
      ) {
        const replyDto = this.notificationFactory.createCommentReply(
          actor,
          comment,
          post,
          parentComment.authorId,
        );
        this.notificationsService.createNotification(replyDto).catch((err) => {
          this.logger.warn('Failed to send comment reply notification', err);
        });
      }

      // 2. Notify post author (if distinct from commenter and parent comment author)
      if (
        post.authorId !== authorId &&
        (!parentComment || post.authorId !== parentComment.authorId)
      ) {
        const postDto = this.notificationFactory.createComment(
          actor,
          comment,
          post,
          post.authorId,
        );
        this.notificationsService.createNotification(postDto).catch((err) => {
          this.logger.warn('Failed to send comment notification', err);
        });
      }

      // 3. Notify every uniquely @mentioned user (excludes anyone already
      // covered by the reply/post-author notifications above by design —
      // createNotification's own recipientId===actorId guard prevents
      // self-notifies, and a user can still legitimately get both a
      // "commented on your post" AND a "mentioned you" notification).
      if (sanitizedMentions.length > 0) {
        this.mentionsService
          .persistAndNotify({
            mentions: sanitizedMentions,
            sourceType: MentionSource.COMMENT,
            sourceId: comment.id,
            actor,
            entityType: NotificationEntityType.COMMENT,
            entityId: comment.id,
            contextText: text,
            extraMetadata: { postId },
          })
          .catch((err) =>
            this.logger.warn('Failed to process comment mentions', err),
          );
      }
    }

    // Emit the fully-shaped comment so anyone viewing the post can insert it
    // live (deduped by id on the client). Same shape as a live comment from
    // getPostById so the client tree-builder handles it uniformly.
    const eventComment = {
      ...comment,
      isDeleted: false,
      likeCount: comment.likeCount ?? 0,
      likesCount: comment.likeCount ?? 0,
      hasLiked: false,
      isLiked: false,
      isLikedByMe: false,
    };
    this.domainEventService.emit('comment.created', {
      commentId: comment.id,
      postId,
      authorId,
      parentId,
      comment: eventComment,
    });

    return comment;
  }

  async getPostMeta(postId: string) {
    return this.prisma.post.findUnique({
      where: { id: postId, deletedAt: null },
      select: { updatedAt: true },
    });
  }

  // Number of ROOT (top-level) comments returned per comment page. Every root is
  // returned together with its full descendant subtree, so a page is always a
  // set of complete threads — the frontend can concatenate pages and rebuild the
  // tree with no orphaned replies.
  private static readonly COMMENT_PAGE_ROOTS = 20;

  private static readonly COMMENT_AUTHOR_SELECT = {
    id: true,
    username: true,
    displayName: true,
    isCampusRep: true,
    avatar: true,
    collegeId: true,
    college: { select: { id: true, name: true } },
  } as const;

  /**
   * Shape raw comment rows for the client: soft-deleted comments are scrubbed to
   * a structural placeholder (so the thread hierarchy is preserved without
   * leaking the original author/text), live comments get the viewer's like flag.
   */
  /**
   * Drops deleted comments that exist only as tombstones.
   *
   * A deleted comment is kept only when a live reply still hangs off it —
   * without the placeholder the tree would lose its shape and orphan those
   * replies. A deleted *leaf* serves no such purpose, and leaving it in meant a
   * thread slowly filled with "[deleted]" rows that could never be cleared, and
   * that `post.commentCount` did not count. Users saw "3 comments" above five
   * rows.
   *
   * Pruning runs bottom-up and repeats to a fixed point, because removing a
   * tombstone's last live descendant can turn its deleted parent into a leaf in
   * turn.
   */
  private pruneEmptyTombstones(rawComments: any[]) {
    let survivors = rawComments;
    for (;;) {
      const parentsWithChildren = new Set(
        survivors.map((c) => c.parentId).filter(Boolean),
      );
      const next = survivors.filter(
        (c) => !c.isDeleted || parentsWithChildren.has(c.id),
      );
      if (next.length === survivors.length) return next;
      survivors = next;
    }
  }

  private shapeComments(rawComments: any[], likedCommentIds: Set<string>) {
    return this.pruneEmptyTombstones(rawComments).map((c) => {
      if (c.isDeleted) {
        return {
          id: c.id,
          postId: c.postId,
          parentId: c.parentId,
          createdAt: c.createdAt,
          isDeleted: true,
          deletedByUser: c.deletedByUser,
          removedByOwner: c.removedByOwner,
          text: null,
          author: null,
          authorId: null,
          likeCount: 0,
          hasLiked: false,
          isLiked: false,
          isLikedByMe: false,
        };
      }
      const liked = likedCommentIds.has(c.id);
      return {
        ...c,
        isDeleted: false,
        hasLiked: liked,
        isLiked: liked,
        isLikedByMe: liked,
      };
    });
  }

  /**
   * Fetch one page of a post's comments as complete threads: a keyset page of
   * root comments (ordered oldest-first to match the existing UI) plus every
   * descendant of those roots. Descendants are gathered iteratively level by
   * level (bounded by real thread depth — a handful of queries), which supports
   * arbitrary nesting without a recursive CTE. Does NOT validate the post — the
   * caller is responsible for that.
   */
  private async fetchCommentPage(
    postId: string,
    userId: string,
    limit: number,
    cursorDate?: Date,
    cursorId?: string,
  ) {
    // Comments inherit their moderation context from the post they sit under.
    const parentPost = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { communityId: true },
    });
    const postCommunityId = parentPost?.communityId ?? null;

    // Roots are ordered oldest-first with an id tiebreaker so equal-createdAt
    // roots can't straddle a page boundary (forward keyset: strictly "after"
    // the cursor).
    // Comments by a blocked author are excluded for THIS viewer only — the rows
    // stay in the table and other readers still see them normally. Filtering in
    // the query rather than after the fact keeps the keyset page size honest:
    // dropping rows post-hoc would return short pages and a cursor that skips.
    const rootWhere = await this.blocksService.injectBlockFilter(
      userId,
      {
        postId,
        parentId: null,
        ...(cursorDate
          ? cursorId
            ? {
                OR: [
                  { createdAt: { gt: cursorDate } },
                  { createdAt: cursorDate, id: { gt: cursorId } },
                ],
              }
            : { createdAt: { gt: cursorDate } }
          : {}),
      },
      'authorId',
    );

    const roots = await this.prisma.comment.findMany({
      where: rootWhere,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      include: { author: { select: PostsService.COMMENT_AUTHOR_SELECT } },
    });

    let nextCursor: string | undefined = undefined;
    if (roots.length > limit) {
      const extra = roots.pop();
      nextCursor = extra
        ? `${extra.createdAt.toISOString()}__${extra.id}`
        : undefined;
    }

    // Breadth-first descendant gathering. `parentId IN frontier` yields disjoint
    // sets each level (a comment has exactly one parent), so no node is fetched
    // twice; the depth cap is a defensive guard against pathological data.
    const all: any[] = [...roots];
    let frontier = roots.map((r) => r.id);
    let depth = 0;
    while (frontier.length > 0 && depth < 40) {
      const children = await this.prisma.comment.findMany({
        // Replies are filtered on the same basis. A reply whose parent was
        // filtered out is unreachable anyway, since the parent never enters
        // the frontier — so a blocked user's subtree disappears with them.
        where: await this.blocksService.injectBlockFilter(
          userId,
          { parentId: { in: frontier } },
          'authorId',
        ),
        orderBy: { createdAt: 'asc' },
        include: { author: { select: PostsService.COMMENT_AUTHOR_SELECT } },
      });
      if (children.length === 0) break;
      all.push(...children);
      frontier = children.map((c) => c.id);
      depth += 1;
    }

    const liveIds = all.filter((c) => !c.isDeleted).map((c) => c.id);
    const commentLikes =
      userId && liveIds.length > 0
        ? await this.prisma.commentLike.findMany({
            where: { userId, commentId: { in: liveIds } },
            select: { commentId: true },
          })
        : [];
    const likedSet = new Set(commentLikes.map((l) => l.commentId));

    const shaped = this.shapeComments(all, likedSet);
    const flat: any[] = [];
    const walk = (nodes: any[]) =>
      nodes.forEach((n) => {
        flat.push(n);
        if (n.replies?.length) walk(n.replies);
      });
    walk(shaped);

    const commentsDeletable =
      await this.contentDeletionAuthorizer.canDeleteEach(
        userId,
        // A comment has no community of its own — moderation rights come from
        // the post it sits under.
        flat.map((c: any) => ({
          authorId: c.authorId,
          communityId: postCommunityId,
        })),
      );
    flat.forEach((c: any, i: number) => {
      // A scrubbed placeholder is already gone; offering to remove it again is
      // meaningless and its authorId is no longer meaningful either.
      c.canDelete = c.isDeleted ? false : commentsDeletable[i];
    });

    return { comments: shaped, nextCursor };
  }

  /**
   * Public paginated comments endpoint — used to load pages beyond the first
   * (which is embedded in getPostById for instant first paint).
   */
  async getComments(
    postId: string,
    userId: string,
    limit = PostsService.COMMENT_PAGE_ROOTS,
    cursor?: string,
  ) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId, deletedAt: null },
      select: {
        id: true,
        authorId: true,
        community: { select: { deletedAt: true } },
      },
    });
    if (!post || (post.community && post.community.deletedAt)) {
      throw new NotFoundException('Post not found');
    }
    if (userId) {
      if (await this.blocksService.isBlocked(userId, post.authorId)) {
        throw new NotFoundException('Post not found');
      }
    }

    // Compound keyset cursor "<iso>__<commentId>" (legacy bare-date / bare-id
    // cursors still parse).
    let cursorDate: Date | undefined = undefined;
    let cursorId: string | undefined = undefined;
    if (cursor) {
      const [datePart, idPart] = cursor.split('__');
      const parsed = new Date(datePart);
      if (!isNaN(parsed.getTime()) && datePart.includes('T')) {
        cursorDate = parsed;
        cursorId = idPart || undefined;
      } else {
        const cursorComment = await this.prisma.comment.findUnique({
          where: { id: cursor },
          select: { createdAt: true, id: true },
        });
        if (cursorComment) {
          cursorDate = cursorComment.createdAt;
          cursorId = cursorComment.id;
        }
      }
    }

    return this.fetchCommentPage(postId, userId, limit, cursorDate, cursorId);
  }

  async getPostById(postId: string, userId: string) {
    // Single parallel burst: block exclusions, core post, media, first comment
    // page (roots + their subtrees), and the viewer's like/bookmark state.
    const [excludedUserIds, post, media, commentPage, postLike, postBookmark] =
      await Promise.all([
        userId
          ? this.blocksService.getExcludedUserIds(userId)
          : Promise.resolve([] as string[]),
        this.prisma.post.findUnique({
          where: { id: postId, deletedAt: null },
          include: {
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
            community: { select: { id: true, name: true, deletedAt: true } },
            pollOptions: {
              orderBy: { id: 'asc' },
              include: { _count: { select: { votes: true } } },
            },
            pollVotes: userId ? { where: { userId } } : false,
          },
        }),
        this.prisma.media.findMany({
          where: { postId },
        }),
        // Root-paginated first page — no longer silently capped at 50 flat rows;
        // subsequent pages load via getComments(). Each page is a set of complete
        // threads so the client can concatenate and rebuild the tree safely.
        this.fetchCommentPage(postId, userId, PostsService.COMMENT_PAGE_ROOTS),
        userId
          ? this.prisma.postLike.findUnique({
              where: { userId_postId: { userId, postId } },
            })
          : Promise.resolve(null),
        userId
          ? this.prisma.postBookmark.findUnique({
              where: { userId_postId: { userId, postId } },
            })
          : Promise.resolve(null),
      ]);

    if (
      !post ||
      post.deletedAt ||
      (post.community && post.community.deletedAt) ||
      (excludedUserIds.length > 0 && excludedUserIds.includes(post.authorId))
    ) {
      throw new NotFoundException('Post not found');
    }

    const shapedComments = commentPage.comments;
    const commentsNextCursor = commentPage.nextCursor;
    const isLiked = !!postLike;
    const isBookmarked = !!postBookmark;

    const formattedMedia = (media || []).map((m: any) => ({
      ...m,
      url: m.url || (m.objectKey ? `/api/media/${m.objectKey}` : null),
    }));

    const pollOptions = (post as any).pollOptions || [];
    let poll = (post as any).poll || null;
    if (!poll && pollOptions.length > 0) {
      const sortedOptions = [...pollOptions].sort((a: any, b: any) =>
        (a.id || '').localeCompare(b.id || ''),
      );
      const options = sortedOptions.map((opt: any) => ({
        id: opt.id,
        text: opt.text,
        votes: Number(opt._count?.votes || opt.voteCount || 0),
      }));
      const totalVotes = options.reduce(
        (sum: number, o: any) => sum + o.votes,
        0,
      );

      const userVotedOptionId =
        Array.isArray((post as any).pollVotes) &&
        (post as any).pollVotes.length > 0
          ? (post as any).pollVotes[0]?.optionId
          : null;
      const userVotedIndex = userVotedOptionId
        ? options.findIndex((o: any) => o.id === userVotedOptionId)
        : -1;
      const myVotes = userVotedIndex >= 0 ? [userVotedIndex] : [];
      const selectedUsers =
        userId && myVotes.length > 0 ? { [userId]: myVotes } : {};

      poll = {
        question: post.text,
        options,
        totalVotes,
        userVotedOptionId: userVotedOptionId || undefined,
        votedOptionIndex: userVotedIndex >= 0 ? userVotedIndex : undefined,
        myVotes,
        selectedUsers,
      };
    }

    const [canDeleteThis] = await this.contentDeletionAuthorizer.canDeleteEach(
      userId,
      [
        {
          authorId: (post as any).authorId,
          communityId: (post as any).communityId ?? null,
        },
      ],
    );

    return {
      ...post,
      canDelete: canDeleteThis,
      media: formattedMedia,
      pollOptions,
      poll,
      comments: shapedComments,
      commentsNextCursor,
      likeCount: post.likeCount,
      likesCount: post.likeCount,
      commentCount: post.commentCount,
      commentsCount: post.commentCount,
      hasLiked: isLiked,
      isLiked,
      isLikedByMe: isLiked,
      hasBookmarked: isBookmarked,
      isBookmarked,
    };
  }

  async bookmarkPost(postId: string, userId: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.deletedAt)
      throw new NotFoundException('Post has been deleted');

    await this.prisma.postBookmark.upsert({
      where: { userId_postId: { userId, postId } },
      update: {},
      create: { userId, postId },
    });

    this.domainEventService.emit('post.saved', { postId, userId }, [userId]);
    return { success: true };
  }

  async unbookmarkPost(postId: string, userId: string) {
    const existing = await this.prisma.postBookmark.findUnique({
      where: { userId_postId: { userId, postId } },
    });
    if (existing) {
      await this.prisma.postBookmark.delete({
        where: { userId_postId: { userId, postId } },
      });
      this.domainEventService.emit('post.unsaved', { postId, userId }, [
        userId,
      ]);
    }
    return { success: true };
  }

  async getBookmarks(userId: string, limit = 10, cursor?: string) {
    // A bookmark saved before a block stays in the table (historical data is
    // never deleted on block) but must stop resolving for the viewer, so the
    // exclusion is applied to the joined post rather than to the bookmark row.
    const postFilter = await this.blocksService.injectBlockFilter(
      userId,
      { deletedAt: null },
      'authorId',
    );
    // Compound keyset cursor "<iso>__<postId>" — postId is unique within a
    // user's bookmarks, so it's a stable tiebreaker for equal createdAt.
    let cursorDate: Date | undefined = undefined;
    let cursorPostId: string | undefined = undefined;
    if (cursor) {
      const delimiter = cursor.includes('|') ? '|' : '__';
      const [datePart, idPart] = cursor.split(delimiter);
      const parsed = new Date(datePart);
      if (!isNaN(parsed.getTime()) && datePart.includes('T')) {
        cursorDate = parsed;
        cursorPostId = idPart || undefined;
      } else {
        const cursorBookmark = await this.prisma.postBookmark.findFirst({
          where: { userId, postId: cursor },
          select: { createdAt: true, postId: true },
        });
        if (cursorBookmark) {
          cursorDate = cursorBookmark.createdAt;
          cursorPostId = cursorBookmark.postId;
        }
      }
    }

    const bookmarks = await this.prisma.postBookmark.findMany({
      where: {
        userId,
        post: postFilter,
        ...(cursorDate
          ? cursorPostId
            ? {
                OR: [
                  { createdAt: { lt: cursorDate } },
                  { createdAt: cursorDate, postId: { lt: cursorPostId } },
                ],
              }
            : { createdAt: { lt: cursorDate } }
          : {}),
      },
      take: limit + 1,
      orderBy: [{ createdAt: 'desc' }, { postId: 'desc' }],
      include: {
        post: {
          include: {
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
            media: true,
            pollOptions: {
              orderBy: { id: 'asc' },
              include: { _count: { select: { votes: true } } },
            },
            pollVotes: userId ? { where: { userId } } : false,
          },
        },
      },
    });

    let nextCursor: string | undefined = undefined;
    if (bookmarks.length > limit) {
      const nextItem = bookmarks.pop();
      nextCursor = nextItem
        ? `${nextItem.createdAt.toISOString()}|${nextItem.postId}`
        : undefined;
    }

    if (bookmarks.length === 0) {
      return { posts: [], nextCursor: undefined };
    }

    const postIds = bookmarks.map((b) => b.postId).filter(Boolean);

    const userLikes = await this.prisma.postLike.findMany({
      where: { userId, postId: { in: postIds } },
      select: { postId: true },
    });

    const likedSet = new Set(userLikes.map((l) => l.postId));
    const bookmarkedSet = new Set(postIds);

    const formattedPosts = bookmarks
      .map((b) => {
        if (!b.post || b.post.deletedAt) return null;
        return this.formatPost(b.post, likedSet, bookmarkedSet, userId);
      })
      .filter(Boolean);

    await this.attachCanDelete(formattedPosts, userId);
    return { posts: formattedPosts, nextCursor };
  }

  async voteInPoll(
    postId: string,
    userId: string,
    dto: { optionId?: string; indices?: number[]; index?: number },
  ) {
    const [post, excludedUserIds] = await Promise.all([
      this.prisma.post.findUnique({
        where: { id: postId },
        include: {
          pollOptions: {
            orderBy: { id: 'asc' },
            include: {
              _count: { select: { votes: true } },
            },
          },
        },
      }),
      this.blocksService.getExcludedUserIds(userId),
    ]);

    if (!post || post.deletedAt || excludedUserIds.includes(post.authorId)) {
      throw new NotFoundException('Post not found');
    }

    const pollOptions = post.pollOptions || [];
    if (pollOptions.length === 0) {
      throw new NotFoundException('Poll not found for this post');
    }

    // Sort options deterministically to map index reliably
    const sortedOptions = [...pollOptions].sort((a: any, b: any) =>
      (a.id || '').localeCompare(b.id || ''),
    );

    let targetOption: any = null;
    if (dto.optionId) {
      targetOption = sortedOptions.find((o: any) => o.id === dto.optionId);
    } else if (Array.isArray(dto.indices) && dto.indices.length > 0) {
      const idx = dto.indices[0];
      targetOption = sortedOptions[idx];
    } else if (typeof dto.index === 'number') {
      targetOption = sortedOptions[dto.index];
    }

    if (!targetOption) {
      throw new BadRequestException('Invalid poll option selected');
    }

    const lockKey = `toggle:pollvote:${userId}:${postId}`;

    return this.redisService.withLock(lockKey, 3000, async () => {
      // Check if user has already voted
      const existingVote = await this.prisma.pollVote.findUnique({
        where: { postId_userId: { postId, userId } },
      });

      if (existingVote) {
        throw new BadRequestException('You have already voted in this poll');
      }

      // Execute vote in transaction
      await this.prisma.$transaction([
        this.prisma.pollVote.create({
          data: {
            postId,
            optionId: targetOption.id,
            userId,
          },
        }),
        this.prisma.pollOption.update({
          where: { id: targetOption.id },
          data: { voteCount: { increment: 1 } },
        }),
      ]);

      // Fetch fresh options after vote
      const updatedOptionsRaw = await this.prisma.pollOption.findMany({
        where: { postId },
        include: { _count: { select: { votes: true } } },
      });
      const updatedSortedOptions = [...updatedOptionsRaw].sort(
        (a: any, b: any) => (a.id || '').localeCompare(b.id || ''),
      );

      const options = updatedSortedOptions.map((opt: any) => ({
        id: opt.id,
        text: opt.text,
        votes: Number(opt.voteCount ?? opt._count?.votes ?? 0),
      }));
      const totalVotes = options.reduce(
        (sum: number, o: any) => sum + o.votes,
        0,
      );
      const userVotedIndex = options.findIndex(
        (o: any) => o.id === targetOption.id,
      );
      const myVotes = userVotedIndex >= 0 ? [userVotedIndex] : [];
      const selectedUsers = { [userId]: myVotes };

      const updatedPoll = {
        question: post.text,
        options,
        totalVotes,
        userVotedOptionId: targetOption.id,
        votedOptionIndex: userVotedIndex,
        myVotes,
        selectedUsers,
      };

      // Real-time broadcast
      this.domainEventService.emit('post.pollVoted', {
        postId,
        userId,
        poll: updatedPoll,
      });

      return {
        success: true,
        postId,
        poll: updatedPoll,
      };
    });
  }
}
