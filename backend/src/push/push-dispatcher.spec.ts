import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { NotificationType } from '@prisma/client';
import { stub } from '../common/testing/stub';
import { RedisService } from '../redis/redis.service';
import {
  DispatchableNotification,
  PushDispatcherService,
} from './push-dispatcher.service';
import { PUSH_JOB } from './push.types';
import { setPushConfig } from './testing/push-config.fixture';

/** A tiny in-memory stand-in for the two Redis calls the dispatcher makes. */
function fakeRedis() {
  const keys = new Set<string>();
  return {
    keys,
    set: jest.fn((key: string, ..._rest: Array<string | number>) => {
      if (keys.has(key)) return Promise.resolve(null);
      keys.add(key);
      return Promise.resolve('OK');
    }),
  };
}

const flush = () => new Promise((r) => setImmediate(r));

const row = (
  over: Partial<DispatchableNotification> = {},
): DispatchableNotification => ({
  id: 'notif-1',
  recipientId: 'author',
  actorId: 'liker',
  type: NotificationType.LIKE,
  entityId: 'post-1',
  updatedAt: new Date(1_700_000_000_000),
  ...over,
});

function build(addImpl?: () => Promise<unknown>) {
  const add = jest.fn<Promise<unknown>, [string, unknown, { jobId?: string }]>(
    addImpl ?? (() => Promise.resolve({})),
  );
  const redis = fakeRedis();
  const dispatcher = new PushDispatcherService(
    stub<Queue>({ add }),
    stub<RedisService>({ getClient: () => stub<Redis>({ set: redis.set }) }),
  );
  return { add, redis, dispatcher };
}

describe('PushDispatcherService', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = setPushConfig({ enabled: true, web: true, fcm: true });
  });
  afterEach(() => restore());

  it('does nothing while PUSH_ENABLED is off (the default)', async () => {
    restore();
    restore = setPushConfig({ enabled: false, web: true, fcm: true });
    const { add, dispatcher } = build();
    dispatcher.enqueueForNotification(row());
    dispatcher.enqueueForMessage({
      recipientId: 'b',
      conversationId: 'c',
      senderId: 'a',
    });
    await flush();
    expect(add).not.toHaveBeenCalled();
  });

  it('enqueues a committed row once, keyed by row id and version', async () => {
    const { add, dispatcher } = build();
    dispatcher.enqueueForNotification(row());
    await flush();
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][0]).toBe(PUSH_JOB.notification);
    expect(add.mock.calls[0][1]).toEqual({
      notificationId: 'notif-1',
      recipientId: 'author',
    });
    expect(add.mock.calls[0][2].jobId).toBe('n_notif-1_1700000000000');
  });

  it('like/unlike/like flapping by the same actor pushes once per window', async () => {
    const { add, dispatcher } = build();
    dispatcher.enqueueForNotification(row());
    await flush();
    dispatcher.enqueueForNotification(
      row({ updatedAt: new Date(1_700_000_005_000) }),
    );
    await flush();
    expect(add).toHaveBeenCalledTimes(1);
    // A different actor aggregating into the same row still pushes.
    dispatcher.enqueueForNotification(
      row({ actorId: 'second-liker', updatedAt: new Date(1_700_000_009_000) }),
    );
    await flush();
    expect(add).toHaveBeenCalledTimes(2);
  });

  it('never notifies yourself and never pushes SYSTEM rows', async () => {
    const { add, dispatcher } = build();
    dispatcher.enqueueForNotification(row({ actorId: 'author' }));
    dispatcher.enqueueForNotification(row({ type: NotificationType.SYSTEM }));
    dispatcher.enqueueForMessage({
      recipientId: 'a',
      conversationId: 'c',
      senderId: 'a',
    });
    await flush();
    expect(add).not.toHaveBeenCalled();
  });

  it('a queue that is down never throws into the action', async () => {
    const { dispatcher } = build(() =>
      Promise.reject(new Error('ECONNREFUSED')),
    );
    expect(() => dispatcher.enqueueForNotification(row())).not.toThrow();
    expect(() =>
      dispatcher.enqueueForMessage({
        recipientId: 'b',
        conversationId: 'c',
        senderId: 'a',
      }),
    ).not.toThrow();
    await flush();
  });

  it('a queue that throws synchronously never throws into the action', () => {
    const add = jest.fn(() => {
      throw new Error('boom');
    });
    const dispatcher = new PushDispatcherService(
      stub<Queue>({ add }),
      stub<RedisService>({ getClient: () => null }),
    );
    expect(() =>
      dispatcher.enqueueForMessage({
        recipientId: 'b',
        conversationId: 'c',
        senderId: 'a',
      }),
    ).not.toThrow();
  });

  it('collapses a message burst into one delayed job per recipient and conversation', async () => {
    const { add, dispatcher } = build();
    dispatcher.enqueueForMessage({
      recipientId: 'b',
      conversationId: 'conv-1',
      senderId: 'a',
    });
    await flush();
    const opts = add.mock.calls[0][2] as {
      jobId: string;
      delay: number;
      removeOnComplete: boolean;
    };
    expect(opts.jobId).toBe('m_b_conv-1');
    expect(opts.delay).toBeGreaterThan(0);
    expect(opts.removeOnComplete).toBe(true);
  });
});
