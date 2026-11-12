import { Processor } from '@nestjs/bullmq';
import { DrainingWorkerHost } from '../common/queues/draining-worker-host';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { DomainEventService } from '../events/domain-event.service';
import { errorMessage, errorStack } from '../common/utils/error.util';

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

/** Someone asked to follow a private account; the target is the recipient. */
export interface FollowRequestNotifJob {
  requesterId: string;
  targetId: string;
  actor: {
    username: string;
    displayName: string | null;
    avatar: string | null;
  };
}

/** The target accepted; the requester is the recipient and the accepter the actor. */
export interface FollowAcceptedNotifJob {
  accepterId: string;
  requesterId: string;
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
export class NotificationsProcessor extends DrainingWorkerHost {
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
      } else if (job.name === 'follow-request-notification') {
        await this.handleFollowRequestNotification(
          job.data as FollowRequestNotifJob,
        );
      } else if (job.name === 'follow-accepted-notification') {
        await this.handleFollowAcceptedNotification(
          job.data as FollowAcceptedNotifJob,
        );
      } else if (job.name === 'activity-invitations') {
        await this.handleActivityInvitations(
          job.data as ActivityInvitationsJob,
        );
      }
    } catch (err) {
      this.logger.error(
        `Job ${job.name} failed: ${errorMessage(err)}`,
        errorStack(err),
      );
      throw err; // BullMQ will retry based on job options
    }
  }

  private async handleFollowNotification(data: FollowNotifJob) {
    const { followerId, followingId, actor } = data;
    await this.notificationsService.createNotification({
      recipientId: followingId,
      actorId: followerId,
      type: 'FOLLOW',
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

  private async handleFollowRequestNotification(data: FollowRequestNotifJob) {
    const { requesterId, targetId, actor } = data;
    // Keyed on the requester like a follow notification is, so a request that
    // is withdrawn and sent again updates the one row instead of stacking.
    await this.notificationsService.createNotification({
      recipientId: targetId,
      actorId: requesterId,
      type: 'FOLLOW_REQUEST',
      entityType: undefined,
      entityId: requesterId,
      title: 'Follow request',
      body: `${actor.displayName || actor.username || 'Someone'} requested to follow you.`,
      metadata: {
        version: 1,
        actorId: requesterId,
        username: actor.username,
        actorDisplayName: actor.displayName,
        actorAvatar: actor.avatar,
      },
      prePopulatedActor: {
        id: requesterId,
        username: actor.username,
        displayName: actor.displayName,
        avatar: actor.avatar,
      },
    });
  }

  private async handleFollowAcceptedNotification(data: FollowAcceptedNotifJob) {
    const { accepterId, requesterId, actor } = data;
    await this.notificationsService.createNotification({
      recipientId: requesterId,
      actorId: accepterId,
      type: 'FOLLOW_ACCEPTED',
      entityType: undefined,
      entityId: accepterId,
      title: 'Follow request accepted',
      body: `${actor.displayName || actor.username || 'Someone'} accepted your follow request.`,
      metadata: {
        version: 1,
        actorId: accepterId,
        username: actor.username,
        actorDisplayName: actor.displayName,
        actorAvatar: actor.avatar,
      },
      prePopulatedActor: {
        id: accepterId,
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
