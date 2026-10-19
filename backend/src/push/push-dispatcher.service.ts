import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NotificationType } from '@prisma/client';
import { config } from '../config';
import { RedisService } from '../redis/redis.service';
import { categoryForType } from './push-payload';
import {
  MessagePushJob,
  NotificationPushJob,
  PUSH_JOB,
  PUSH_QUEUE,
} from './push.types';

/** The fields of a committed notification row the dispatcher needs. */
export interface DispatchableNotification {
  id: string;
  recipientId: string;
  actorId: string | null;
  type: NotificationType;
  entityId: string | null;
  updatedAt: Date;
}

/**
 * Like/unlike flapping window: the same actor re-doing the same thing to the
 * same entity within this many seconds re-creates the in-app row (existing
 * upsert semantics) but does not push again.
 */
export const REPEAT_WINDOW_SECONDS = 60 * 60;

/** A message burst within this window becomes one push. */
export const MESSAGE_DEBOUNCE_MS = 3_000;

/**
 * Hands committed events to the push queue.
 *
 * Called only AFTER the action and its notification row have committed, and
 * never awaited by the action: every method here is synchronous, catches
 * everything, and returns nothing. A push provider or Redis being down can
 * therefore neither fail nor slow the like, comment or message that caused it,
 * and cannot remove the in-app notification, which is the durable record.
 *
 * Jobs carry ids only. The worker re-reads everything at send time, so a push
 * for something deleted, unliked, read or no longer visible in the meantime is
 * dropped rather than delivered (PushAudienceService).
 */
@Injectable()
export class PushDispatcherService {
  private readonly logger = new Logger('PushDispatch');

  constructor(
    @InjectQueue(PUSH_QUEUE) private readonly queue: Queue,
    private readonly redisService: RedisService,
  ) {}

  private get active(): boolean {
    return (
      config.push.enabled &&
      (config.push.web.configured || config.push.fcm.configured)
    );
  }

  enqueueForNotification(
    row: DispatchableNotification | null | undefined,
  ): void {
    try {
      if (!row || !this.active) return;
      if (!categoryForType(row.type) || row.type === NotificationType.MESSAGE)
        return;
      if (row.actorId && row.actorId === row.recipientId) return;
      void this.enqueueNotification(row).catch((err) =>
        this.logger.warn(`push enqueue failed: ${String(err)}`),
      );
    } catch (err) {
      this.logger.warn(`push enqueue threw: ${String(err)}`);
    }
  }

  private async enqueueNotification(
    row: DispatchableNotification,
  ): Promise<void> {
    if (row.actorId && !(await this.firstInWindow(row))) return;
    const data: NotificationPushJob = {
      notificationId: row.id,
      recipientId: row.recipientId,
    };
    await this.queue.add(PUSH_JOB.notification, data, {
      // The same row in the same state is one push however many times it is
      // enqueued (a retried caller, the queued + inline invite paths).
      jobId: `n_${row.id}_${row.updatedAt.getTime()}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { age: 3_600, count: 5_000 },
      removeOnFail: { age: 24 * 3_600, count: 1_000 },
    });
  }

  /** Redis SET NX on (recipient, actor, type, entity). Fails open: no Redis, no dedupe here. */
  private async firstInWindow(row: DispatchableNotification): Promise<boolean> {
    const redis = this.redisService.getClient();
    if (!redis) return true;
    const key = `push:dd:${row.recipientId}:${row.actorId ?? '-'}:${row.type}:${row.entityId ?? '-'}`;
    try {
      const set = await redis.set(key, '1', 'EX', REPEAT_WINDOW_SECONDS, 'NX');
      return set === 'OK';
    } catch {
      return true;
    }
  }

  /**
   * One push per recipient and conversation per burst. The job id makes every
   * message in the debounce window collapse into the job already waiting; the
   * worker then reads the recipient's unread count for the text.
   */
  enqueueForMessage(job: MessagePushJob | null | undefined): void {
    try {
      if (!job || !this.active) return;
      if (
        !job.conversationId ||
        !job.recipientId ||
        job.recipientId === job.senderId
      )
        return;
      void this.queue
        .add(PUSH_JOB.message, job, {
          jobId: `m_${job.recipientId}_${job.conversationId}`,
          delay: MESSAGE_DEBOUNCE_MS,
          attempts: 5,
          backoff: { type: 'exponential', delay: 2_000 },
          // Removed either way so the next burst can enqueue under the same id.
          removeOnComplete: true,
          removeOnFail: true,
        })
        .catch((err) =>
          this.logger.warn(`push enqueue failed: ${String(err)}`),
        );
    } catch (err) {
      this.logger.warn(`push enqueue threw: ${String(err)}`);
    }
  }
}
