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

  /**
   * "Your post/comment was removed by a moderator."
   *
   * Only ever built when someone OTHER than the author deleted the content —
   * telling authors they deleted their own thing is noise, and the delete
   * paths make that decision before calling here.
   *
   * The actor is named by role, not by name. A moderation action is the
   * community acting, and putting a specific person on it invites the author
   * to take it up with them directly. The metadata still carries the actor so
   * the notification is attributable if it is ever disputed.
   *
   * `SYSTEM` rather than a new NotificationType: this is the app telling you
   * something happened to your content, which is exactly what SYSTEM already
   * means here, and it needs no enum migration to start working.
   */
  createContentRemoved(
    actor: any,
    opts: {
      recipientId: string;
      contentType: 'post' | 'comment';
      removedBy: 'owner' | 'moderator';
      entityId: string;
      postId?: string | null;
      communityId?: string | null;
      communityName?: string | null;
      contentPreview?: string | null;
    },
  ): CreateNotificationDto | null {
    // No self-notifications, whatever the caller thinks it is doing.
    if (!opts.recipientId || opts.recipientId === actor?.id) return null;

    const roleLabel = opts.removedBy === 'owner' ? 'the community owner' : 'a moderator';
    const noun = opts.contentType === 'post' ? 'post' : 'comment';
    const where = opts.communityName ? ` in ${opts.communityName}` : '';

    return {
      recipientId: opts.recipientId,
      actorId: actor?.id,
      type: NotificationType.SYSTEM,
      entityType:
        opts.contentType === 'post'
          ? NotificationEntityType.POST
          : NotificationEntityType.COMMENT,
      entityId: opts.entityId,
      title: `Your ${noun} was removed`,
      body: `Your ${noun}${where} was removed by ${roleLabel}.`,
      metadata: {
        version: 1,
        kind: 'content_removed',
        contentType: opts.contentType,
        removedBy: opts.removedBy,
        actorName: actor?.displayName || actor?.username || 'Moderator',
        actorUsername: actor?.username || '',
        actorAvatar: actor?.avatar || null,
        postId: opts.postId || null,
        commentId: opts.contentType === 'comment' ? opts.entityId : null,
        communityId: opts.communityId || null,
        communityName: opts.communityName || null,
        contentPreview: opts.contentPreview ? String(opts.contentPreview).substring(0, 80) : '',
      },
    };
  }

  /**
   * "You are now a moderator of <community>."
   *
   * Sent at the moment of promotion so it lands whether or not the new
   * moderator reopens the community — the in-community welcome modal is the
   * richer version of this news, not a substitute for it.
   *
   * The permission list is deliberately NOT baked into the notification body.
   * A notification is a durable row: a list copied into it at write time would
   * still be claiming yesterday's permissions long after the set changed. The
   * modal reads the live list instead, and this stays a pointer to it.
   */
  createModeratorPromotion(
    actor: any,
    opts: {
      recipientId: string;
      communityId: string;
      communityName?: string | null;
      communityAvatar?: string | null;
    },
  ): CreateNotificationDto | null {
    if (!opts.recipientId || opts.recipientId === actor?.id) return null;

    const communityName = opts.communityName || 'a community';
    return {
      recipientId: opts.recipientId,
      actorId: actor?.id,
      type: NotificationType.SYSTEM,
      entityType: NotificationEntityType.COMMUNITY,
      entityId: opts.communityId,
      title: "You're now a moderator",
      body: `You were made a moderator of ${communityName}.`,
      metadata: {
        version: 1,
        kind: 'moderator_promotion',
        communityId: opts.communityId,
        communityName: opts.communityName || null,
        communityAvatar: opts.communityAvatar || null,
        actorName: actor?.displayName || actor?.username || 'The owner',
        actorUsername: actor?.username || '',
        actorAvatar: actor?.avatar || null,
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
