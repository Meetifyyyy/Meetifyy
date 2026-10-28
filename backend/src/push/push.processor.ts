import { Processor } from '@nestjs/bullmq';
import { DrainingWorkerHost } from '../common/queues/draining-worker-host';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PushPlatform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PushAudienceService } from './push-audience.service';
import {
  buildGroupJoinRequestPush,
  buildGroupRemovedPush,
  buildMessagePush,
  buildNotificationPush,
} from './push-payload';
import { WebPushProvider } from './providers/web-push.provider';
import { FcmProvider } from './providers/fcm.provider';
import {
  GroupJoinRequestPushJob,
  GroupRemovedPushJob,
  MessagePushJob,
  NotificationPushJob,
  PUSH_JOB,
  PUSH_QUEUE,
  PushMessage,
  SendOutcome,
} from './push.types';

/** How long a per-device "already sent" marker lives: longer than every retry. */
const SENT_MARKER_SECONDS = 24 * 60 * 60;

/** Thrown to make BullMQ retry; the devices already sent to are skipped next time. */
export class RetryablePushError extends Error {}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function asNotificationJob(data: unknown): NotificationPushJob | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  return isString(o.notificationId) && isString(o.recipientId)
    ? { notificationId: o.notificationId, recipientId: o.recipientId }
    : null;
}

function asGroupJoinRequestJob(data: unknown): GroupJoinRequestPushJob | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  return isString(o.recipientId) &&
    isString(o.conversationId) &&
    isString(o.requesterId)
    ? {
        recipientId: o.recipientId,
        conversationId: o.conversationId,
        requesterId: o.requesterId,
      }
    : null;
}

function asGroupRemovedJob(data: unknown): GroupRemovedPushJob | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  return isString(o.recipientId) &&
    isString(o.conversationId) &&
    isString(o.removedAt)
    ? {
        recipientId: o.recipientId,
        conversationId: o.conversationId,
        removedAt: o.removedAt,
      }
    : null;
}

function asMessageJob(data: unknown): MessagePushJob | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  return isString(o.recipientId) &&
    isString(o.conversationId) &&
    isString(o.senderId)
    ? {
        recipientId: o.recipientId,
        conversationId: o.conversationId,
        senderId: o.senderId,
      }
    : null;
}

/**
 * Delivers queued pushes: re-authorises (PushAudienceService), builds the
 * privacy-safe payload, and sends one provider call per registered device.
 *
 * Idempotent across retries: a device that already accepted this exact push
 * (same dedupe key) is skipped via a Redis marker, so a retry caused by
 * another device's 503 does not deliver twice. A crash between a provider's
 * success and writing the marker can still produce one duplicate; providers
 * collapse it on the device by tag/topic.
 */
@Processor(PUSH_QUEUE, { concurrency: 5 })
export class PushProcessor extends DrainingWorkerHost {
  private readonly logger = new Logger('PushWorker');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly audience: PushAudienceService,
    private readonly webPush: WebPushProvider,
    private readonly fcm: FcmProvider,
  ) {
    super();
  }

  async process(job: Job<unknown>): Promise<void> {
    if (job.name === PUSH_JOB.notification) {
      const data = asNotificationJob(job.data);
      if (!data) return;
      const input = await this.audience.forNotification(
        data.notificationId,
        data.recipientId,
      );
      const message = input ? buildNotificationPush(input) : null;
      if (!input || !message) return;
      await this.deliver(
        data.recipientId,
        message,
        `n:${input.id}:${job.id ?? ''}`,
      );
      return;
    }
    if (job.name === PUSH_JOB.groupJoinRequest) {
      const data = asGroupJoinRequestJob(job.data);
      if (!data) return;
      const input = await this.audience.forGroupJoinRequest(
        data.recipientId,
        data.conversationId,
        data.requesterId,
      );
      if (!input) return;
      await this.deliver(
        data.recipientId,
        buildGroupJoinRequestPush(input),
        `jr:${data.conversationId}:${data.requesterId}`,
      );
      return;
    }
    if (job.name === PUSH_JOB.groupRemoved) {
      const data = asGroupRemovedJob(job.data);
      if (!data) return;
      const input = await this.audience.forGroupRemoval(
        data.recipientId,
        data.conversationId,
        data.removedAt,
      );
      if (!input) return;
      await this.deliver(
        data.recipientId,
        buildGroupRemovedPush(input),
        `gr:${data.conversationId}:${data.removedAt}`,
      );
      return;
    }
    if (job.name === PUSH_JOB.message) {
      const data = asMessageJob(job.data);
      if (!data) return;
      const found = await this.audience.forMessage(
        data.recipientId,
        data.conversationId,
        data.senderId,
      );
      if (!found) return;
      await this.deliver(
        data.recipientId,
        buildMessagePush(found.input),
        found.dedupeKey,
      );
    }
  }

  private async alreadySent(marker: string): Promise<boolean> {
    const redis = this.redisService.getClient();
    if (!redis) return false;
    try {
      return (await redis.exists(marker)) === 1;
    } catch {
      return false;
    }
  }

  private async markSent(marker: string): Promise<void> {
    const redis = this.redisService.getClient();
    if (!redis) return;
    await redis
      .set(marker, '1', 'EX', SENT_MARKER_SECONDS)
      .catch(() => undefined);
  }

  /** Sends to every device the recipient holds NOW (ownership is re-read here, not at enqueue). */
  async deliver(
    recipientId: string,
    message: PushMessage,
    dedupeKey: string,
  ): Promise<void> {
    const devices = await this.prisma.pushDevice.findMany({
      where: { userId: recipientId },
      select: {
        id: true,
        platform: true,
        token: true,
        p256dh: true,
        auth: true,
      },
    });
    let retry: string | null = null;

    for (const device of devices) {
      const marker = `push:sent:${dedupeKey}:${device.id}`;
      if (await this.alreadySent(marker)) continue;

      let outcome: SendOutcome;
      if (device.platform === PushPlatform.WEB) {
        if (!this.webPush.configured || !device.p256dh || !device.auth)
          continue;
        outcome = await this.webPush.send(
          { endpoint: device.token, p256dh: device.p256dh, auth: device.auth },
          message,
        );
      } else {
        if (!this.fcm.configured) continue;
        outcome = await this.fcm.send(device.token, message);
      }

      switch (outcome.kind) {
        case 'sent':
          await this.markSent(marker);
          break;
        case 'gone':
          // Scoped to the row we read, so a token that has meanwhile moved
          // to another account is not deleted out from under it.
          await this.prisma.pushDevice
            .deleteMany({ where: { id: device.id, userId: recipientId } })
            .catch(() => undefined);
          this.logger.log(
            `push device ${device.id} removed (registration gone)`,
          );
          break;
        case 'retry':
          retry = outcome.reason;
          await this.prisma.pushDevice
            .updateMany({
              where: { id: device.id },
              data: { failureCount: { increment: 1 } },
            })
            .catch(() => undefined);
          break;
        case 'config':
          // Already logged by the provider; retrying will not fix our keys.
          break;
      }
    }

    if (retry) throw new RetryablePushError(retry);
  }
}
