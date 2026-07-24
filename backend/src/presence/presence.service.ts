import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';

export interface UserPresence {
  lastSeen: string;
  status: 'online' | 'idle' | 'offline';
  socketIds: string[];
}

@Injectable()
export class PresenceService {
  private redis: Redis | null = null;
  private readonly logger = new Logger('PRESENCE');

  constructor(private configService: ConfigService) {
    const redisUrl = this.configService.get<string>('UPSTASH_REDIS_REST_URL');
    const redisToken = this.configService.get<string>('UPSTASH_REDIS_REST_TOKEN');

    if (redisUrl && redisToken && !redisUrl.includes('placeholder')) {
      this.redis = new Redis({
        url: redisUrl,
        token: redisToken,
      });
      this.logger.log('Upstash Redis connected for Presence Service');
    } else {
      this.logger.warn('Upstash Redis not configured. Presence features will be mocked in-memory.');
    }
  }

  // In-memory fallback if Redis is not configured
  private memoryPresence = new Map<string, UserPresence>();

  private getPresenceKey(userId: string): string {
    return `presence:${userId}`;
  }

  async setOnline(userId: string, socketId: string): Promise<void> {
    try {
      if (this.redis) {
        const key = this.getPresenceKey(userId);
        let presence: UserPresence | null = await this.redis.get(key);
        
        if (!presence) {
          presence = { lastSeen: new Date().toISOString(), status: 'online', socketIds: [] };
        }
        
        if (!presence.socketIds.includes(socketId)) {
          presence.socketIds.push(socketId);
        }
        
        presence.lastSeen = new Date().toISOString();
        presence.status = 'online';
        
        if (presence.socketIds.length === 1) {
          this.logger.log(`Online user=${userId}`);
        }
        
        await this.redis.set(key, presence);
      } else {
        const presence = this.memoryPresence.get(userId) || { lastSeen: new Date().toISOString(), status: 'online', socketIds: [] };
        if (!presence.socketIds.includes(socketId)) {
          presence.socketIds.push(socketId);
        }
        presence.lastSeen = new Date().toISOString();
        presence.status = 'online';
        this.memoryPresence.set(userId, presence);
      }
    } catch (err) {
      this.logger.error(`Failed to set online presence for ${userId}`, err);
    }
  }

  async setOffline(userId: string, socketId: string): Promise<void> {
    try {
      if (this.redis) {
        const key = this.getPresenceKey(userId);
        const presence: UserPresence | null = await this.redis.get(key);
        
        if (presence) {
          presence.socketIds = presence.socketIds.filter(id => id !== socketId);
          presence.lastSeen = new Date().toISOString();
          if (presence.socketIds.length === 0) {
            presence.status = 'offline';
            this.logger.log(`Offline user=${userId}`);
          }
          await this.redis.set(key, presence);
        }
      } else {
        const presence = this.memoryPresence.get(userId);
        if (presence) {
          presence.socketIds = presence.socketIds.filter(id => id !== socketId);
          presence.lastSeen = new Date().toISOString();
          if (presence.socketIds.length === 0) {
            presence.status = 'offline';
          }
          this.memoryPresence.set(userId, presence);
        }
      }
    } catch (err) {
      this.logger.error(`Failed to set offline presence for ${userId}`, err);
    }
  }

  async getPresence(userId: string): Promise<UserPresence | null> {
    try {
      if (this.redis) {
        const key = this.getPresenceKey(userId);
        return await this.redis.get(key);
      } else {
        return this.memoryPresence.get(userId) || null;
      }
    } catch (err) {
      this.logger.error(`Failed to get presence for ${userId}`, err);
      return null;
    }
  }
}
