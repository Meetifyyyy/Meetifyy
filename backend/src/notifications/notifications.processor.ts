import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

export const NOTIFICATIONS_QUEUE = 'notifications';

export interface FollowNotifJob {
  followerId: string;
  followingId: string;
  actor: {
    username: string;
    displayName: string | null;
    avatar: string | null;
  };
}

@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger('NotificationsProcessor');

  constructor(private readonly notificationsService: NotificationsService) {
    super();
  }

  async process(job: Job): Promise<void> {
    try {
      if (job.name === 'follow-notification') {
        await this.handleFollowNotification(job.data as FollowNotifJob);
      }
    } catch (err) {
      this.logger.error(`Job ${job.name} failed: ${err.message}`, err.stack);
      throw err; // BullMQ will retry based on job options
    }
  }

  private async handleFollowNotification(data: FollowNotifJob) {
    const { followerId, followingId, actor } = data;
    await this.notificationsService.createNotification({
      recipientId: followingId,
      actorId: followerId,
      type: 'FOLLOW' as any,
      entityType: undefined,
      entityId: followerId,
      title: 'New Follower',
      body: `${actor.displayName || actor.username || 'Someone'} started following you.`,
      metadata: {
        version: 1,
        actorId: followerId,
        username: actor.username,
        actorDisplayName: actor.displayName,
        actorAvatar: actor.avatar,
      },
      // Actor data already in job payload — skip the DB re-fetch inside createNotification
      prePopulatedActor: {
        id: followerId,
        username: actor.username,
        displayName: actor.displayName,
        avatar: actor.avatar,
      },
    });
  }
}
