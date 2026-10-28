import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  NotificationEntityType,
  NotificationType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { roleCan } from '../communities/moderator-permissions';
import { isJsonObject } from '../common/utils/json.util';
import {
  GroupJoinRequestPushInput,
  GroupRemovedPushInput,
  MessagePushInput,
  NotificationPushInput,
  categoryForType,
  safeName,
} from './push-payload';
import { CATEGORY_COLUMN, PushCategory } from './push.types';

/**
 * Authorization at SEND time.
 *
 * A push is decided when the worker runs, not when the event happened: between
 * the two, a post can be deleted, a like undone, an invite cancelled, a
 * notification read, a member removed, a block placed or the recipient
 * suspended. Each of those makes the push wrong, so every check the in-app path
 * relied on at creation is made again here against current rows, and anything
 * that no longer holds suppresses the push (the in-app row is untouched).
 *
 * Returns the minimal, already-sanitised input for the payload builder, or
 * null. Nothing the client sent is read: every field comes from the database.
 */
@Injectable()
export class PushAudienceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Recipient exists, is active, has push on, and has this category on. */
  async recipientWants(
    userId: string,
    category: PushCategory,
  ): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        deletedAt: true,
        accountStatus: true,
        settings: { select: { pushNotifs: true } },
        notificationPrefs: true,
      },
    });
    if (!user || user.deletedAt || user.accountStatus !== AccountStatus.ACTIVE)
      return false;
    if (!user.settings?.pushNotifs) return false;
    const prefs = user.notificationPrefs;
    return prefs ? prefs[CATEGORY_COLUMN[category]] : true;
  }

  private async blockedEitherWay(a: string, b: string): Promise<boolean> {
    const block = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
      select: { blockerId: true },
    });
    return Boolean(block);
  }

  private async liveActor(actorId: string | null) {
    if (!actorId) return null;
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: {
        username: true,
        displayName: true,
        deletedAt: true,
        accountStatus: true,
      },
    });
    if (
      !actor ||
      actor.deletedAt ||
      actor.accountStatus !== AccountStatus.ACTIVE
    )
      return null;
    return actor;
  }

  private async postIsLive(
    postId: string | null,
    authorId?: string,
  ): Promise<boolean> {
    if (!postId) return false;
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { deletedAt: true, authorId: true },
    });
    return Boolean(
      post && !post.deletedAt && (!authorId || post.authorId === authorId),
    );
  }

  private async commentIsLive(
    commentId: string | null,
    authorId?: string,
  ): Promise<boolean> {
    if (!commentId) return false;
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: {
        deletedAt: true,
        isDeleted: true,
        authorId: true,
        postId: true,
      },
    });
    if (!comment || comment.deletedAt || comment.isDeleted) return false;
    if (authorId && comment.authorId !== authorId) return false;
    return this.postIsLive(comment.postId);
  }

  private async canReviewCommunity(
    userId: string,
    communityId: string,
  ): Promise<boolean> {
    const [community, member] = await Promise.all([
      this.prisma.community.findUnique({
        where: { id: communityId },
        select: { ownerId: true, deletedAt: true },
      }),
      this.prisma.communityMember.findUnique({
        where: { userId_communityId: { userId, communityId } },
        select: { role: true },
      }),
    ]);
    if (!community || community.deletedAt) return false;
    return (
      community.ownerId === userId ||
      roleCan(member?.role, 'REVIEW_JOIN_REQUESTS')
    );
  }

  /** Does the thing the notification is about still exist, and still concern this recipient? */
  private async resourceStillValid(n: {
    type: NotificationType;
    entityType: NotificationEntityType | null;
    entityId: string | null;
    recipientId: string;
    actorId: string | null;
    postId: string | null;
  }): Promise<boolean> {
    const { type, entityId, recipientId, actorId } = n;
    switch (type) {
      case NotificationType.LIKE:
        return this.postIsLive(entityId, recipientId);
      case NotificationType.COMMENT_LIKE:
        return this.commentIsLive(entityId, recipientId);
      case NotificationType.COMMENT:
        // The comment that was written (by the actor) must still be there.
        return this.commentIsLive(entityId, actorId ?? undefined);
      case NotificationType.MENTION:
        return n.entityType === NotificationEntityType.COMMENT
          ? this.commentIsLive(entityId)
          : this.postIsLive(entityId);
      case NotificationType.FOLLOW: {
        if (!actorId) return false;
        const follow = await this.prisma.follow.findUnique({
          where: {
            followerId_followingId: {
              followerId: actorId,
              followingId: recipientId,
            },
          },
          select: { followerId: true },
        });
        return Boolean(follow);
      }
      case NotificationType.ACTIVITY_INVITE: {
        if (!entityId) return false;
        const invite = await this.prisma.activityInvitation.findUnique({
          where: {
            activityId_inviteeId: {
              activityId: entityId,
              inviteeId: recipientId,
            },
          },
          select: {
            status: true,
            activity: { select: { deletedAt: true, status: true } },
          },
        });
        return Boolean(
          invite &&
          invite.status === 'PENDING' &&
          !invite.activity.deletedAt &&
          invite.activity.status !== 'CANCELLED' &&
          invite.activity.status !== 'ENDED',
        );
      }
      case NotificationType.JOIN_REQUEST: {
        // "joined your activity": the recipient still hosts it and the joiner is still in.
        if (!entityId || !actorId) return false;
        const activity = await this.prisma.crewActivity.findUnique({
          where: { id: entityId },
          select: { creatorId: true, deletedAt: true, status: true },
        });
        if (
          !activity ||
          activity.deletedAt ||
          activity.creatorId !== recipientId
        )
          return false;
        if (activity.status === 'CANCELLED') return false;
        const member = await this.prisma.crewActivityMember.findUnique({
          where: {
            userId_activityId: { userId: actorId, activityId: entityId },
          },
          select: { status: true },
        });
        return member?.status === 'MEMBER';
      }
      case NotificationType.COMMUNITY_JOIN: {
        if (!entityId || !actorId) return false;
        if (!(await this.canReviewCommunity(recipientId, entityId)))
          return false;
        const member = await this.prisma.communityMember.findUnique({
          where: {
            userId_communityId: { userId: actorId, communityId: entityId },
          },
          select: { role: true },
        });
        return Boolean(member);
      }
      case NotificationType.COMMUNITY_JOIN_REQUEST: {
        if (!entityId || !actorId) return false;
        if (!(await this.canReviewCommunity(recipientId, entityId)))
          return false;
        const request = await this.prisma.communityJoinRequest.findUnique({
          where: {
            communityId_userId: { communityId: entityId, userId: actorId },
          },
          select: { status: true },
        });
        return request?.status === 'PENDING';
      }
      default:
        return false;
    }
  }

  /** The payload input for a notification row, or null when it must not be pushed. */
  async forNotification(
    notificationId: string,
    recipientId: string,
  ): Promise<NotificationPushInput | null> {
    const row = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      select: {
        id: true,
        recipientId: true,
        actorId: true,
        type: true,
        entityType: true,
        entityId: true,
        metadata: true,
        readAt: true,
        deletedAt: true,
        updatedAt: true,
      },
    });
    // Gone, cancelled (unlike/unfollow soft-delete it), already read on
    // another device, or re-addressed: nothing to push.
    if (!row || row.deletedAt || row.readAt || row.recipientId !== recipientId)
      return null;
    const category = categoryForType(row.type);
    if (!category || category === 'messages') return null;
    if (!row.actorId) return null;

    const actor = await this.liveActor(row.actorId);
    if (!actor) return null;
    if (!(await this.recipientWants(recipientId, category))) return null;
    if (await this.blockedEitherWay(recipientId, row.actorId)) return null;

    const meta = isJsonObject(row.metadata) ? row.metadata : {};
    const postId = typeof meta.postId === 'string' ? meta.postId : null;
    const valid = await this.resourceStillValid({
      type: row.type,
      entityType: row.entityType,
      entityId: row.entityId,
      recipientId,
      actorId: row.actorId,
      postId,
    });
    if (!valid) return null;

    const count =
      typeof meta.aggregatedCount === 'number' ? meta.aggregatedCount : 1;
    return {
      id: row.id,
      type: row.type,
      entityType: row.entityType,
      entityId: row.entityId,
      postId,
      isReply: meta.isReply === true,
      aggregatedCount: Math.max(1, Math.floor(count)),
      actorName: safeName(actor.displayName || actor.username),
      actorUsername: actor.username || null,
    };
  }

  /**
   * The payload input for a conversation burst, or null.
   *
   * `unreadCount` is the conversation's own per-participant counter, reset when
   * the recipient reads it. Zero means they have already seen the messages,
   * which is also how a push is suppressed while they are looking at the
   * conversation: the open chat marks it seen as the message arrives, inside
   * the debounce window, so by send time there is nothing unread.
   */
  async forMessage(
    recipientId: string,
    conversationId: string,
    senderId: string,
  ): Promise<{ input: MessagePushInput; dedupeKey: string } | null> {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId: recipientId, conversationId } },
      select: {
        unreadCount: true,
        isMuted: true,
        leftAt: true,
        deletedAt: true,
        conversation: {
          select: { id: true, publicId: true, name: true, type: true },
        },
      },
    });
    if (
      !participant ||
      participant.leftAt ||
      participant.deletedAt ||
      participant.isMuted
    ) {
      return null;
    }
    if (participant.unreadCount <= 0) return null;
    const conversation = participant.conversation;
    // Instant Match chats are a live overlay with no Messages destination and
    // are never pushed (see NotificationFactory.createMessage).
    if (conversation.type !== 'DM' && conversation.type !== 'GROUP')
      return null;

    const sender = await this.liveActor(senderId);
    if (!sender) return null;
    if (!(await this.recipientWants(recipientId, 'messages'))) return null;
    if (await this.blockedEitherWay(recipientId, senderId)) return null;

    return {
      input: {
        routeId: conversation.publicId || conversation.id,
        conversationId: conversation.id,
        isGroup: conversation.type === 'GROUP',
        groupName: conversation.name,
        senderName: safeName(sender.displayName || sender.username),
        unread: participant.unreadCount,
      },
      dedupeKey: `m:${conversation.id}:${participant.unreadCount}`,
    };
  }

  /**
   * The push for someone removed from a group, or null.
   *
   * Re-checked at send time like every other push: the person must still be
   * out because of THIS removal (`leftAt` unchanged: re-added since, or
   * removed again later, and this one is stale), the conversation must still
   * be a group, and they must want message notifications (the channel it
   * arrives on).
   */
  async forGroupRemoval(
    recipientId: string,
    conversationId: string,
    removedAt: string,
  ): Promise<GroupRemovedPushInput | null> {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId: recipientId, conversationId } },
      select: {
        leftAt: true,
        isMuted: true,
        conversation: {
          select: { id: true, publicId: true, name: true, type: true },
        },
      },
    });
    if (!participant?.leftAt) return null;
    // Muted means no alerts from this group, this one included.
    if (participant.isMuted) return null;
    if (participant.leftAt.getTime() !== new Date(removedAt).getTime())
      return null;
    const conversation = participant.conversation;
    if (conversation.type !== 'GROUP') return null;
    if (!(await this.recipientWants(recipientId, 'messages'))) return null;
    return {
      routeId: conversation.publicId || conversation.id,
      conversationId: conversation.id,
      groupName: conversation.name,
    };
  }

  /**
   * A new request to join, for one of the group's reviewers. Dropped if it is
   * no longer worth a push by send time: the request was answered or expired,
   * the recipient is no longer an owner or admin there, the group has ended,
   * the requester is gone, or either has blocked the other.
   */
  async forGroupJoinRequest(
    recipientId: string,
    conversationId: string,
    requesterId: string,
  ): Promise<GroupJoinRequestPushInput | null> {
    const [request, reviewer, requester] = await Promise.all([
      this.prisma.conversationJoinRequest.findUnique({
        where: {
          conversationId_userId: { conversationId, userId: requesterId },
        },
        select: {
          status: true,
          expiresAt: true,
          conversation: {
            select: {
              id: true,
              publicId: true,
              name: true,
              type: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.conversationParticipant.findUnique({
        where: {
          userId_conversationId: { userId: recipientId, conversationId },
        },
        select: { role: true, leftAt: true, deletedAt: true, isMuted: true },
      }),
      this.liveActor(requesterId),
    ]);
    if (!request || request.status !== 'PENDING') return null;
    if (request.expiresAt && request.expiresAt <= new Date()) return null;
    const conversation = request.conversation;
    if (conversation.type !== 'GROUP') return null;
    if ((conversation.status || 'ACTIVE').toUpperCase() !== 'ACTIVE') {
      return null;
    }
    if (!reviewer || reviewer.leftAt || reviewer.deletedAt) return null;
    if (reviewer.role !== 'OWNER' && reviewer.role !== 'ADMIN') return null;
    // An admin who muted the group gets no alerts from it, requests included.
    if (reviewer.isMuted) return null;
    if (!requester) return null;
    if (await this.blockedEitherWay(recipientId, requesterId)) return null;
    if (!(await this.recipientWants(recipientId, 'messages'))) return null;
    return {
      routeId: conversation.publicId || conversation.id,
      conversationId: conversation.id,
      groupName: conversation.name,
      requesterName: requester.displayName || requester.username,
    };
  }
}
