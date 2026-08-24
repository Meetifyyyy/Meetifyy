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

  /**
   * "<username> joined your activity" — sent to the host the moment someone
   * joins. Joining is direct (there is no approval queue), so this is a plain
   * informational notification: no accept/reject affordance.
   *
   * The metadata carries everything the card needs to render without a second
   * fetch: the joiner's username and avatar, plus the activity's name and
   * cover image.
   */
  createActivityJoin(actor: any, activity: any, activityCreatorId: string): CreateNotificationDto {
    const actorUsername = actor?.username || actor?.displayName || 'Someone';
    return {
      recipientId: activityCreatorId,
      actorId: actor?.id,
      type: NotificationType.JOIN_REQUEST,
      entityType: NotificationEntityType.ACTIVITY,
      entityId: activity.id,
      title: activity.title || 'Your activity',
      body: `${actorUsername} joined your activity.`,
      metadata: {
        version: 1,
        actorName: actorUsername,
        actorUsername,
        actorAvatar: actor?.avatar || null,
        activityId: activity.id,
        activityName: activity.title || null,
        activityImage: activity.coverImage || null,
        activityColor: activity.coverColor || null,
      },
    };
  }

  /**
   * A chat-message notification.
   *
   * `metadata.chatType` is what tells the client which surface to open, and it
   * is the only thing that does. An Instant Match message must open the
   * Instant Match chat — the dedicated overlay the match lives on — while a
   * normal message deep-links into Messages by conversationId. The two are
   * different screens, so a notification that does not say which one it means
   * can only guess, and the guess used to be Messages: a section the Instant
   * Match chat deliberately does not appear in.
   *
   * An instant notification therefore carries NO conversationId. There is
   * nothing for the client to route to by id — it asks Instant Match for the
   * user's current session and opens that — and omitting it makes it
   * impossible for a deep-link path to pick the id up by accident and drag a
   * temporary match into the normal messaging surface.
   */
  createMessage(actor: any, conversation: any, targetUserId: string, messageText?: string): CreateNotificationDto | null {
    const isInstant = conversation?.type === 'INSTANT_MATCH' || conversation?.isInstantMatch === true;

    if (isInstant) {
      const instantActor = actor?.displayName || actor?.username || 'Your match';
      const instantSnippet = messageText ? messageText.substring(0, 80) : '';
      return {
        recipientId: targetUserId,
        actorId: actor?.id,
        type: NotificationType.MESSAGE,
        entityType: NotificationEntityType.MESSAGE,
        // The match session, never the conversation: this notification must
        // not carry an id that /messages could route on.
        entityId: conversation?.matchId || conversation?.id,
        title: instantActor,
        body: instantSnippet ? `${instantActor}: ${instantSnippet}` : `${instantActor} sent you a message.`,
        metadata: {
          version: 1,
          chatType: 'instant',
          isInstantMatch: true,
          actorName: instantActor,
          actorUsername: actor?.username || '',
          actorAvatar: actor?.avatar || null,
          messageText: instantSnippet,
          isGroup: false,
        },
      };
    }

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
        chatType: 'normal',
        isInstantMatch: false,
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
