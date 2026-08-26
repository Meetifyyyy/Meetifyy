import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RedisService } from '../redis/redis.service';

export interface DomainEventPayload {
  type: string; // e.g., 'follow.created'
  timestamp: string; // ISO string
  data: any; // Arbitrary payload
  targetUserIds?: string[]; // Optional array of user IDs to strictly target (for private events)
}

@Injectable()
export class DomainEventService {
  private readonly logger = new Logger(DomainEventService.name);
  private readonly CHANNEL_NAME = 'meetifyy:domain_events';

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Emits an event locally and publishes it to Redis Pub/Sub for horizontal scaling.
   */
  async emit(type: string, data: any, targetUserIds?: string[]): Promise<void> {
    let resolvedTargets = targetUserIds;
    if (!resolvedTargets || resolvedTargets.length === 0) {
      if (data && typeof data === 'object') {
        const candidates = [
          data.targetUserId,
          data.followingId,
          data.recipientId,
          data.followerId,
          data.userId,
          ...(Array.isArray(data.targetUserIds) ? data.targetUserIds : []),
        ].filter(Boolean);
        if (candidates.length > 0) {
          resolvedTargets = [...new Set(candidates)];
        }
      }
    }

    const payload: DomainEventPayload = {
      type,
      timestamp: new Date().toISOString(),
      data,
      ...(resolvedTargets &&
        resolvedTargets.length > 0 && { targetUserIds: resolvedTargets }),
    };

    // 1. Emit locally via EventEmitter2 (for internal services like Notifications)
    this.eventEmitter.emit(type, payload);

    // 2. Publish to Redis Pub/Sub for RealtimeGateway to broadcast to clients
    const pubClient = this.redisService.getPubClient();
    if (pubClient) {
      try {
        await pubClient.publish(this.CHANNEL_NAME, JSON.stringify(payload));
      } catch (err) {
        this.logger.error(
          `Failed to publish domain event ${type} to Redis`,
          err,
        );
      }
    }
  }
}
