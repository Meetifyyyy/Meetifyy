import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CreateNotificationDto } from './notification.factory';
import { NotificationType, Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('NOTIF');
  private redis: Redis | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly configService: ConfigService,
  ) {
    const redisUrl = this.configService.get<string>('UPSTASH_REDIS_REST_URL');
    const redisToken = this.configService.get<string>('UPSTASH_REDIS_REST_TOKEN');

    if (redisUrl && redisToken && !redisUrl.includes('placeholder')) {
      this.redis = new Redis({
        url: redisUrl,
        token: redisToken,
      });
      this.logger.log('Redis connected');
    }
  }

  private async incrementUnreadCount(userId: string) {
    if (!this.redis) return;
    const redisKey = `notifications:unread:${userId}`;
    try {
      const exists = await this.redis.exists(redisKey);
      if (exists) {
        await this.redis.incr(redisKey);
      }
    } catch (err) {
      this.logger.error('Failed to increment unread count in Redis', err);
    }
  }

  private async decrementUnreadCount(userId: string) {
    if (!this.redis) return;
    const redisKey = `notifications:unread:${userId}`;
    try {
      const exists = await this.redis.exists(redisKey);
      if (exists) {
        const countStr = await this.redis.get<string>(redisKey);
        if (countStr && parseInt(countStr, 10) > 0) {
          await this.redis.decr(redisKey);
        }
      }
    } catch (err) {
      this.logger.error('Failed to decrement unread count in Redis', err);
    }
  }

  private async setUnreadCountZero(userId: string) {
    if (!this.redis) return;
    const redisKey = `notifications:unread:${userId}`;
    try {
      await this.redis.set(redisKey, '0', { ex: 3600 });
    } catch (err) {
      this.logger.error('Failed to set unread count to 0 in Redis', err);
    }
  }

  async createNotification(dto: CreateNotificationDto) {
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
      // 1. Check Preferences
      const prefs = await this.prisma.notificationPreferences.findUnique({
        where: { userId: dto.recipientId },
      });

      if (prefs) {
        if (dto.type === NotificationType.LIKE || dto.type === NotificationType.COMMENT_LIKE) {
          if (!prefs.likes) return null;
        }
        if (dto.type === NotificationType.COMMENT && !prefs.comments) return null;
        if (dto.type === NotificationType.MENTION && !prefs.mentions) return null;
        if (dto.type === NotificationType.MESSAGE && !prefs.messages) return null;
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
            this.realtimeGateway.emitNotification(dto.recipientId, updated);
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
        const actor = await this.prisma.user.findUnique({
          where: { id: notification.actorId },
          select: { id: true, username: true, displayName: true, avatar: true },
        });
        populatedNotif = { ...notification, actor };
      }

      this.realtimeGateway.emitNotification(dto.recipientId, populatedNotif);
      await this.incrementUnreadCount(dto.recipientId);
      await this.emitUnreadCount(dto.recipientId);

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
      where: { recipientId: userId, deletedAt: null, type: { not: 'MESSAGE' } },
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
        const cached = await this.redis.get<string>(redisKey);
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
        await this.redis.set(redisKey, count.toString(), { ex: 3600 });
      } catch (err) {
        this.logger.error('Failed to cache count in Redis', err);
      }
    }

    return { count };
  }

  async emitUnreadCount(userId: string) {
    const { count } = await this.getUnreadCount(userId);
    this.realtimeGateway.emitUnreadCount(userId, count);
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
    if (!notification.readAt) {
      await this.decrementUnreadCount(userId);
    }
    await this.emitUnreadCount(userId);
    return updated;
  }

  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { recipientId: userId, readAt: null, deletedAt: null },
      data: { readAt: new Date() },
    });
    await this.setUnreadCountZero(userId);
    await this.emitUnreadCount(userId);
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
    
    if (!notification.readAt) {
      await this.decrementUnreadCount(userId);
    }
    await this.emitUnreadCount(userId);
    return { success: true };
  }
}
