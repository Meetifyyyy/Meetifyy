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
  private socketValidator: ((socketId: string) => boolean) | null = null;

  constructor(private readonly redisService: RedisService) {
    this.redis = this.redisService.getClient();
    if (this.redis) {
      this.logger.log('Redis connected for Presence Service');
    } else {
      this.logger.warn('Redis not configured. Presence features will be mocked in-memory.');
    }
  }

  registerSocketValidator(validator: (socketId: string) => boolean) {
    this.socketValidator = validator;
  }

  private cleanPresence(presence: UserPresence | null): UserPresence | null {
    if (!presence) return null;
    if (this.socketValidator && Array.isArray(presence.socketIds)) {
      presence.socketIds = presence.socketIds.filter(id => this.socketValidator!(id));
      if (presence.socketIds.length === 0) {
        presence.status = 'offline';
      }
    }
    return presence;
  }

  // In-memory fallback if Redis is not configured
  private memoryPresence = new Map<string, UserPresence>();

  private getPresenceKey(userId: string): string {
    return `presence:${userId}`;
  }

  private disconnectTimers = new Map<string, NodeJS.Timeout>();

  async setOnline(userId: string, socketId: string): Promise<void> {
    // Cancel any pending disconnect grace timer for this user
    if (this.disconnectTimers.has(userId)) {
      clearTimeout(this.disconnectTimers.get(userId));
      this.disconnectTimers.delete(userId);
    }
    try {
      if (this.redis) {
        const key = this.getPresenceKey(userId);
        const data = await this.redis.get(key);
        let presence: UserPresence | null = data ? JSON.parse(data) : null;
        
        presence = this.cleanPresence(presence);

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
        
        await this.redis.set(key, JSON.stringify(presence), 'EX', 60);
      } else {
        let presence = this.memoryPresence.get(userId) || null;
        presence = this.cleanPresence(presence);
        if (!presence) {
          presence = { lastSeen: new Date().toISOString(), status: 'online', socketIds: [] };
        }

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
        let presence: UserPresence | null = data ? JSON.parse(data) : null;
        
        if (presence) {
          presence.socketIds = presence.socketIds.filter(id => id !== socketId);
          presence = this.cleanPresence(presence);
          if (presence) {
            presence.lastSeen = new Date().toISOString();
            if (presence.socketIds.length === 0) {
              presence.status = 'offline';
              this.logger.log(`Offline user=${userId}`);
            }
            await this.redis.set(key, JSON.stringify(presence), 'EX', 60);
          }
        }
      } else {
        let presence = this.memoryPresence.get(userId) || null;
        if (presence) {
          presence.socketIds = presence.socketIds.filter(id => id !== socketId);
          presence = this.cleanPresence(presence);
          if (presence) {
            presence.lastSeen = new Date().toISOString();
            if (presence.socketIds.length === 0) {
              presence.status = 'offline';
            }
            this.memoryPresence.set(userId, presence);
          }
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
        let presence: UserPresence | null = data ? JSON.parse(data) : null;
        presence = this.cleanPresence(presence);
        if (presence && presence.socketIds.length === 0) {
          presence.status = 'offline';
        }
        return presence;
      } else {
        let presence = this.memoryPresence.get(userId) || null;
        presence = this.cleanPresence(presence);
        if (presence && presence.socketIds.length === 0) {
          presence.status = 'offline';
        }
        return presence;
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
              let pres: UserPresence | null = JSON.parse(val);
              pres = this.cleanPresence(pres);
              if (pres) result.set(uId, pres);
            } catch {}
          }
        });
      } else {
        userIds.forEach(uId => {
          let pres = this.memoryPresence.get(uId) || null;
          pres = this.cleanPresence(pres);
          if (pres) result.set(uId, pres);
        });
      }
    } catch (err) {
      this.logger.error(`Failed to get batch presence`, err);
    }
    return result;
  }
}
