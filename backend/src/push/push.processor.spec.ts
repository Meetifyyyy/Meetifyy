import { Job } from 'bullmq';
import Redis from 'ioredis';
import { PushPlatform } from '@prisma/client';
import { stub } from '../common/testing/stub';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PushAudienceService } from './push-audience.service';
import { PushProcessor, RetryablePushError } from './push.processor';
import { WebPushProvider } from './providers/web-push.provider';
import { FcmProvider } from './providers/fcm.provider';
import { PUSH_JOB, PushMessage, SendOutcome } from './push.types';
import {
  buildGroupJoinRequestPush,
  buildGroupRemovedPush,
  buildNotificationPush,
  GroupJoinRequestPushInput,
  GroupRemovedPushInput,
  NotificationPushInput,
} from './push-payload';

const message: PushMessage = {
  category: 'likes',
  title: 'Meetifyy',
  body: 'Aarav liked your post.',
  intent: { v: '1', t: 'post', id: 'post-1' },
  collapseKey: 'n-x',
  urgency: 'normal',
  ttlSeconds: 60,
};

type Device = {
  id: string;
  platform: PushPlatform;
  token: string;
  p256dh: string | null;
  auth: string | null;
};

function build(devices: Device[], outcomes: Record<string, SendOutcome[]>) {
  const marks = new Set<string>();
  const redis = {
    exists: jest.fn((key: string) => Promise.resolve(marks.has(key) ? 1 : 0)),
    set: jest.fn((key: string) => {
      marks.add(key);
      return Promise.resolve('OK');
    }),
  };
  const prisma = {
    pushDevice: {
      findMany: jest.fn().mockResolvedValue(devices),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const next = (key: string): SendOutcome =>
    outcomes[key]?.shift() ?? { kind: 'sent' };
  const webSend = jest.fn((target: { endpoint: string }, _m: PushMessage) =>
    Promise.resolve(next(target.endpoint)),
  );
  const fcmSend = jest.fn((token: string) => Promise.resolve(next(token)));
  const audience = {
    forNotification: jest.fn<
      Promise<NotificationPushInput | null>,
      [string, string]
    >(),
    forMessage: jest.fn(),
    forGroupRemoval: jest.fn<
      Promise<GroupRemovedPushInput | null>,
      [string, string, string]
    >(),
    forGroupJoinRequest: jest.fn<
      Promise<GroupJoinRequestPushInput | null>,
      [string, string, string]
    >(),
  };
  const processor = new PushProcessor(
    stub<PrismaService>(prisma),
    stub<RedisService>({
      getClient: () => stub<Redis>({ exists: redis.exists, set: redis.set }),
    }),
    stub<PushAudienceService>(audience),
    stub<WebPushProvider>({ configured: true, send: webSend }),
    stub<FcmProvider>({ configured: true, send: fcmSend }),
  );
  return { processor, prisma, webSend, fcmSend, audience };
}

const web: Device = {
  id: 'd-web',
  platform: PushPlatform.WEB,
  token: 'https://fcm.googleapis.com/x',
  p256dh: 'k',
  auth: 'a',
};
const phone: Device = {
  id: 'd-phone',
  platform: PushPlatform.ANDROID,
  token: 'fcm-token',
  p256dh: null,
  auth: null,
};

describe('PushProcessor.deliver', () => {
  it('sends once to every device the recipient holds now (multiple devices)', async () => {
    const { processor, webSend, fcmSend, prisma } = build([web, phone], {});
    await processor.deliver('user-a', message, 'k1');
    expect(prisma.pushDevice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-a' } }),
    );
    expect(webSend).toHaveBeenCalledTimes(1);
    expect(fcmSend).toHaveBeenCalledTimes(1);
  });

  it('deletes a dead registration (FCM UNREGISTERED / web 410), scoped to the recipient', async () => {
    const { processor, prisma } = build([phone], {
      'fcm-token': [{ kind: 'gone' }],
    });
    await processor.deliver('user-a', message, 'k1');
    expect(prisma.pushDevice.deleteMany).toHaveBeenCalledWith({
      where: { id: 'd-phone', userId: 'user-a' },
    });
  });

  it('never deletes devices for our own configuration errors', async () => {
    const { processor, prisma } = build([phone], {
      'fcm-token': [{ kind: 'config', reason: 'auth' }],
    });
    await processor.deliver('user-a', message, 'k1');
    expect(prisma.pushDevice.deleteMany).not.toHaveBeenCalled();
  });

  it('retries a transient failure without re-sending to devices that already got it', async () => {
    const { processor, webSend, fcmSend } = build([web, phone], {
      'fcm-token': [{ kind: 'retry', reason: '503' }],
    });
    await expect(
      processor.deliver('user-a', message, 'k1'),
    ).rejects.toBeInstanceOf(RetryablePushError);
    // The BullMQ retry: the web device is marked sent and skipped.
    await processor.deliver('user-a', message, 'k1');
    expect(webSend).toHaveBeenCalledTimes(1);
    expect(fcmSend).toHaveBeenCalledTimes(2);
  });

  it('a duplicate job for the same event delivers nothing new', async () => {
    const { processor, webSend } = build([web], {});
    await processor.deliver('user-a', message, 'k1');
    await processor.deliver('user-a', message, 'k1');
    expect(webSend).toHaveBeenCalledTimes(1);
  });
});

describe('PushProcessor.process', () => {
  const job = (name: string, data: unknown) =>
    stub<Job<unknown>>({ name, data, id: 'job-1' });

  it('drops a job the audience check refuses (deleted, read, blocked, prefs off)', async () => {
    const { processor, audience, webSend } = build([web], {});
    audience.forNotification.mockResolvedValue(null);
    await processor.process(
      job(PUSH_JOB.notification, {
        notificationId: 'n1',
        recipientId: 'user-a',
      }),
    );
    expect(audience.forNotification).toHaveBeenCalledWith('n1', 'user-a');
    expect(webSend).not.toHaveBeenCalled();
  });

  it('ignores malformed job data instead of trusting it', async () => {
    const { processor, audience } = build([web], {});
    await processor.process(job(PUSH_JOB.notification, { notificationId: 42 }));
    await processor.process(job(PUSH_JOB.message, 'nope'));
    await processor.process(
      job(PUSH_JOB.groupRemoved, { recipientId: 'user-a', conversationId: 7 }),
    );
    expect(audience.forNotification).not.toHaveBeenCalled();
    expect(audience.forMessage).not.toHaveBeenCalled();
    expect(audience.forGroupRemoval).not.toHaveBeenCalled();
  });

  it('sends the built payload for an allowed notification', async () => {
    const { processor, audience, webSend } = build([web], {});
    const input: NotificationPushInput = {
      id: 'n1',
      type: 'LIKE',
      entityType: 'POST',
      entityId: 'post-1',
      postId: 'post-1',
      isReply: false,
      aggregatedCount: 1,
      actorName: 'Aarav',
      actorUsername: 'aarav',
    };
    audience.forNotification.mockResolvedValue(input);
    await processor.process(
      job(PUSH_JOB.notification, {
        notificationId: 'n1',
        recipientId: 'user-a',
      }),
    );
    expect(webSend.mock.calls[0][1]).toEqual(buildNotificationPush(input));
  });

  it('a removal is re-checked at send time and sent only if it still stands', async () => {
    const { processor, audience, webSend } = build([web], {});
    const data = {
      recipientId: 'user-a',
      conversationId: 'conv-1',
      removedAt: '2026-10-28T10:00:00.000Z',
    };
    audience.forGroupRemoval.mockResolvedValueOnce(null);
    await processor.process(job(PUSH_JOB.groupRemoved, data));
    expect(audience.forGroupRemoval).toHaveBeenCalledWith(
      'user-a',
      'conv-1',
      '2026-10-28T10:00:00.000Z',
    );
    expect(webSend).not.toHaveBeenCalled();

    const input: GroupRemovedPushInput = {
      routeId: 'pub-1',
      conversationId: 'conv-1',
      groupName: 'Hostel B',
    };
    audience.forGroupRemoval.mockResolvedValueOnce(input);
    await processor.process(job(PUSH_JOB.groupRemoved, data));
    expect(webSend.mock.calls[0][1]).toEqual(buildGroupRemovedPush(input));
  });

  it('a join request is re-checked at send time and sent to that admin', async () => {
    const { processor, audience, webSend } = build([web], {});
    const data = {
      recipientId: 'admin',
      conversationId: 'conv-1',
      requesterId: 'asker',
    };
    audience.forGroupJoinRequest.mockResolvedValueOnce(null);
    await processor.process(job(PUSH_JOB.groupJoinRequest, data));
    expect(webSend).not.toHaveBeenCalled();
    const input: GroupJoinRequestPushInput = {
      routeId: 'pub-1',
      conversationId: 'conv-1',
      groupName: 'Hostel B',
      requesterName: 'Aarav',
    };
    audience.forGroupJoinRequest.mockResolvedValueOnce(input);
    await processor.process(job(PUSH_JOB.groupJoinRequest, data));
    expect(webSend.mock.calls[0][1]).toEqual(buildGroupJoinRequestPush(input));
    expect(buildGroupJoinRequestPush(input).body).toBe(
      'Aarav asked to join Hostel B.',
    );
  });
});
