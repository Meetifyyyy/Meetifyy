import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NotificationType } from '@prisma/client';
import { config } from '../config';
import { RedisService } from '../redis/redis.service';
import { categoryForType } from './push-payload';
import {
  GroupJoinRequestPushJob,
  GroupRemovedPushJob,
  GroupJoinApprovedPushJob,
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

  /**
   * Message pushes asked for during the current tick, sent together by
   * flushMessages. A group message asks for one per unmuted member, in a
   * synchronous loop (the socket path and every HTTP send controller), and
   * each used to cost its own SET NX and its own queue add: two round trips
   * per member. A batch costs one pipeline and one addBulk.
   */
  private pendingMessages: MessagePushJob[] = [];
  private flushScheduled = false;

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
   * The first message of a burst is pushed at once; the rest of the burst
   * collapses into one push per MESSAGE_DEBOUNCE_MS window.
   *
   * Every message push used to wait out the debounce, so even a single
   * message reached the phone at least three seconds late. And the burst was
   * collapsed onto one job id, which BullMQ also refuses while that job is
   * RUNNING, so a message landing during the send was never pushed at all.
   * Now a burst opens with an immediate job (Redis SET NX marks the window),
   * and later messages join a delayed job named for their window, so a new
   * window always gets a job of its own. The worker reads the unread count at
   * send time, and its per-device dedupe key includes that count, so a delayed
   * job with nothing new since the immediate one sends nothing.
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
      this.pendingMessages.push(job);
      if (this.flushScheduled) return;
      this.flushScheduled = true;
      setImmediate(() => {
        void this.flushMessages().catch((err) =>
          this.logger.warn(`push enqueue failed: ${String(err)}`),
        );
      });
    } catch (err) {
      this.logger.warn(`push enqueue threw: ${String(err)}`);
    }
  }

  /**
   * "You were removed from <group>", for a member an admin removed (not for
   * someone who left). After the removal has committed; never awaited and
   * never throws, like the others. One job per removal: the id carries the
   * removal's time, so a retried request cannot push twice and a later
   * removal after a re-add pushes again.
   */
  enqueueForGroupRemoval(job: GroupRemovedPushJob | null | undefined): void {
    try {
      if (!job || !this.active) return;
      if (!job.recipientId || !job.conversationId || !job.removedAt) return;
      void this.queue
        .add(PUSH_JOB.groupRemoved, job, {
          jobId: `gr_${job.recipientId}_${job.conversationId}_${new Date(job.removedAt).getTime()}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: { age: 3_600, count: 1_000 },
          removeOnFail: { age: 24 * 3_600, count: 1_000 },
        })
        .catch((err) =>
          this.logger.warn(`push enqueue failed: ${String(err)}`),
        );
    } catch (err) {
      this.logger.warn(`push enqueue threw: ${String(err)}`);
    }
  }

  /**
   * "Your request to join <group> was approved", for the requester. One job
   * per approval: the id carries its time, so a second admin's approval
   * (which changes nothing) or a retried request cannot push twice.
   */
  enqueueForGroupJoinApproved(
    job: GroupJoinApprovedPushJob | null | undefined,
  ): void {
    try {
      if (!job || !this.active) return;
      if (!job.recipientId || !job.conversationId || !job.approvedAt) return;
      void this.queue
        .add(PUSH_JOB.groupJoinApproved, job, {
          jobId: `ja_${job.recipientId}_${job.conversationId}_${new Date(job.approvedAt).getTime()}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: { age: 3_600, count: 1_000 },
          removeOnFail: { age: 24 * 3_600, count: 1_000 },
        })
        .catch((err) =>
          this.logger.warn(`push enqueue failed: ${String(err)}`),
        );
    } catch (err) {
      this.logger.warn(`push enqueue threw: ${String(err)}`);
    }
  }

  /**
   * A new request to join, for one of the group's owner and admins. The
   * controller enqueues only a request the admins have not seen (a re-tap
   * renews it silently); the id, per reviewer, group and requester in a
   * ten-minute window, absorbs two submits racing past that check, while the
   * same person asking again later (after a decline) pushes again.
   */
  enqueueForGroupJoinRequest(
    job: GroupJoinRequestPushJob | null | undefined,
  ): void {
    try {
      if (!job || !this.active) return;
      if (!job.recipientId || !job.conversationId || !job.requesterId) return;
      void this.queue
        .add(PUSH_JOB.groupJoinRequest, job, {
          jobId: `jr_${job.recipientId}_${job.conversationId}_${job.requesterId}_${Math.floor(Date.now() / 600_000)}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: { age: 3_600, count: 1_000 },
          removeOnFail: { age: 24 * 3_600, count: 1_000 },
        })
        .catch((err) =>
          this.logger.warn(`push enqueue failed: ${String(err)}`),
        );
    } catch (err) {
      this.logger.warn(`push enqueue threw: ${String(err)}`);
    }
  }

  /** Sends the message pushes collected this tick: one pipeline, one addBulk. */
  private async flushMessages(): Promise<void> {
    const jobs = this.pendingMessages;
    this.pendingMessages = [];
    this.flushScheduled = false;
    if (jobs.length === 0) return;
    const leads = await this.opensBursts(jobs);
    const now = Date.now();
    await this.queue.addBulk(
      jobs.map((job, i) => {
        const base = `m_${job.recipientId}_${job.conversationId}`;
        return {
          name: PUSH_JOB.message,
          data: job,
          opts: {
            jobId: leads[i]
              ? `${base}_lead_${now}`
              : `${base}_${Math.floor(now / MESSAGE_DEBOUNCE_MS)}`,
            delay: leads[i] ? 0 : MESSAGE_DEBOUNCE_MS,
            attempts: 5,
            backoff: { type: 'exponential', delay: 2_000 },
            removeOnComplete: true,
            removeOnFail: true,
          },
        };
      }),
    );
  }

  /**
   * For each job, true if it is the first message to that recipient in that
   * conversation within MESSAGE_DEBOUNCE_MS. One SET NX per job, sent as one
   * pipeline; within a batch the first job for a pair wins it, as it did when
   * they were sent one by one. Without Redis (or on an error) false: the
   * message then takes the delayed, collapsing path, the older behaviour.
   */
  private async opensBursts(
    jobs: readonly MessagePushJob[],
  ): Promise<boolean[]> {
    const redis = this.redisService.getClient();
    if (!redis) return jobs.map(() => false);
    try {
      const pipe = redis.pipeline();
      for (const job of jobs) {
        pipe.set(
          `push:mburst:${job.recipientId}:${job.conversationId}`,
          '1',
          'PX',
          MESSAGE_DEBOUNCE_MS,
          'NX',
        );
      }
      const results = await pipe.exec();
      // In order; a command that failed alone takes the delayed path.
      return jobs.map((_, i) => {
        const [err, reply] = results?.[i] ?? [null, null];
        return !err && reply === 'OK';
      });
    } catch {
      return jobs.map(() => false);
    }
  }
}
