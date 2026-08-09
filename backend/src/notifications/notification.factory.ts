import { Injectable } from '@nestjs/common';
import { NotificationType, NotificationEntityType } from '@prisma/client';

export interface CreateNotificationDto {
  recipientId: string;
  actorId?: string;
  type: NotificationType;
  entityType?: NotificationEntityType;
  entityId?: string;
  title: string;
  body: string;
  metadata: any;
  expiresAt?: Date;
  /** Pre-populated actor data — skips the actor DB re-fetch in createNotification */
  prePopulatedActor?: { id: string; username: string; displayName: string | null; avatar: string | null };
}

@Injectable()
export class NotificationFactory {
  createLike(actor: any, post: any, postAuthorId: string): CreateNotificationDto {
    const actorName = actor?.displayName || actor?.username || 'Someone';
    const actorUsername = actor?.username || '';
    return {
      recipientId: postAuthorId,
      actorId: actor?.id,
      type: NotificationType.LIKE,
      entityType: NotificationEntityType.POST,
      entityId: post.id,
      title: 'New Like',
      body: `${actorName} liked your post.`,
      metadata: {
        version: 1,
        actorName,
        actorUsername,
        actorAvatar: actor?.avatar || null,
        postId: post.id,
        postPreview: post?.text ? post.text.substring(0, 40) : '',
        aggregatedCount: 1,
      },
    };
  }

  createCommentLike(actor: any, comment: any, commentAuthorId: string): CreateNotificationDto {
    const actorName = actor?.displayName || actor?.username || 'Someone';
    const actorUsername = actor?.username || '';
    return {
      recipientId: commentAuthorId,
      actorId: actor?.id,
      type: NotificationType.COMMENT_LIKE,
      entityType: NotificationEntityType.COMMENT,
      entityId: comment.id,
      title: 'New Comment Like',
      body: `${actorName} liked your comment.`,
      metadata: {
        version: 1,
        actorName,
        actorUsername,
        actorAvatar: actor?.avatar || null,
        postId: comment.postId || null,
        commentId: comment.id,
        commentPreview: comment?.text ? comment.text.substring(0, 40) : '',
        aggregatedCount: 1,
      },
    };
  }

  createComment(actor: any, comment: any, post: any, postAuthorId: string): CreateNotificationDto {
    const actorName = actor?.displayName || actor?.username || 'Someone';
    const actorUsername = actor?.username || '';
    return {
      recipientId: postAuthorId,
      actorId: actor?.id,
      type: NotificationType.COMMENT,
      entityType: NotificationEntityType.COMMENT,
      entityId: comment.id,
      title: 'New Comment',
      body: `${actorName} commented: "${comment.text ? comment.text.substring(0, 40) : ''}"`,
      metadata: {
        version: 1,
        actorName,
        actorUsername,
        actorAvatar: actor?.avatar || null,
        postId: post.id,
        commentId: comment.id,
        commentText: comment.text,
      },
    };
  }

  createCommentReply(actor: any, comment: any, post: any, parentCommentAuthorId: string): CreateNotificationDto {
    const actorName = actor?.displayName || actor?.username || 'Someone';
    const actorUsername = actor?.username || '';
    return {
      recipientId: parentCommentAuthorId,
      actorId: actor?.id,
      type: NotificationType.COMMENT,
      entityType: NotificationEntityType.COMMENT,
      entityId: comment.id,
      title: 'New Reply',
      body: `${actorName} replied to your comment: "${comment.text ? comment.text.substring(0, 40) : ''}"`,
      metadata: {
        version: 1,
        actorName,
        actorUsername,
        actorAvatar: actor?.avatar || null,
        postId: post.id,
        commentId: comment.id,
        commentText: comment.text,
        isReply: true,
      },
    };
  }

  createMention(
    actor: any,
    targetUserId: string,
    entityType: NotificationEntityType,
    entityId: string,
    contextText: string,
    extraMetadata?: Record<string, any>,
  ): CreateNotificationDto {
    const actorName = actor?.displayName || actor?.username || 'Someone';
    const actorUsername = actor?.username || '';
    return {
      recipientId: targetUserId,
      actorId: actor?.id,
      type: NotificationType.MENTION,
      entityType,
      entityId,
      title: 'New Mention',
      body: `${actorName} mentioned you.`,
      metadata: {
        version: 1,
        actorName,
        actorUsername,
        actorAvatar: actor?.avatar || null,
        contextText: contextText ? contextText.substring(0, 40) : '',
        ...extraMetadata,
      },
    };
  }

  createActivityJoin(actor: any, activity: any, activityCreatorId: string): CreateNotificationDto {
    const actorName = actor?.displayName || actor?.username || 'Someone';
    const actorUsername = actor?.username || '';
    return {
      recipientId: activityCreatorId,
      actorId: actor?.id,
      type: NotificationType.JOIN_REQUEST,
      entityType: NotificationEntityType.ACTIVITY,
      entityId: activity.id,
      title: 'New Activity Member',
      body: `${actorName} joined your activity "${activity.title}".`,
      metadata: {
        version: 1,
        actorName,
        actorUsername,
        actorAvatar: actor?.avatar || null,
        activityName: activity.title,
      },
    };
  }

  createActivityJoinRequest(actor: any, activity: any, activityCreatorId: string): CreateNotificationDto {
    const actorName = actor?.displayName || actor?.username || 'Someone';
    const actorUsername = actor?.username || '';
    return {
      recipientId: activityCreatorId,
      actorId: actor?.id,
      type: NotificationType.JOIN_REQUEST,
      entityType: NotificationEntityType.ACTIVITY,
      entityId: activity.id,
      title: 'Join Request',
      body: `${actorName} requested to join your activity "${activity.title}".`,
      metadata: {
        version: 1,
        actorName,
        actorUsername,
        actorAvatar: actor?.avatar || null,
        activityName: activity.title,
      },
    };
  }

  createMessage(actor: any, conversation: any, targetUserId: string, messageText?: string): CreateNotificationDto {
    const actorName = actor?.displayName || actor?.username || 'Someone';
    const actorUsername = actor?.username || '';
    const textSnippet = messageText ? messageText.substring(0, 80) : '';

    const isGroup = conversation?.type === 'GROUP';
    const convName = conversation?.name || (isGroup ? 'Group' : actorName);
    const convAvatar = conversation?.avatarMedia?.url || conversation?.avatarKey || null;

    const bodyText = textSnippet ? `${actorName}: ${textSnippet}` : `${actorName} sent you a message.`;
    const titleText = isGroup ? convName : actorName;
    const pubId = conversation?.publicId || conversation?.id;
    const intId = conversation?.id;

    return {
      recipientId: targetUserId,
      actorId: actor?.id,
      type: NotificationType.MESSAGE,
      entityType: NotificationEntityType.MESSAGE,
      entityId: pubId || intId,
      title: titleText,
      body: bodyText,
      metadata: {
        version: 1,
        actorName,
        actorUsername,
        actorAvatar: actor?.avatar || null,
        conversationId: pubId,
        publicId: pubId,
        internalId: intId,
        conversationName: convName,
        conversationType: conversation?.type || 'DIRECT',
        conversationAvatar: convAvatar,
        messageText: textSnippet,
        isGroup,
      },
    };
  }
}
