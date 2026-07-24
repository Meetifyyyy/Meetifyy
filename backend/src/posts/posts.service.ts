import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { BlocksService } from '../users/blocks.service';

@Injectable()
export class PostsService {
  private readonly logger = new Logger('PostsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationFactory: NotificationFactory,
    private readonly blocksService: BlocksService
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

  async createPost(authorId: string, text: string, mediaKey?: string, communityId?: string) {
    return this.prisma.post.create({
      data: {
        authorId,
        text,
        communityId,
        media: mediaKey ? {
          create: [{
            ownerId: authorId,
            type: 'IMAGE',
            storageKey: mediaKey
          }]
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
      },
    });
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

    return { success: true };
  }

  async getFeed(userId: string, limit = 10, cursor?: string, communityId?: string) {
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

    const posts = await this.prisma.post.findMany({
      take: limit + 1,
      where: { 
        deletedAt: null,
        authorId: { notIn: excludedUserIds },
        ...(communityId ? { communityId } : {}),
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
        media: true,
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

  async getUserPosts(userId: string, username: string, limit = 10, cursor?: string) {
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

    const posts = await this.prisma.post.findMany({
      take: limit + 1,
      where: {
        deletedAt: null,
        author: { username },
        authorId: { notIn: excludedUserIds },
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
        media: true,
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
    const [post, existingLike] = await Promise.all([
      this.prisma.post.findUnique({ where: { id: postId } }),
      this.prisma.postLike.findUnique({ where: { userId_postId: { userId, postId } } })
    ]);
    const excludedUserIds = await this.blocksService.getExcludedUserIds(userId);
    if (!post || post.deletedAt || excludedUserIds.includes(post.authorId)) throw new NotFoundException('Post not found');

    let updatedCount = post.likeCount;
    if (!existingLike) {
      const [, updated] = await this.prisma.$transaction([
        this.prisma.postLike.create({ data: { userId, postId } }),
        this.prisma.post.update({
          where: { id: postId },
          data: { likeCount: { increment: 1 } },
          select: { likeCount: true },
        }),
      ]);
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
        this.prisma.postLike.delete({
          where: { userId_postId: { userId, postId } },
        }),
        this.prisma.post.update({
          where: { id: postId },
          data: { likeCount: { decrement: 1 } },
          select: { likeCount: true },
        }),
      ]);
      updatedCount = updated.likeCount;
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

  async likeComment(commentId: string, userId: string) {
    const comment = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment || comment.deletedAt) throw new NotFoundException('Comment has been deleted');

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
    }

    return { success: true };
  }

  async unlikeComment(commentId: string, userId: string) {
    const comment = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment || comment.deletedAt) throw new NotFoundException('Comment has been deleted');

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

    return comment;
  }

  async getPostMeta(postId: string) {
    return this.prisma.post.findUnique({
      where: { id: postId, deletedAt: null },
      select: { updatedAt: true },
    });
  }

  async getPostById(postId: string, userId: string) {
    const excludedUserIds = userId ? await this.blocksService.getExcludedUserIds(userId) : [];
    // Round-trip 1: parallelized fetch of core post, its media, comments, and current user likes/bookmarks
    const [post, media, comments, postLike, postBookmark] = await Promise.all([
      this.prisma.post.findUnique({
        where: { id: postId, deletedAt: null },
        include: {
          author: { select: { id: true, username: true, displayName: true, avatar: true } },
        },
      }),
      this.prisma.media.findMany({
        where: { postId },
      }),
      this.prisma.comment.findMany({
        where: { postId, deletedAt: null, authorId: { notIn: excludedUserIds } },
        take: 50,
        include: {
          author: { select: { id: true, username: true, displayName: true, avatar: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      userId ? this.prisma.postLike.findUnique({ where: { userId_postId: { userId, postId } } }) : null,
      userId ? this.prisma.postBookmark.findUnique({ where: { userId_postId: { userId, postId } } }) : null,
    ]);

    if (!post || (excludedUserIds.length > 0 && excludedUserIds.includes(post.authorId))) throw new NotFoundException('Post not found');

    const commentIds = comments.map(c => c.id);

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

    return {
      ...post,
      media,
      comments: comments.map(c => ({
        ...c,
        hasLiked: likedComments.has(c.id),
        isLiked: likedComments.has(c.id),
        isLikedByMe: likedComments.has(c.id),
      })),
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

    const [userLikes, userBookmarks] = await Promise.all([
      this.prisma.postLike.findMany({
        where: { userId, postId: { in: postIds } },
        select: { postId: true }
      }),
      this.prisma.postBookmark.findMany({
        where: { userId, postId: { in: postIds } },
        select: { postId: true }
      }),
    ]);

    const likedSet = new Set(userLikes.map(l => l.postId));
    const bookmarkedSet = new Set(userBookmarks.map(b => b.postId));

    const formattedPosts = bookmarks.map((b) => {
      if (!b.post || b.post.deletedAt) return null;
      return this.formatPost(b.post, likedSet, bookmarkedSet);
    }).filter(Boolean);

    return { posts: formattedPosts, nextCursor };
  }
}
