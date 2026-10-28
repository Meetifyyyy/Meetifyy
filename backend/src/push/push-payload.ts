import * as crypto from 'crypto';
import { NotificationEntityType, NotificationType } from '@prisma/client';
import { PushCategory, PushIntentData, PushMessage } from './push.types';

/**
 * The only place push text is written.
 *
 * Push text is NOT the notification row's `title`/`body`. Those are written for
 * the in-app list and quote content ("Aarav commented: \"...\""); a push lands
 * on a lock screen and transits Google's and the browser vendors' servers, so
 * it names who and what kind of thing, never the content itself: no message
 * text, no post or comment text, no email, no ids beyond the destination.
 */

const APP_NAME = 'Meetifyy';

/**
 * A collapse key that groups without disclosing: the tag/topic/collapse_key
 * travels to the push service and the device, so it is a short hash of the
 * internal id rather than the id itself.
 */
export function collapseKeyFor(kind: 'n' | 'c', id: string): string {
  const digest = crypto
    .createHash('sha256')
    .update(`${kind}:${id}`)
    .digest('base64url');
  return `${kind}-${digest.slice(0, 22)}`;
}
const ONE_DAY = 24 * 60 * 60;

/** Display names are user-controlled: one line, bounded, no control characters. */
export function safeName(
  name: string | null | undefined,
  fallback = 'Someone',
): string {
  const cleaned = (name ?? '')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > 40 ? `${cleaned.slice(0, 39)}…` : cleaned;
}

/** Which Settings category a notification type falls under, or null if it is never pushed. */
export function categoryForType(type: NotificationType): PushCategory | null {
  switch (type) {
    case NotificationType.LIKE:
    case NotificationType.COMMENT_LIKE:
      return 'likes';
    case NotificationType.COMMENT:
      return 'comments';
    case NotificationType.MENTION:
      return 'mentions';
    case NotificationType.FOLLOW:
      return 'follows';
    case NotificationType.ACTIVITY_INVITE:
    case NotificationType.JOIN_REQUEST:
      return 'activities';
    case NotificationType.COMMUNITY_JOIN:
    case NotificationType.COMMUNITY_JOIN_REQUEST:
      return 'communities';
    case NotificationType.MESSAGE:
      return 'messages';
    // SYSTEM and GROUP_INVITE stay in-app only.
    default:
      return null;
  }
}

export interface NotificationPushInput {
  id: string;
  type: NotificationType;
  entityType: NotificationEntityType | null;
  entityId: string | null;
  /** Re-read from the row; only `postId`, `isReply` and `aggregatedCount` are used. */
  postId: string | null;
  isReply: boolean;
  aggregatedCount: number;
  actorName: string;
  actorUsername: string | null;
}

const notificationsIntent: PushIntentData = { v: '1', t: 'notifications' };

function intentForNotification(n: NotificationPushInput): PushIntentData {
  const post = (id: string | null): PushIntentData =>
    id ? { v: '1', t: 'post', id } : notificationsIntent;
  switch (n.type) {
    case NotificationType.LIKE:
      return post(n.entityId);
    case NotificationType.COMMENT_LIKE:
    case NotificationType.COMMENT:
      return post(n.postId);
    case NotificationType.MENTION:
      return n.entityType === NotificationEntityType.POST
        ? post(n.entityId)
        : post(n.postId);
    case NotificationType.FOLLOW:
      return n.actorUsername
        ? { v: '1', t: 'profile', username: n.actorUsername }
        : notificationsIntent;
    case NotificationType.ACTIVITY_INVITE:
    case NotificationType.JOIN_REQUEST:
      return n.entityId
        ? { v: '1', t: 'activity', id: n.entityId }
        : notificationsIntent;
    case NotificationType.COMMUNITY_JOIN:
    case NotificationType.COMMUNITY_JOIN_REQUEST:
      return n.entityId
        ? { v: '1', t: 'community', id: n.entityId }
        : notificationsIntent;
    default:
      return notificationsIntent;
  }
}

function sentenceForNotification(n: NotificationPushInput): string | null {
  const name = n.actorName;
  const others = n.aggregatedCount - 1;
  const who =
    others > 0
      ? `${name} and ${others} ${others === 1 ? 'other' : 'others'}`
      : name;
  switch (n.type) {
    case NotificationType.LIKE:
      return `${who} liked your post.`;
    case NotificationType.COMMENT_LIKE:
      return `${who} liked your comment.`;
    case NotificationType.COMMENT:
      return n.isReply
        ? `${name} replied to your comment.`
        : `${name} commented on your post.`;
    case NotificationType.MENTION:
      return n.entityType === NotificationEntityType.COMMENT
        ? `${name} mentioned you in a comment.`
        : `${name} mentioned you in a post.`;
    case NotificationType.FOLLOW:
      return `${name} started following you.`;
    case NotificationType.ACTIVITY_INVITE:
      return `${name} invited you to an activity.`;
    case NotificationType.JOIN_REQUEST:
      return `${name} joined your activity.`;
    case NotificationType.COMMUNITY_JOIN:
      return `${name} joined your community.`;
    case NotificationType.COMMUNITY_JOIN_REQUEST:
      return `${name} requested to join your community.`;
    default:
      return null;
  }
}

/** The push for one notification row, or null when that type is never pushed. */
export function buildNotificationPush(
  n: NotificationPushInput,
): PushMessage | null {
  const category = categoryForType(n.type);
  const body = sentenceForNotification(n);
  if (!category || category === 'messages' || !body) return null;
  return {
    category,
    title: APP_NAME,
    body,
    intent: intentForNotification(n),
    // One tray entry per row: a second like on the same post replaces the
    // first ("A and 1 other liked your post.") instead of stacking.
    collapseKey: collapseKeyFor('n', n.id),
    urgency: 'normal',
    ttlSeconds: ONE_DAY,
  };
}

export interface MessagePushInput {
  /** Public id when the conversation has one: the id the chat route takes. */
  routeId: string;
  /** Internal id, for the collapse key only (never sent as routing data). */
  conversationId: string;
  isGroup: boolean;
  groupName: string | null;
  senderName: string;
  /** Unread messages for this recipient in this conversation, at send time. */
  unread: number;
}

/**
 * "You have a new message from Aarav." / "New message from Aarav" in a group.
 *
 * Never the text. A burst is one push whose count reflects the recipient's
 * unread count, which the conversation already tracks and resets on read, and
 * it replaces the previous push for the same conversation on the device.
 */
export function buildMessagePush(m: MessagePushInput): PushMessage {
  const count = Math.max(1, m.unread);
  const sender = m.senderName;
  const title = m.isGroup ? safeName(m.groupName, 'Group chat') : 'New message';
  const body = m.isGroup
    ? count > 1
      ? `${count} new messages`
      : `New message from ${sender}`
    : count > 1
      ? `You have ${count} new messages from ${sender}.`
      : `You have a new message from ${sender}.`;
  return {
    category: 'messages',
    title,
    body,
    intent: { v: '1', t: 'chat', conversationId: m.routeId },
    collapseKey: collapseKeyFor('c', m.conversationId),
    urgency: 'high',
    ttlSeconds: 4 * 60 * 60,
  };
}

export interface GroupRemovedPushInput {
  /** The id the app routes by (public id). */
  routeId: string;
  /** Conversation.id, for the collapse key only. */
  conversationId: string;
  groupName: string | null;
}

/**
 * "You were removed from <group>". On the messages channel, and under the
 * same collapse key as that group's message pushes, so it replaces any
 * "3 new messages" still in the tray for a group the person can no longer
 * open. Tapping it opens the chat, which shows the removed state.
 */
export function buildGroupRemovedPush(g: GroupRemovedPushInput): PushMessage {
  const name = safeName(g.groupName, 'a group');
  return {
    category: 'messages',
    title: APP_NAME,
    body: `You were removed from ${name}.`,
    intent: { v: '1', t: 'chat', conversationId: g.routeId },
    collapseKey: collapseKeyFor('c', g.conversationId),
    urgency: 'normal',
    ttlSeconds: ONE_DAY,
  };
}

export interface GroupJoinRequestPushInput {
  /** The id the app routes by (public id). */
  routeId: string;
  /** Conversation.id, for the collapse key only. */
  conversationId: string;
  groupName: string | null;
  requesterName: string | null;
}

/**
 * "<Name> asked to join <group>." to the group's owner and admins. One tray
 * entry per group (a second request replaces the first), apart from the
 * group's message pushes; tapping it opens the group, whose details hold the
 * requests.
 */
export function buildGroupJoinRequestPush(
  g: GroupJoinRequestPushInput,
): PushMessage {
  const who = safeName(g.requesterName, 'Someone');
  const group = safeName(g.groupName, 'your group');
  return {
    category: 'messages',
    title: APP_NAME,
    body: `${who} asked to join ${group}.`,
    intent: { v: '1', t: 'chat', conversationId: g.routeId },
    collapseKey: collapseKeyFor('n', `join-request:${g.conversationId}`),
    urgency: 'normal',
    ttlSeconds: ONE_DAY,
  };
}

/**
 * The web push body: exactly what the service worker reads. Kept small (web
 * push services accept 4 KB; this is well under 1 KB).
 */
export function webPushPayload(message: PushMessage): string {
  return JSON.stringify({
    title: message.title,
    body: message.body,
    tag: message.collapseKey,
    renotify: message.category === 'messages',
    data: message.intent,
  });
}
