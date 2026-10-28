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

  it('pushes the first message of a burst at once', async () => {
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
    expect(opts.jobId).toMatch(/^m_b_conv-1_lead_/);
    expect(opts.delay).toBe(0);
    expect(opts.removeOnComplete).toBe(true);
  });

  it('collapses the rest of a burst into one delayed job per window', async () => {
    const { add, dispatcher } = build();
    const send = () =>
      dispatcher.enqueueForMessage({
        recipientId: 'b',
        conversationId: 'conv-1',
        senderId: 'a',
      });
    send();
    await flush();
    send();
    await flush();
    send();
    await flush();
    const [lead, second, third] = add.mock.calls.map(
      (c) => c[2] as { jobId: string; delay: number },
    );
    expect(lead.delay).toBe(0);
    expect(second.delay).toBeGreaterThan(0);
    // Same window, same id: BullMQ keeps one job for both.
    expect(third.jobId).toBe(second.jobId);
    expect(second.jobId).not.toBe(lead.jobId);
  });

  it('a different conversation opens its own burst', async () => {
    const { add, dispatcher } = build();
    dispatcher.enqueueForMessage({
      recipientId: 'b',
      conversationId: 'c1',
      senderId: 'a',
    });
    await flush();
    dispatcher.enqueueForMessage({
      recipientId: 'b',
      conversationId: 'c2',
      senderId: 'a',
    });
    await flush();
    expect(
      add.mock.calls.map((c) => (c[2] as { delay: number }).delay),
    ).toEqual([0, 0]);
  });

  it('a removal is one job per removal, retried, and safe to enqueue twice', async () => {
    const { add, dispatcher } = build();
    const job = {
      recipientId: 'b',
      conversationId: 'c',
      removedAt: '2026-10-28T10:00:00.000Z',
    };
    dispatcher.enqueueForGroupRemoval(job);
    dispatcher.enqueueForGroupRemoval(job);
    dispatcher.enqueueForGroupRemoval({
      ...job,
      removedAt: '2026-10-28T11:00:00.000Z',
    });
    await flush();
    const [first, repeat, later] = add.mock.calls;
    expect(first[0]).toBe(PUSH_JOB.groupRemoved);
    expect(first[1]).toEqual(job);
    expect(repeat[2].jobId).toBe(first[2].jobId);
    expect(later[2].jobId).not.toBe(first[2].jobId);
    expect(first[2]).toMatchObject({ attempts: 5 });
  });

  it('a removal enqueues nothing when push is off or the job is incomplete', async () => {
    const { add, dispatcher } = build();
    dispatcher.enqueueForGroupRemoval(null);
    dispatcher.enqueueForGroupRemoval({
      recipientId: 'b',
      conversationId: '',
      removedAt: '2026-10-28T10:00:00.000Z',
    });
    restore();
    restore = setPushConfig({ enabled: false, web: true, fcm: true });
    const off = build();
    off.dispatcher.enqueueForGroupRemoval({
      recipientId: 'b',
      conversationId: 'c',
      removedAt: '2026-10-28T10:00:00.000Z',
    });
    await flush();
    expect(add).not.toHaveBeenCalled();
    expect(off.add).not.toHaveBeenCalled();
  });

  it('a join request is one job per admin and request, safe to enqueue twice', async () => {
    const { add, dispatcher } = build();
    const job = {
      recipientId: 'admin',
      conversationId: 'c',
      requesterId: 'asker',
    };
    dispatcher.enqueueForGroupJoinRequest(job);
    dispatcher.enqueueForGroupJoinRequest(job);
    dispatcher.enqueueForGroupJoinRequest({ ...job, recipientId: 'owner' });
    await flush();
    const [first, repeat, other] = add.mock.calls;
    expect(first[0]).toBe(PUSH_JOB.groupJoinRequest);
    expect(repeat[2].jobId).toBe(first[2].jobId);
    expect(other[2].jobId).not.toBe(first[2].jobId);
  });
});
