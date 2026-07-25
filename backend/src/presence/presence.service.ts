import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import Redis from 'ioredis';

export interface UserPresence {
  lastSeen: string;
  status: 'online' | 'idle' | 'offline';
  socketIds: string[];
}

@Injectable()
export class PresenceService {
  private redis: Redis | null = null;
  private readonly logger = new Logger('PRESENCE');

  constructor(private readonly redisService: RedisService) {
    this.redis = this.redisService.getClient();
    if (this.redis) {
      this.logger.log('Redis connected for Presence Service');
    } else {
      this.logger.warn('Redis not configured. Presence features will be mocked in-memory.');
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
        const data = await this.redis.get(key);
        let presence: UserPresence | null = data ? JSON.parse(data) : null;
        
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
        
        await this.redis.set(key, JSON.stringify(presence));
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
        const data = await this.redis.get(key);
        const presence: UserPresence | null = data ? JSON.parse(data) : null;
        
        if (presence) {
          presence.socketIds = presence.socketIds.filter(id => id !== socketId);
          presence.lastSeen = new Date().toISOString();
          if (presence.socketIds.length === 0) {
            presence.status = 'offline';
            this.logger.log(`Offline user=${userId}`);
          }
          await this.redis.set(key, JSON.stringify(presence));
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
        const data = await this.redis.get(key);
        return data ? JSON.parse(data) : null;
      } else {
        return this.memoryPresence.get(userId) || null;
      }
    } catch (err) {
      this.logger.error(`Failed to get presence for ${userId}`, err);
      return null;
    }
  }

  async getPresenceMany(userIds: string[]): Promise<Map<string, UserPresence>> {
    const result = new Map<string, UserPresence>();
    if (!userIds || userIds.length === 0) return result;
    try {
      if (this.redis) {
        const keys = userIds.map(uId => this.getPresenceKey(uId));
        const values = await this.redis.mget(...keys);
        userIds.forEach((uId, idx) => {
          const val = values[idx];
          if (val) {
            try {
              result.set(uId, JSON.parse(val));
            } catch {}
          }
        });
      } else {
        userIds.forEach(uId => {
          const pres = this.memoryPresence.get(uId);
          if (pres) result.set(uId, pres);
        });
      }
    } catch (err) {
      this.logger.error(`Failed to get batch presence`, err);
    }
    return result;
  }
}
