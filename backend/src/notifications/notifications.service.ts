import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventService, DomainEventPayload } from '../events/domain-event.service';
import { CreateNotificationDto } from './notification.factory';
import { NotificationType, Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import Redis from 'ioredis';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger('NOTIF');
  private redis: Redis | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly domainEventService: DomainEventService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.redis = this.redisService.getClient();
    if (this.redis) {
      this.logger.log('Redis connected for Notifications Service');
    }
  }

  onModuleInit() {
    // Follow notifications are now handled by BullMQ (NotificationsProcessor).
    // The follow.created event is still emitted for real-time socket broadcasts
    // (presence updates, feed invalidation) but notification creation is decoupled.

    // Unfollow: cancel notification when user unfollows
    this.eventEmitter.on('follow.deleted', async (payload: DomainEventPayload) => {
      const { followerId, followingId } = payload.data || {};
      if (!followerId || !followingId) return;
      await this.cancelNotificationByCriteria({
        recipientId: followingId,
        actorId: followerId,
        entityId: followerId,
        type: 'FOLLOW' as any,
      }).catch(err => this.logger.warn('Failed to reconcile follow.deleted event', err));
    });

    // 2. Post Like / Unlike Reconciliation
    this.eventEmitter.on('post.unliked', async (payload: DomainEventPayload) => {
      const { postId, userId } = payload.data || {};
      if (!postId || !userId) return;
      const post = await this.prisma.post.findUnique({ where: { id: postId }, select: { authorId: true } });
      if (post && post.authorId !== userId) {
        await this.cancelNotificationByCriteria({
          recipientId: post.authorId,
          actorId: userId,
          entityId: postId,
          type: 'LIKE' as any,
        }).catch(err => this.logger.warn('Failed to reconcile post.unliked event', err));
      }
    });

    // 3. Comment Like / Unlike Reconciliation
    this.eventEmitter.on('comment.unliked', async (payload: DomainEventPayload) => {
      const { commentId, userId } = payload.data || {};
      if (!commentId || !userId) return;
      const comment = await this.prisma.comment.findUnique({ where: { id: commentId }, select: { authorId: true } });
      if (comment && comment.authorId !== userId) {
        await this.cancelNotificationByCriteria({
          recipientId: comment.authorId,
          actorId: userId,
          entityId: commentId,
          type: 'COMMENT_LIKE' as any,
        }).catch(err => this.logger.warn('Failed to reconcile comment.unliked event', err));
      }
    });
  }

  /**
   * Atomically increments the unread count — but ONLY if the key already exists.
   * Uses a Lua script (identical approach to decrementUnreadCount) to ensure
   * the EXISTS check and the INCR happen in a single atomic Redis round-trip,
   * eliminating the TOCTOU race that the previous EXISTS+INCR pipeline had.
   * Returns the new count if incremented, or null if the key was absent.
   */
  private async incrementUnreadCount(userId: string): Promise<number | null> {
    if (!this.redis) return null;
    const redisKey = `notifications:unread:${userId}`;
    // Lua: only increment if the key exists (non-false GET means key present)
    const luaScript = `
      local v = redis.call('GET', KEYS[1])
      if v == false then return nil end
      return redis.call('INCR', KEYS[1])
    `;
    try {
      const result = await (this.redis as any).eval(luaScript, 1, redisKey) as number | null;
      return result;
    } catch (err) {
      this.logger.error('Failed to increment unread count in Redis', err);
      return null;
    }
  }

  /**
   * Decrements unread count using a Lua script so the whole read-check-decr
   * is atomic in a single round-trip.
   * Returns the new count if decremented, or null.
   */
  private async decrementUnreadCount(userId: string): Promise<number | null> {
    if (!this.redis) return null;
    const redisKey = `notifications:unread:${userId}`;
    // Lua: only decrement if the key exists and value > 0.
    const luaScript = `
      local v = redis.call('GET', KEYS[1])
      if v == false then return nil end
      local n = tonumber(v)
      if n == nil or n <= 0 then return 0 end
      return redis.call('DECR', KEYS[1])
    `;
    try {
      const result = await (this.redis as any).eval(luaScript, 1, redisKey) as number | null;
      return result;
    } catch (err) {
      this.logger.error('Failed to decrement unread count in Redis', err);
      return null;
    }
  }

  private async setUnreadCountZero(userId: string) {
    if (!this.redis) return;
    const redisKey = `notifications:unread:${userId}`;
    try {
      await this.redis.set(redisKey, '0', 'EX', 3600);
    } catch (err) {
      this.logger.error('Failed to set unread count to 0 in Redis', err);
    }
  }

  /**
   * Invalidates the notification preferences cache for a user.
   * Must be called by UsersService whenever notification preferences are updated
   * so the 5-minute cached prefs don't serve stale values.
   */
  async invalidatePrefsCache(userId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(`notif:prefs:${userId}`);
    } catch { /* non-fatal */ }
  }

  async createNotification(dto: CreateNotificationDto) {
    if ((dto.type as any) === 'MESSAGE') {
      return null; // Message updates are handled via real-time message:new flow, not notifications list
    }

    if (dto.recipientId === dto.actorId) {
      return null; // Don't notify self
    }

    if (dto.actorId) {
      const isBlocked = await this.prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: dto.recipientId, blockedId: dto.actorId },
            { blockerId: dto.actorId, blockedId: dto.recipientId },
          ],
        },
      });
      if (isBlocked) return null;
    }

    // Fix BUG-29: Deduplicate system notifications (where actorId is null)
    if (dto.actorId === null) {
      const existingSystemNotif = await this.prisma.notification.findFirst({
        where: {
          recipientId: dto.recipientId,
          actorId: null,
          entityId: dto.entityId,
          type: dto.type,
          deletedAt: null,
        }
      });
      if (existingSystemNotif) {
        return existingSystemNotif;
      }
    }

    try {
      // 1. Check Preferences — cached in Redis for 5 minutes (Fix #5)
      const prefsKey = `notif:prefs:${dto.recipientId}`;
      let prefs: any = null;
      if (this.redis) {
        try {
          const cached = await this.redis.get(prefsKey);
          if (cached) prefs = JSON.parse(cached);
        } catch { /* ignore redis errors */ }
      }
      if (!prefs) {
        prefs = await this.prisma.notificationPreferences.findUnique({
          where: { userId: dto.recipientId },
        });
        if (prefs && this.redis) {
          this.redis.set(prefsKey, JSON.stringify(prefs), 'EX', 300).catch(() => {});
        }
      }

      if (prefs) {
        if (dto.type === NotificationType.LIKE || dto.type === NotificationType.COMMENT_LIKE) {
          if (!prefs.likes) return null;
        }
        if (dto.type === NotificationType.COMMENT && !prefs.comments) return null;
        if (dto.type === NotificationType.MENTION && !prefs.mentions) return null;
        if ((dto.type as any) === 'MESSAGE' && !prefs.messages) return null;
        if (dto.type === NotificationType.JOIN_REQUEST && !prefs.activities) return null;
        if (dto.type === NotificationType.GROUP_INVITE && !prefs.groups) return null;
        if (dto.type === NotificationType.SYSTEM && !prefs.system) return null;
      }

      // 2. Aggregation Logic
      if (dto.type === NotificationType.LIKE || dto.type === NotificationType.COMMENT_LIKE) {
        // Fix BUG-22: Remove readAt: null filter fromaggregation logic
        const existing = await this.prisma.notification.findFirst({
          where: {
            recipientId: dto.recipientId,
            entityId: dto.entityId,
            type: dto.type,
            deletedAt: null,
          },
        });

        if (existing) {
          // Check if actor is already part of it to prevent same-actor spam
          let metadata = existing.metadata as any;
          if (existing.actorId !== dto.actorId) {
            // Aggregate
            const currentCount = metadata?.aggregatedCount || 1;
            metadata = {
              ...metadata,
              aggregatedCount: currentCount + 1,
            };
            const updated = await this.prisma.notification.update({
              where: { id: existing.id },
              data: {
                actorId: dto.actorId, // Make latest actor primary
                metadata,
                readAt: null, // Reset unread status
                updatedAt: new Date(),
              },
            });
            this.domainEventService.emit('notification:new', updated, [dto.recipientId]);
            await this.incrementUnreadCount(dto.recipientId);
            await this.emitUnreadCount(dto.recipientId);
            return updated;
          }
          return existing; // Ignore duplicate like from same user
        }
      }

      // 3. Create or update Notification
      let notification;
      if (dto.type === NotificationType.FOLLOW && dto.actorId && dto.entityId) {
        const existingNotif = await this.prisma.notification.findFirst({
          where: {
            recipientId: dto.recipientId,
            actorId: dto.actorId,
            entityId: dto.entityId,
            type: dto.type,
          },
        });

        if (existingNotif) {
          notification = await this.prisma.notification.update({
            where: { id: existingNotif.id },
            data: {
              title: dto.title,
              body: dto.body,
              metadata: dto.metadata,
              deletedAt: null,
              readAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
        }
      }

      if (!notification) {
        if (dto.actorId && dto.entityId) {
          notification = await this.prisma.notification.upsert({
            where: {
              recipientId_actorId_entityId_type: {
                recipientId: dto.recipientId,
                actorId: dto.actorId,
                entityId: dto.entityId,
                type: dto.type,
              }
            },
            update: {
              title: dto.title,
              body: dto.body,
              metadata: dto.metadata ?? Prisma.DbNull,
              deletedAt: null,
              readAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              expiresAt: dto.expiresAt,
            },
            create: {
              recipientId: dto.recipientId,
              actorId: dto.actorId,
              type: dto.type,
              entityType: dto.entityType,
              entityId: dto.entityId,
              title: dto.title,
              body: dto.body,
              metadata: dto.metadata ?? Prisma.DbNull,
              expiresAt: dto.expiresAt,
            }
          });
        } else {
          notification = await this.prisma.notification.create({
            data: {
              recipientId: dto.recipientId,
              actorId: dto.actorId,
              type: dto.type,
              entityType: dto.entityType,
              entityId: dto.entityId,
              title: dto.title,
              body: dto.body,
              metadata: dto.metadata ?? Prisma.DbNull,
              expiresAt: dto.expiresAt,
            },
          });
        }
      }

      let populatedNotif: any = notification;
      if (notification?.actorId) {
        // Use pre-populated actor if provided by the caller (e.g. BullMQ job) to
        // skip a DB round-trip. Fall back to DB fetch for all other code paths.
        const actor = dto.prePopulatedActor ?? await this.prisma.user.findUnique({
          where: { id: notification.actorId },
          select: { id: true, username: true, displayName: true, avatar: true },
        });
        populatedNotif = { ...notification, actor };
      }

      this.domainEventService.emit('notification:new', populatedNotif, [dto.recipientId]);
      if ((dto.type as any) !== 'MESSAGE') {
        const newCount = await this.incrementUnreadCount(dto.recipientId);
        // Pass newCount to avoid a Redis re-read inside emitUnreadCount
        await this.emitUnreadCount(dto.recipientId, newCount ?? undefined);
      }

      this.logger.log(`Notification delivered type=${dto.type} to=${dto.recipientId}`);

      return populatedNotif;
    } catch (err) {
      if (err.code === 'P2002') {
        this.logger.debug(`Ignored duplicate notification: ${err.message}`);
        return null;
      }
      this.logger.error('Failed to create notification', err);
      throw err;
    }
  }

  async getNotifications(userId: string, limit: number = 20, cursor?: string) {
    const take = limit + 1; // fetch 1 extra to check if there's a next page
    
    const notifications = await this.prisma.notification.findMany({
      where: {
        recipientId: userId,
        deletedAt: null,
        type: {
          notIn: [NotificationType.MESSAGE, NotificationType.JOIN_REQUEST]
        }
      },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        actor: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
      },
    });

    let nextCursor: string | undefined = undefined;
    if (notifications.length > limit) {
      const nextItem = notifications.pop();
      nextCursor = nextItem?.id;
    }

    return {
      data: notifications,
      nextCursor,
    };
  }

  async getUnreadCount(userId: string) {
    const redisKey = `notifications:unread:${userId}`;
    if (this.redis) {
      try {
        const cached = await this.redis.get(redisKey);
        if (cached !== null && cached !== undefined) {
          return { count: parseInt(cached, 10) };
        }
      } catch (err) {
        this.logger.error('Failed to get cached count from Redis', err);
      }
    }

    const count = await this.prisma.notification.count({
      where: { recipientId: userId, readAt: null, deletedAt: null, type: { not: 'MESSAGE' } },
    });

    if (this.redis) {
      try {
        await this.redis.set(redisKey, count.toString(), 'EX', 3600);
      } catch (err) {
        this.logger.error('Failed to cache count in Redis', err);
      }
    }

    return { count };
  }

  async emitUnreadCount(userId: string, knownCount?: number) {
    // If the caller already knows the new count (e.g. just after incr/decr), use it
    // directly to skip the Redis re-read.
    const count = knownCount !== undefined
      ? knownCount
      : (await this.getUnreadCount(userId)).count;
    this.domainEventService.emit('notifications:unread_count', { count }, [userId]);
  }

  async markAsRead(id: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification || notification.recipientId !== userId) {
      throw new NotFoundException('Notification not found');
    }
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
    let newCount: number | null = null;
    if (!notification.readAt) {
      newCount = await this.decrementUnreadCount(userId);
    }
    await this.emitUnreadCount(userId, newCount ?? undefined);
    return updated;
  }

  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { recipientId: userId, readAt: null, deletedAt: null },
      data: { readAt: new Date() },
    });
    await this.setUnreadCountZero(userId);
    await this.emitUnreadCount(userId, 0);
    return { success: true };
  }

  async deleteNotification(id: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification || notification.recipientId !== userId) {
      throw new NotFoundException('Notification not found');
    }
    // Soft delete
    await this.prisma.notification.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    
    let newCount: number | null = null;
    if (!notification.readAt) {
      newCount = await this.decrementUnreadCount(userId);
    }
    await this.emitUnreadCount(userId, newCount ?? undefined);
    return { success: true };
  }

  async cancelNotificationByCriteria(params: {
    recipientId: string;
    actorId?: string;
    entityId?: string;
    type: NotificationType;
  }) {
    const { recipientId, actorId, entityId, type } = params;

    const existing = await this.prisma.notification.findFirst({
      where: {
        recipientId,
        actorId: actorId ?? null,
        entityId: entityId ?? null,
        type,
        deletedAt: null,
      },
    });

    if (!existing) return null;

    const updated = await this.prisma.notification.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    let newCount: number | null = null;
    if (!existing.readAt) {
      newCount = await this.decrementUnreadCount(recipientId);
      await this.emitUnreadCount(recipientId, newCount ?? undefined);
    }

    this.domainEventService.emit('notification:cancelled', {
      notificationId: existing.id,
      recipientId,
    }, [recipientId]);

    this.logger.log(`Notification cancelled type=${type} recipient=${recipientId}`);
    return updated;
  }
}
