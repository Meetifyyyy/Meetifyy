import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { NotificationType } from '@prisma/client';
import { stub } from '../common/testing/stub';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { DomainEventService } from '../events/domain-event.service';
import { BlocksService } from '../users/blocks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { NotificationsProcessor } from '../notifications/notifications.processor';
import {
  DispatchableNotification,
  PushDispatcherService,
} from './push-dispatcher.service';
import { MessagePushJob } from './push.types';
import { setPushConfig } from './testing/push-config.fixture';

/**
 * Every 10C category reaches the push queue through the one funnel the app
 * already uses for in-app notifications, exactly once, after the row is
 * written, and a push failure cannot reach the caller.
 *
 * The dtos come from the real NotificationFactory (and, for follows, the real
 * BullMQ processor), so these are the shapes the posts, comments, mentions,
 * activities, communities, users and messaging services actually send.
 */
const factory = new NotificationFactory();
const actor = {
  id: 'actor',
  username: 'aarav',
  displayName: 'Aarav',
  avatar: null,
};

type DispatcherDouble = {
  enqueueForNotification: jest.Mock<
    void,
    [DispatchableNotification | null | undefined]
  >;
  enqueueForMessage: jest.Mock<void, [MessagePushJob | null | undefined]>;
};
const dispatcherDouble = (): DispatcherDouble => ({
  enqueueForNotification: jest.fn<
    void,
    [DispatchableNotification | null | undefined]
  >(),
  enqueueForMessage: jest.fn<void, [MessagePushJob | null | undefined]>(),
});

function build(dispatcher: DispatcherDouble = dispatcherDouble()) {
  const writes: string[] = [];
  const row = (data: { type: NotificationType; recipientId: string }) => ({
    id: `row-${data.type}`,
    actorId: 'actor',
    entityId: 'e',
    updatedAt: new Date(),
    ...data,
  });
  const prisma = {
    notification: {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(
        ({
          create,
        }: {
          create: { type: NotificationType; recipientId: string };
        }) => {
          writes.push('upsert');
          return Promise.resolve(row(create));
        },
      ),
      create: jest.fn(
        ({
          data,
        }: {
          data: { type: NotificationType; recipientId: string };
        }) => {
          writes.push('create');
          return Promise.resolve(row(data));
        },
      ),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
    },
    notificationPreferences: { findUnique: jest.fn().mockResolvedValue(null) },
    user: { findUnique: jest.fn().mockResolvedValue(actor) },
  };
  const blocks = { isBlocked: jest.fn().mockResolvedValue(false) };
  dispatcher.enqueueForNotification.mockImplementation(() =>
    writes.push('enqueue'),
  );
  const service = new NotificationsService(
    stub<PrismaService>(prisma),
    stub<DomainEventService>({ emit: jest.fn().mockResolvedValue(undefined) }),
    stub<ConfigService>({}),
    stub<RedisService>({ getClient: () => null }),
    new EventEmitter2(),
    stub<BlocksService>(blocks),
    stub<PushDispatcherService>(dispatcher),
  );
  return { service, dispatcher, prisma, blocks, writes };
}

const post = { id: 'post-1', text: 'my post text' };
const comment = { id: 'comment-1', text: 'my comment text', postId: 'post-1' };

describe('push hooks: every category enqueues once, after the row is written', () => {
  it.each<
    [
      string,
      () => ReturnType<NotificationFactory['createLike']> | null,
      NotificationType,
    ]
  >([
    [
      'post like',
      () => factory.createLike(actor, post, 'author'),
      NotificationType.LIKE,
    ],
    [
      'comment like',
      () => factory.createCommentLike(actor, comment, 'author'),
      NotificationType.COMMENT_LIKE,
    ],
    [
      'comment on post',
      () => factory.createComment(actor, comment, post, 'author'),
      NotificationType.COMMENT,
    ],
    [
      'reply',
      () => factory.createCommentReply(actor, comment, post, 'author'),
      NotificationType.COMMENT,
    ],
    [
      'mention',
      () => factory.createMention(actor, 'author', 'POST', 'post-1', 'hey'),
      NotificationType.MENTION,
    ],
    [
      'activity participant join',
      () =>
        factory.createActivityJoin(
          actor,
          { id: 'act-1', title: 'Run' },
          'author',
        ),
      NotificationType.JOIN_REQUEST,
    ],
    [
      'community join',
      () =>
        factory.createCommunityJoin(
          actor,
          { id: 'k-1', name: 'Chess' },
          'author',
          'joined',
        ),
      NotificationType.COMMUNITY_JOIN,
    ],
    [
      'community join request',
      () =>
        factory.createCommunityJoin(
          actor,
          { id: 'k-1', name: 'Chess' },
          'author',
          'requested',
        ),
      NotificationType.COMMUNITY_JOIN_REQUEST,
    ],
  ])('%s', async (_label, make, type) => {
    const { service, dispatcher, writes } = build();
    await service.createNotification(make());
    expect(dispatcher.enqueueForNotification).toHaveBeenCalledTimes(1);
    expect(dispatcher.enqueueForNotification.mock.calls[0][0]).toMatchObject({
      type,
      recipientId: 'author',
    });
    // The row is written before the hand-off, never after.
    expect(writes.indexOf('enqueue')).toBeGreaterThan(writes.indexOf('upsert'));
  });

  it('activity invite (createActivityInviteNotifications)', async () => {
    const { service, dispatcher } = build();
    await service.createActivityInviteNotifications({
      activityId: 'act-1',
      inviterId: 'actor',
      invitations: [{ inviteeId: 'author', invitationId: 'inv-1' }],
      activityTitle: 'Run',
      inviter: { id: 'actor', name: 'Aarav', username: 'aarav' },
    });
    expect(dispatcher.enqueueForNotification).toHaveBeenCalledTimes(1);
    expect(dispatcher.enqueueForNotification.mock.calls[0][0]).toMatchObject({
      type: NotificationType.ACTIVITY_INVITE,
    });
  });

  it('follow (through the real BullMQ follow-notification job)', async () => {
    const { service, dispatcher } = build();
    const processor = new NotificationsProcessor(
      service,
      stub<DomainEventService>({ emit: jest.fn() }),
    );
    await processor.process(
      stub<Job>({
        name: 'follow-notification',
        data: {
          followerId: 'actor',
          followingId: 'author',
          actor: { username: 'aarav', displayName: 'Aarav', avatar: null },
        },
      }),
    );
    expect(dispatcher.enqueueForNotification).toHaveBeenCalledTimes(1);
    expect(dispatcher.enqueueForNotification.mock.calls[0][0]).toMatchObject({
      type: NotificationType.FOLLOW,
    });
  });

  it.each([
    ['DM', { id: 'conv-1', publicId: 'pub-1', type: 'DM' }],
    [
      'group message',
      { id: 'conv-2', publicId: 'pub-2', type: 'GROUP', name: 'Hostel B' },
    ],
  ])(
    '%s: no row, one message push keyed to the internal conversation',
    async (_l, conv) => {
      const { service, dispatcher, prisma } = build();
      const result = await service.createNotification(
        factory.createMessage(actor, conv, 'author', 'the actual message text'),
      );
      expect(result).toBeNull();
      expect(prisma.notification.upsert).not.toHaveBeenCalled();
      expect(dispatcher.enqueueForMessage).toHaveBeenCalledWith({
        recipientId: 'author',
        conversationId: conv.id,
        senderId: 'actor',
      });
      // Nothing of the message itself is handed to the push layer.
      expect(
        JSON.stringify(dispatcher.enqueueForMessage.mock.calls),
      ).not.toContain('actual message');
    },
  );

  it('Instant Match messages are never pushed', async () => {
    const { service, dispatcher } = build();
    await service.createNotification(
      factory.createMessage(
        actor,
        { id: 'c', type: 'INSTANT_MATCH', matchId: 'm' },
        'author',
        'hi',
      ),
    );
    expect(dispatcher.enqueueForMessage).toHaveBeenCalledWith(null);
  });

  it('no push for self-notifications or a blocked pair (nothing is written either)', async () => {
    const { service, dispatcher, blocks } = build();
    await service.createNotification(factory.createLike(actor, post, 'actor'));
    blocks.isBlocked.mockResolvedValue(true);
    await service.createNotification(factory.createLike(actor, post, 'author'));
    expect(dispatcher.enqueueForNotification).not.toHaveBeenCalled();
  });

  it('a push queue that is down cannot fail the action or lose the in-app row', async () => {
    const restore = setPushConfig({ enabled: true, web: true, fcm: true });
    try {
      const real = new PushDispatcherService(
        stub<Queue>({
          add: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        }),
        stub<RedisService>({ getClient: () => null }),
      );
      const double = dispatcherDouble();
      double.enqueueForNotification.mockImplementation((r) =>
        real.enqueueForNotification(r),
      );
      double.enqueueForMessage.mockImplementation((j) =>
        real.enqueueForMessage(j),
      );
      const { service, prisma } = build(double);
      const result = await service.createNotification(
        factory.createLike(actor, post, 'author'),
      );
      expect(result).toMatchObject({ type: NotificationType.LIKE });
      expect(prisma.notification.upsert).toHaveBeenCalledTimes(1);
      await expect(
        service.createNotification(
          factory.createMessage(actor, { id: 'c1', type: 'DM' }, 'author', 'x'),
        ),
      ).resolves.toBeNull();
      await new Promise((r) => setImmediate(r));
    } finally {
      restore();
    }
  });
});
