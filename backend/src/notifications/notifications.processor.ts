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
    const { activityId, inviterId, invitations, activityTitle, activityLocation, activityCoverImage, startDate, endDate, inviter } = data;

    for (const item of invitations) {
      const { inviteeId, invitationId } = item;

      const notif = await this.notificationsService.createNotification({
        recipientId: inviteeId,
        actorId: inviterId,
        type: 'ACTIVITY_INVITE' as any,
        entityType: 'ACTIVITY' as any,
        entityId: activityId,
        title: 'Activity Invitation',
        body: `${inviter.name || 'Someone'} invited you to join ${activityTitle}`,
        metadata: {
          invitationId,
          activityId,
          title: activityTitle,
          location: activityLocation,
          startDate,
          endDate,
          coverImage: activityCoverImage,
          hostId: inviterId,
          hostName: inviter.name,
          hostAvatar: inviter.avatar,
          hostUsername: inviter.username,
        },
        prePopulatedActor: {
          id: inviterId,
          username: inviter.username,
          displayName: inviter.name,
          avatar: inviter.avatar || null,
        },
      });

      this.domainEventService.emit('invitation:new', {
        id: invitationId,
        activityId,
        inviterId,
        inviteeId,
        status: 'PENDING',
        activity: {
          id: activityId,
          title: activityTitle,
          location: activityLocation,
          startDate,
          endDate,
          coverImage: activityCoverImage,
        },
        inviter: {
          id: inviter.id,
          name: inviter.name,
          username: inviter.username,
          avatar: inviter.avatar,
        },
      }, [inviteeId]);

      if (notif) {
        this.domainEventService.emit('notification:new', notif, [inviteeId]);
      }
    }
  }
}

