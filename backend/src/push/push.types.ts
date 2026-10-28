import { NotificationPreferences } from '@prisma/client';

/** The BullMQ queue push delivery runs on. Prefixed per environment like every queue. */
export const PUSH_QUEUE = 'push';

/** Job names on {@link PUSH_QUEUE}. */
export const PUSH_JOB = {
  notification: 'push-notification',
  message: 'push-message',
  groupRemoved: 'push-group-removed',
  groupJoinRequest: 'push-group-join-request',
} as const;

/**
 * What a user can switch off in Settings, per category. Each maps onto one
 * `push*` column of NotificationPreferences.
 */
export type PushCategory =
  | 'messages'
  | 'likes'
  | 'comments'
  | 'mentions'
  | 'follows'
  | 'activities'
  | 'communities';

export const PUSH_CATEGORIES: readonly PushCategory[] = [
  'messages',
  'likes',
  'comments',
  'mentions',
  'follows',
  'activities',
  'communities',
];

/** The NotificationPreferences column behind each category. */
export const CATEGORY_COLUMN = {
  messages: 'pushMessages',
  likes: 'pushLikes',
  comments: 'pushComments',
  mentions: 'pushMentions',
  follows: 'pushFollows',
  activities: 'pushActivities',
  communities: 'pushCommunities',
} as const satisfies Record<PushCategory, keyof NotificationPreferences>;

/**
 * Android notification channels. A contract with every APK that has shipped
 * with push: a channel's importance belongs to the user once created, so an id
 * is never repurposed, and the server only ever sends ids the oldest
 * push-capable APK creates (frontend/src/platform/capacitor/push.js).
 */
export type AndroidChannel = 'messages' | 'social' | 'activity' | 'community';

export const CATEGORY_CHANNEL: Record<PushCategory, AndroidChannel> = {
  messages: 'messages',
  likes: 'social',
  comments: 'social',
  mentions: 'social',
  follows: 'social',
  activities: 'activity',
  communities: 'community',
};

/**
 * Routing data carried by a push: the Intent wire format of
 * frontend/src/core/navigation/intents.ts (`intentToPushData`). Flat strings,
 * because FCM data values are strings. Nothing from the notification's content
 * goes in here.
 */
export type PushIntentData =
  | { v: '1'; t: 'notifications' }
  | { v: '1'; t: 'post'; id: string }
  | { v: '1'; t: 'profile'; username: string }
  | { v: '1'; t: 'community'; id: string }
  | { v: '1'; t: 'activity'; id: string }
  | { v: '1'; t: 'chat'; conversationId: string };

/** One user-visible push, provider-neutral. Built only by push-payload.ts. */
export interface PushMessage {
  category: PushCategory;
  title: string;
  body: string;
  intent: PushIntentData;
  /**
   * Replaces an earlier push with the same key on the device (web `tag`,
   * Android notification `tag`) and collapses queued ones while offline.
   */
  collapseKey: string;
  urgency: 'high' | 'normal';
  /** Seconds a push service may hold it for an offline device. */
  ttlSeconds: number;
}

/** What a provider made of one send. */
export type SendOutcome =
  | { kind: 'sent' }
  /** The registration is dead (FCM UNREGISTERED, web 404/410): delete it. */
  | { kind: 'gone' }
  /** Worth retrying (429, 5xx, network). */
  | { kind: 'retry'; reason: string }
  /** Our configuration is wrong (401/403, bad key). Never delete devices for this. */
  | { kind: 'config'; reason: string };

/** The job a notification row enqueues. Ids only: everything else is re-read at send time. */
export interface NotificationPushJob {
  notificationId: string;
  recipientId: string;
}

/** The job a chat message enqueues, one per recipient and conversation. */
/** Someone was removed from a group by an admin (not when they leave). */
export interface GroupRemovedPushJob {
  recipientId: string;
  /** Conversation.id (internal), never the public id. */
  conversationId: string;
  /** The removal's own time (`leftAt`), so a later re-add cancels this push. */
  removedAt: string;
}

/** A group admin's push for a new request to join. */
export interface GroupJoinRequestPushJob {
  /** An owner or admin of the group. */
  recipientId: string;
  /** Conversation.id (internal), never the public id. */
  conversationId: string;
  requesterId: string;
}

export interface MessagePushJob {
  recipientId: string;
  /** Conversation.id (internal), never the public id. */
  conversationId: string;
  senderId: string;
}
