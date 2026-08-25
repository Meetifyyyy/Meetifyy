import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { DomainEventService } from '../events/domain-event.service';

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

export interface ActivityInvitationsJob {
  activityId: string;
  inviterId: string;
  invitations: Array<{ inviteeId: string; invitationId: string }>;
  activityTitle: string;
  activityLocation?: string | null;
  activityCoverImage?: string | null;
  activityCoverColor?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  inviter: {
    id: string;
    name: string;
    username: string;
    avatar?: string | null;
  };
}

@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger('NotificationsProcessor');

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly domainEventService: DomainEventService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    try {
      if (job.name === 'follow-notification') {
        await this.handleFollowNotification(job.data as FollowNotifJob);
      } else if (job.name === 'activity-invitations') {
        await this.handleActivityInvitations(job.data as ActivityInvitationsJob);
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
      prePopulatedActor: {
        id: followerId,
        username: actor.username,
        displayName: actor.displayName,
        avatar: actor.avatar,
      },
    });
  }

  private async handleActivityInvitations(data: ActivityInvitationsJob) {
    // One implementation, shared with the inline fallback ActivitiesService
    // uses when no queue worker is configured — see
    // NotificationsService.createActivityInviteNotifications.
    await this.notificationsService.createActivityInviteNotifications(data);
  }
}
