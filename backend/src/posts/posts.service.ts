import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { BlocksService } from '../users/blocks.service';
import { DomainEventService } from '../events/domain-event.service';
import { RedisService } from '../redis/redis.service';

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
  ) {}

  private formatPost(post: any, likedSet: Set<string>, bookmarkedSet: Set<string>) {
    const isLiked = likedSet.has(post.id);
    const isBookmarked = bookmarkedSet.has(post.id);
    const likeCount = post.likeCount ?? 0;
    const commentCount = post.commentCount ?? 0;

    return {
      ...post,
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

  async createPost(authorId: string, text: string, mediaKey?: string, communityId?: string, poll?: any, mentions?: any[]) {
    if (communityId) {
      const comm = await this.prisma.community.findUnique({
        where: { id: communityId },
        select: { id: true, deletedAt: true },
      });
      if (!comm || comm.deletedAt) {
        throw new NotFoundException('Community not found or has been deleted');
      }
    }

    const post = await this.prisma.post.create({
      data: {
        authorId,
        text,
        communityId,
        media: mediaKey ? {
          connect: { objectKey: mediaKey.replace('/api/media/', '') }
        } : undefined,
      },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
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

    if (poll && Array.isArray(poll.options) && poll.options.length > 0) {
      await this.prisma.pollOption.createMany({
        data: poll.options.map((opt: string) => ({
          postId: post.id,
          text: opt,
        })),
      });
    }
    
    this.domainEventService.emit('post.created', { postId: post.id, authorId, communityId: post.communityId || undefined, post });
    return post;
  }

  async deletePost(postId: string, userId: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');
    if (post.authorId !== userId) throw new ForbiddenException('Not your post');

    await this.prisma.$transaction([
      this.prisma.post.update({ where: { id: postId }, data: { deletedAt: new Date() } }),
      this.prisma.comment.updateMany({ where: { postId }, data: { deletedAt: new Date() } }),
      this.prisma.postBookmark.deleteMany({ where: { postId } }),
    ]);

    this.domainEventService.emit('post.deleted', { postId, communityId: post.communityId || undefined });

    return { success: true };
  }

  async getFeed(userId: string, limit = 10, cursor?: string, communityId?: string) {
    if (communityId) {
      const community = await this.prisma.community.findUnique({
        where: { id: communityId },
        select: { id: true, isPrivate: true, isCampusCommunity: true, collegeId: true, ownerId: true }
      });
      if (community) {
        if (community.isCampusCommunity && community.collegeId) {
          const user = userId ? await this.prisma.user.findUnique({ where: { id: userId }, select: { collegeId: true } }) : null;
          if (!user || user.collegeId !== community.collegeId) {
            return { posts: [], nextCursor: undefined };
          }
        }
        if (community.isPrivate) {
          const isOwner = userId && community.ownerId === userId;
          const isMember = userId ? await this.prisma.communityMember.findUnique({
            where: { userId_communityId: { userId, communityId } }
          }) : null;
          if (!isOwner && !isMember) {
            return { posts: [], nextCursor: undefined };
          }
        }
      }
    }

    const excludedUserIds = userId ? await this.blocksService.getExcludedUserIds(userId) : [];
    let cursorDate: Date | undefined = undefined;
    if (cursor) {
      const parsed = new Date(cursor);
      if (!isNaN(parsed.getTime()) && cursor.includes('T')) {
        cursorDate = parsed;
      } else {
        const cursorPost = await this.prisma.post.findUnique({ where: { id: cursor }, select: { createdAt: true } });
        if (cursorPost) cursorDate = cursorPost.createdAt;
      }
    }

    const fetchLimit = limit + 1;

    const rawPosts: any[] = await this.prisma.$queryRaw`
      SELECT 
        p.id,
        p."authorId",
        p."communityId",
        p.text,
        p."likeCount",
        p."commentCount",
        p."createdAt",
        p."updatedAt",
        JSON_BUILD_OBJECT(
          'id', u.id,
          'username', u.username,
          'displayName', u."displayName",
          'avatar', u.avatar
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
        CASE WHEN ${userId ? userId : ''}::text != '' THEN
          EXISTS(SELECT 1 FROM "PostLike" pl WHERE pl."userId" = ${userId || ''} AND pl."postId" = p.id)
        ELSE false END AS "isLiked",
        CASE WHEN ${userId ? userId : ''}::text != '' THEN
          EXISTS(SELECT 1 FROM "PostBookmark" pb WHERE pb."userId" = ${userId || ''} AND pb."postId" = p.id)
        ELSE false END AS "isBookmarked"
      FROM "Post" p
      JOIN "User" u ON p."authorId" = u.id
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
        ${cursorDate ? Prisma.sql`AND p."createdAt" < ${cursorDate}` : Prisma.empty}
        ${excludedUserIds.length > 0 ? Prisma.sql`AND p."authorId" NOT IN (${Prisma.join(excludedUserIds)})` : Prisma.empty}
      ORDER BY p."createdAt" DESC
      LIMIT ${fetchLimit};
    `;

    let nextCursor: string | undefined = undefined;
    if (rawPosts.length > limit) {
      const nextItem = rawPosts.pop();
      nextCursor = nextItem?.createdAt ? new Date(nextItem.createdAt).toISOString() : undefined;
    }

    if (rawPosts.length === 0) {
      return { posts: [], nextCursor: undefined };
    }

    const formattedPosts = rawPosts.map((post) => {
      const isLiked = !!post.isLiked;
      const isBookmarked = !!post.isBookmarked;
      const likeCount = Number(post.likeCount ?? 0);
      const commentCount = Number(post.commentCount ?? 0);

      return {
        id: post.id,
        authorId: post.authorId,
        communityId: post.communityId,
        text: post.text,
        likeCount,
        likesCount: likeCount,
        commentCount,
        commentsCount: commentCount,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
        author: post.author,
        media: post.media || [],
        hasLiked: isLiked,
        isLiked: isLiked,
        isLikedByMe: isLiked,
        hasBookmarked: isBookmarked,
        isBookmarked: isBookmarked,
      };
    });

    return {
      posts: formattedPosts,
      nextCursor,
    };
  }

  async getUserPosts(userId: string, username: string, limit = 10, cursor?: string) {
    const targetAuthor = await this.prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
      select: { id: true }
    });
    if (!targetAuthor) return { posts: [], nextCursor: undefined };

    const excludedUserIds = userId ? await this.blocksService.getExcludedUserIds(userId) : [];
    if (excludedUserIds.includes(targetAuthor.id)) return { posts: [], nextCursor: undefined };

    let cursorDate: Date | undefined = undefined;
    if (cursor) {
      const parsed = new Date(cursor);
      if (!isNaN(parsed.getTime()) && cursor.includes('T')) {
        cursorDate = parsed;
      } else {
        const cursorPost = await this.prisma.post.findUnique({ where: { id: cursor }, select: { createdAt: true } });
        if (cursorPost) cursorDate = cursorPost.createdAt;
      }
    }

    const posts = await this.prisma.post.findMany({
      take: limit + 1,
      where: {
        deletedAt: null,
        authorId: targetAuthor.id,
        communityId: null, // STRICTLY ONLY PROFILE POSTS — NO COMMUNITY POSTS
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {})
      },
      orderBy: { createdAt: 'desc' },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
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
      },
    });

    let nextCursor: string | undefined = undefined;
    if (posts.length > limit) {
      const nextItem = posts.pop();
      nextCursor = nextItem?.createdAt.toISOString();
    }

    if (posts.length === 0) {
      return { posts: [], nextCursor: undefined };
    }

    const postIds = posts.map(p => p.id);

    const [userLikes, userBookmarks] = await Promise.all([
      userId ? this.prisma.postLike.findMany({
        where: { userId, postId: { in: postIds } },
        select: { postId: true }
      }) : [],
      userId ? this.prisma.postBookmark.findMany({
        where: { userId, postId: { in: postIds } },
        select: { postId: true }
      }) : [],
    ]);

    const likedSet = new Set(userLikes.map(l => l.postId));
    const bookmarkedSet = new Set(userBookmarks.map(b => b.postId));

    const formattedPosts = posts.map((post) => this.formatPost(post, likedSet, bookmarkedSet));

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
    if (!post || post.deletedAt || excludedUserIds.includes(post.authorId)) throw new NotFoundException('Post not found');

    const lockKey = `toggle:like:${userId}:${postId}`;

    return this.redisService.withLock(lockKey, 2000, async () => {
      // Fully atomic: INSERT ... ON CONFLICT DO NOTHING — never throws P2002
      const inserted = await this.prisma.$executeRaw`
        INSERT INTO "PostLike" ("userId", "postId", "createdAt")
        VALUES (${userId}, ${postId}, NOW())
        ON CONFLICT ("userId", "postId") DO NOTHING
      `;

      let updatedCount = post.likeCount;
      if (inserted === 1) {
        const updated = await this.prisma.post.update({
          where: { id: postId },
          data: { likeCount: { increment: 1 } },
          select: { likeCount: true },
        });
        updatedCount = updated.likeCount;

        if (post.authorId !== userId) {
          this.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, displayName: true, username: true, avatar: true },
          }).then(actor => {
            if (actor) {
              const dto = this.notificationFactory.createLike(actor, post, post.authorId);
              this.notificationsService.createNotification(dto).catch(err => {
                this.logger.warn('Failed to send like notification', err);
              });
            }
          }).catch(err => {
            this.logger.warn('Failed to fetch actor for like notification', err);
          });
        }

        this.domainEventService.emit('post.liked', { postId, userId, likeCount: updatedCount }, [post.authorId]);
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
    const [post, existingLike] = await Promise.all([
      this.prisma.post.findUnique({ where: { id: postId } }),
      this.prisma.postLike.findUnique({ where: { userId_postId: { userId, postId } } })
    ]);
    if (!post || post.deletedAt) throw new NotFoundException('Post has been deleted');

    let updatedCount = post.likeCount;
    if (existingLike) {
      const [, updated] = await this.prisma.$transaction([
        this.prisma.postLike.deleteMany({
          where: { userId, postId },
        }),
        this.prisma.post.update({
          where: { id: postId },
          data: { likeCount: { decrement: 1 } },
          select: { likeCount: true },
        }),
      ]);
      updatedCount = updated.likeCount;
      
      this.domainEventService.emit('post.unliked', { postId, userId, likeCount: updatedCount }, [post.authorId]);
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
  }

  async deleteComment(commentId: string, userId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: { _count: { select: { replies: { where: { isDeleted: false } } } } },
    });

    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.isDeleted) throw new NotFoundException('Comment already deleted');
    if (comment.authorId !== userId) throw new ForbiddenException('Not your comment');

    const hasActiveReplies = (comment as any)._count.replies > 0;

    await this.prisma.comment.update({
      where: { id: commentId },
      data: {
        isDeleted: true,
        deletedByUser: true,
        deletedAt: new Date(),
        // Scrub content and attribution — preserve only structural fields
        text: '',
        authorId: comment.authorId, // keep FK to avoid cascade issues
        likeCount: 0,
      },
    });

    // Only decrement post comment counter when the comment isn't a structural placeholder
    if (!hasActiveReplies) {
      await this.prisma.post.update({
        where: { id: comment.postId },
        data: { commentCount: { decrement: 1 } },
      }).catch(() => {}); // best-effort — don't fail the whole operation
    }

    // Remove all likes on this comment
    await this.prisma.commentLike.deleteMany({ where: { commentId } }).catch(() => {});

    this.domainEventService.emit('comment.deleted', { commentId, postId: comment.postId, userId });

    return { success: true, isDeleted: true, hasActiveReplies };
  }

  async likeComment(commentId: string, userId: string) {
    const comment = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment || comment.isDeleted) throw new NotFoundException('Comment has been deleted');

    const post = await this.prisma.post.findUnique({ where: { id: comment.postId } });
    if (!post || post.deletedAt) throw new NotFoundException('Post has been deleted');

    const existingLike = await this.prisma.commentLike.findUnique({
      where: { userId_commentId: { userId, commentId } },
    });

    if (!existingLike) {
      await this.prisma.$transaction([
        this.prisma.commentLike.create({ data: { userId, commentId } }),
        this.prisma.comment.update({
          where: { id: commentId },
          data: { likeCount: { increment: 1 } },
        }),
      ]);

      if (comment.authorId !== userId) {
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, displayName: true, username: true, avatar: true },
        }).then(actor => {
          if (actor) {
            const dto = this.notificationFactory.createCommentLike(actor, comment, comment.authorId);
            this.notificationsService.createNotification(dto).catch(err => {
              this.logger.warn('Failed to send comment like notification', err);
            });
          }
        }).catch(err => {
          this.logger.warn('Failed to fetch actor for comment like notification', err);
        });
      }

      this.domainEventService.emit('comment.liked', { commentId, postId: comment.postId, userId });
    }

    return { success: true };
  }

  async unlikeComment(commentId: string, userId: string) {
    const comment = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment || comment.isDeleted) throw new NotFoundException('Comment has been deleted');

    const existingLike = await this.prisma.commentLike.findUnique({
      where: { userId_commentId: { userId, commentId } },
    });

    if (existingLike) {
      await this.prisma.$transaction([
        this.prisma.commentLike.delete({
          where: { userId_commentId: { userId, commentId } },
        }),
        this.prisma.comment.update({
          where: { id: commentId },
          data: { likeCount: { decrement: 1 } },
        }),
      ]);
      
      this.domainEventService.emit('comment.unliked', { commentId, postId: comment.postId, userId });
    }

    return { success: true };
  }

  async addComment(postId: string, authorId: string, text: string, parentId?: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    const excludedUserIds = await this.blocksService.getExcludedUserIds(authorId);
    if (!post || post.deletedAt || excludedUserIds.includes(post.authorId)) throw new NotFoundException('Post not found');

    let parentComment: any = null;
    if (parentId) {
      parentComment = await this.prisma.comment.findUnique({ where: { id: parentId } });
    }

    const comment = await this.prisma.$transaction(async (tx) => {
      const createdComment = await tx.comment.create({
        data: {
          postId,
          authorId,
          text,
          parentId,
        },
      });

      await tx.post.update({
        where: { id: postId },
        data: { commentCount: { increment: 1 } },
      });

      return createdComment;
    });

    this.prisma.user.findUnique({
      where: { id: authorId },
      select: { id: true, displayName: true, username: true, avatar: true },
    }).then(actor => {
      if (!actor) return;
      // 1. Notify parent comment author if replying to another comment
      if (parentComment && parentComment.authorId && parentComment.authorId !== authorId) {
        const replyDto = this.notificationFactory.createCommentReply(actor, comment, post, parentComment.authorId);
        this.notificationsService.createNotification(replyDto).catch(err => {
          this.logger.warn('Failed to send comment reply notification', err);
        });
      }

      // 2. Notify post author (if distinct from commenter and parent comment author)
      if (post.authorId !== authorId && (!parentComment || post.authorId !== parentComment.authorId)) {
        const postDto = this.notificationFactory.createComment(actor, comment, post, post.authorId);
        this.notificationsService.createNotification(postDto).catch(err => {
          this.logger.warn('Failed to send comment notification', err);
        });
      }
    }).catch(err => {
      this.logger.warn('Failed to fetch actor for comment notification', err);
    });
    
    this.domainEventService.emit('comment.created', { 
      commentId: comment.id, 
      postId, 
      authorId,
      parentId 
    });

    return comment;
  }

  async getPostMeta(postId: string) {
    return this.prisma.post.findUnique({
      where: { id: postId, deletedAt: null },
      select: { updatedAt: true },
    });
  }

  async getPostById(postId: string, userId: string) {
    // Single parallel burst: fetch block exclusions, core post, media, comments, and user likes/bookmarks together
    const [excludedUserIds, post, media, rawComments, postLike, postBookmark] = await Promise.all([
      userId ? this.blocksService.getExcludedUserIds(userId) : Promise.resolve([] as string[]),
      this.prisma.post.findUnique({
        where: { id: postId, deletedAt: null },
        include: {
          author: { select: { id: true, username: true, displayName: true, avatar: true } },
          community: { select: { id: true, name: true, deletedAt: true } },
        },
      }),
      this.prisma.media.findMany({
        where: { postId },
      }),
      this.prisma.comment.findMany({
        where: {
          postId,
        },
        take: 50,
        include: {
          author: { select: { id: true, username: true, displayName: true, avatar: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      userId ? this.prisma.postLike.findUnique({ where: { userId_postId: { userId, postId } } }) : Promise.resolve(null),
      userId ? this.prisma.postBookmark.findUnique({ where: { userId_postId: { userId, postId } } }) : Promise.resolve(null),
    ]);

    if (
      !post || 
      post.deletedAt || 
      (post.community && post.community.deletedAt) || 
      (excludedUserIds.length > 0 && excludedUserIds.includes(post.authorId))
    ) {
      throw new NotFoundException('Post not found');
    }

    // Only fetch likes for non-deleted comments
    const liveComments = rawComments.filter(c => !c.isDeleted);
    const commentIds = liveComments.map(c => c.id);

    // Round-trip 2: fetch comment likes in parallel
    const commentLikes = userId && commentIds.length > 0
      ? await this.prisma.commentLike.findMany({
          where: { userId, commentId: { in: commentIds } },
          select: { commentId: true },
        })
      : [];

    const likedComments = new Set(commentLikes.map(l => l.commentId));
    const isLiked = !!postLike;
    const isBookmarked = !!postBookmark;

    // Shape each comment — scrub private data from soft-deleted placeholders
    const shapedComments = rawComments.map(c => {
      if (c.isDeleted) {
        return {
          id: c.id,
          postId: c.postId,
          parentId: c.parentId,
          createdAt: c.createdAt,
          isDeleted: true,
          deletedByUser: c.deletedByUser,
          removedByOwner: c.removedByOwner,
          // All sensitive fields scrubbed
          text: null,
          author: null,
          authorId: null,
          likeCount: 0,
          hasLiked: false,
          isLiked: false,
          isLikedByMe: false,
        };
      }
      return {
        ...c,
        isDeleted: false,
        hasLiked: likedComments.has(c.id),
        isLiked: likedComments.has(c.id),
        isLikedByMe: likedComments.has(c.id),
      };
    });

    return {
      ...post,
      media,
      comments: shapedComments,
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
    if (!post || post.deletedAt) throw new NotFoundException('Post has been deleted');

    await this.prisma.postBookmark.upsert({
      where: { userId_postId: { userId, postId } },
      update: {},
      create: { userId, postId }
    });
    
    this.domainEventService.emit('post.saved', { postId, userId }, [userId]);
    return { success: true };
  }

  async unbookmarkPost(postId: string, userId: string) {
    const existing = await this.prisma.postBookmark.findUnique({
      where: { userId_postId: { userId, postId } }
    });
    if (existing) {
      await this.prisma.postBookmark.delete({
        where: { userId_postId: { userId, postId } }
      });
      this.domainEventService.emit('post.unsaved', { postId, userId }, [userId]);
    }
    return { success: true };
  }

  async getBookmarks(userId: string, limit = 10, cursor?: string) {
    const excludedUserIds = userId ? await this.blocksService.getExcludedUserIds(userId) : [];
    let cursorDate: Date | undefined = undefined;
    if (cursor) {
      const parsed = new Date(cursor);
      if (!isNaN(parsed.getTime()) && cursor.includes('T')) {
        cursorDate = parsed;
      } else {
        const cursorBookmark = await this.prisma.postBookmark.findFirst({ where: { userId, postId: cursor }, select: { createdAt: true } });
        if (cursorBookmark) cursorDate = cursorBookmark.createdAt;
      }
    }

    const bookmarks = await this.prisma.postBookmark.findMany({
      where: {
        userId,
        post: { deletedAt: null, authorId: { notIn: excludedUserIds } },
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
      },
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
      include: {
        post: {
          include: {
            author: { select: { id: true, username: true, displayName: true, avatar: true } },
            media: true
          }
        }
      }
    });

    let nextCursor: string | undefined = undefined;
    if (bookmarks.length > limit) {
      const nextItem = bookmarks.pop();
      nextCursor = nextItem?.createdAt.toISOString();
    }

    if (bookmarks.length === 0) {
      return { posts: [], nextCursor: undefined };
    }

    const postIds = bookmarks.map(b => b.postId).filter(Boolean);

    const userLikes = await this.prisma.postLike.findMany({
      where: { userId, postId: { in: postIds } },
      select: { postId: true }
    });

    const likedSet = new Set(userLikes.map(l => l.postId));
    const bookmarkedSet = new Set(postIds);

    const formattedPosts = bookmarks.map((b) => {
      if (!b.post || b.post.deletedAt) return null;
      return this.formatPost(b.post, likedSet, bookmarkedSet);
    }).filter(Boolean);

    return { posts: formattedPosts, nextCursor };
  }
}
