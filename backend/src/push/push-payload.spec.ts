import { NotificationEntityType, NotificationType } from '@prisma/client';
import {
  NotificationPushInput,
  buildMessagePush,
  buildNotificationPush,
  categoryForType,
  safeName,
  webPushPayload,
} from './push-payload';
import { fcmMessage } from './providers/fcm.provider';

/**
 * Push text and payload privacy (spec 10D): who + what kind, never content,
 * and routing data that is the Intent wire format and nothing else.
 */
const base: NotificationPushInput = {
  id: 'notif-1',
  type: NotificationType.LIKE,
  entityType: NotificationEntityType.POST,
  entityId: 'post-1',
  postId: 'post-1',
  isReply: false,
  aggregatedCount: 1,
  actorName: 'Aarav',
  actorUsername: 'aarav',
};

const ALLOWED_DATA_KEYS = new Set([
  'v',
  't',
  'id',
  'username',
  'conversationId',
]);

describe('push payloads', () => {
  it.each<[Partial<NotificationPushInput>, string, string]>([
    [{}, 'Aarav liked your post.', 'post'],
    [{ aggregatedCount: 3 }, 'Aarav and 2 others liked your post.', 'post'],
    [
      {
        type: NotificationType.COMMENT_LIKE,
        entityType: 'COMMENT',
        entityId: 'c-1',
      },
      'Aarav liked your comment.',
      'post',
    ],
    [
      {
        type: NotificationType.COMMENT,
        entityType: 'COMMENT',
        entityId: 'c-1',
      },
      'Aarav commented on your post.',
      'post',
    ],
    [
      { type: NotificationType.COMMENT, entityType: 'COMMENT', isReply: true },
      'Aarav replied to your comment.',
      'post',
    ],
    [
      { type: NotificationType.MENTION },
      'Aarav mentioned you in a post.',
      'post',
    ],
    [
      {
        type: NotificationType.MENTION,
        entityType: 'COMMENT',
        entityId: 'c-1',
      },
      'Aarav mentioned you in a comment.',
      'post',
    ],
    [
      { type: NotificationType.FOLLOW, entityType: null },
      'Aarav started following you.',
      'profile',
    ],
    [
      {
        type: NotificationType.ACTIVITY_INVITE,
        entityType: 'ACTIVITY',
        entityId: 'a-1',
      },
      'Aarav invited you to an activity.',
      'activity',
    ],
    [
      {
        type: NotificationType.JOIN_REQUEST,
        entityType: 'ACTIVITY',
        entityId: 'a-1',
      },
      'Aarav joined your activity.',
      'activity',
    ],
    [
      {
        type: NotificationType.COMMUNITY_JOIN,
        entityType: 'COMMUNITY',
        entityId: 'k-1',
      },
      'Aarav joined your community.',
      'community',
    ],
    [
      {
        type: NotificationType.COMMUNITY_JOIN_REQUEST,
        entityType: 'COMMUNITY',
        entityId: 'k-1',
      },
      'Aarav requested to join your community.',
      'community',
    ],
  ])('%j reads "%s" and routes to %s', (patch, body, intentType) => {
    const message = buildNotificationPush({ ...base, ...patch });
    expect(message?.body).toBe(body);
    expect(message?.intent.t).toBe(intentType);
  });

  it('never pushes SYSTEM or GROUP_INVITE rows (in-app only)', () => {
    expect(
      buildNotificationPush({ ...base, type: NotificationType.SYSTEM }),
    ).toBeNull();
    expect(
      buildNotificationPush({ ...base, type: NotificationType.GROUP_INVITE }),
    ).toBeNull();
    expect(categoryForType(NotificationType.SYSTEM)).toBeNull();
  });

  it('DM and group message text follows the agreed wording, with counts for a burst', () => {
    const dm = {
      routeId: 'pub-1',
      conversationId: 'conv-1',
      isGroup: false,
      groupName: null,
      senderName: 'Aarav',
      unread: 1,
    };
    expect(buildMessagePush(dm).body).toBe(
      'You have a new message from Aarav.',
    );
    expect(buildMessagePush({ ...dm, unread: 4 }).body).toBe(
      'You have 4 new messages from Aarav.',
    );
    const group = { ...dm, isGroup: true, groupName: 'Hostel B' };
    expect(buildMessagePush(group).title).toBe('Hostel B');
    expect(buildMessagePush(group).body).toBe('New message from Aarav');
    expect(buildMessagePush({ ...group, unread: 3 }).body).toBe(
      '3 new messages',
    );
    // One tray entry per conversation, routed by the public id only.
    expect(buildMessagePush(dm).collapseKey).toBe(
      buildMessagePush({ ...dm, unread: 9 }).collapseKey,
    );
    expect(buildMessagePush(dm).collapseKey).not.toContain('conv-1');
    expect(buildMessagePush(dm).intent).toEqual({
      v: '1',
      t: 'chat',
      conversationId: 'pub-1',
    });
  });

  it('carries no content, ids or tokens beyond the destination (web and FCM)', () => {
    const message = buildMessagePush({
      routeId: 'pub-1',
      conversationId: 'conv-1',
      isGroup: false,
      groupName: null,
      senderName: 'Aarav',
      unread: 1,
    });
    const web = JSON.parse(webPushPayload(message)) as Record<string, unknown>;
    expect(Object.keys(web).sort()).toEqual([
      'body',
      'data',
      'renotify',
      'tag',
      'title',
    ]);
    const data = web.data as Record<string, unknown>;
    Object.keys(data).forEach((k) =>
      expect(ALLOWED_DATA_KEYS.has(k)).toBe(true),
    );

    const fcm = fcmMessage('token-x', message);
    Object.keys(fcm.data ?? {}).forEach((k) =>
      expect(ALLOWED_DATA_KEYS.has(k)).toBe(true),
    );
    expect(fcm.android?.notification?.visibility).toBe('private');
    expect(fcm.android?.notification?.channelId).toBe('messages');
    expect(JSON.stringify(fcm)).not.toContain('conv-1');
  });

  it('sanitises display names (control characters, length)', () => {
    expect(safeName('  A\u0000ar‮av  ')).toBe('Aarav');
    expect(safeName('')).toBe('Someone');
    expect(safeName('x'.repeat(80)).length).toBe(40);
  });
});
