import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationType } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventService } from '../events/domain-event.service';
import { RedisService } from '../redis/redis.service';
import { BlocksService } from '../users/blocks.service';
import { stub } from '../common/testing/stub';

type Where = { where: Record<string, unknown> };

describe('NotificationsService.cancelNotificationsByType', () => {
  const build = (rows: { id: string }[]) => {
    const findMany = jest.fn<Promise<{ id: string }[]>, [Where]>(() =>
      Promise.resolve(rows),
    );
    const updateMany = jest.fn<Promise<{ count: number }>, [Where]>(() =>
      Promise.resolve({ count: rows.length }),
    );
    const count = jest.fn<Promise<number>, [Where]>(() => Promise.resolve(0));
    const emit = jest.fn<Promise<void>, [string, unknown, unknown?]>(() =>
      Promise.resolve(),
    );
    const del = jest.fn<Promise<number>, [string]>(() => Promise.resolve(1));
    // The recount reads the cache (now empty) and writes the result back.
    const get = jest.fn<Promise<string | null>, [string]>(() =>
      Promise.resolve(null),
    );
    const set = jest.fn<Promise<string>, unknown[]>(() =>
      Promise.resolve('OK'),
    );
    const service = new NotificationsService(
      stub<PrismaService>({
        notification: { findMany, updateMany, count },
      }),
      stub<DomainEventService>({ emit }),
      stub<ConfigService>({}),
      stub<RedisService>({
        getClient: () =>
          ({ del, get, set }) as unknown as ReturnType<
            RedisService['getClient']
          >,
      }),
      new EventEmitter2(),
      stub<BlocksService>({}),
    );
    return { service, findMany, updateMany, emit, del, count };
  };

  it('soft-deletes every live notification of that type for the recipient, and only those', async () => {
    const { service, findMany, updateMany } = build([
      { id: 'n1' },
      { id: 'n2' },
    ]);

    const n = await service.cancelNotificationsByType({
      recipientId: 'me-id',
      type: NotificationType.FOLLOW_REQUEST,
    });

    expect(n).toBe(2);
    expect(findMany.mock.calls[0][0].where).toEqual({
      recipientId: 'me-id',
      type: 'FOLLOW_REQUEST',
      deletedAt: null,
    });
    const write = updateMany.mock.calls[0][0] as Where & {
      data: { deletedAt: unknown };
    };
    expect(write.where).toEqual({ id: { in: ['n1', 'n2'] } });
    expect(write.data.deletedAt).toBeInstanceOf(Date);
  });

  it('recomputes the unread badge from the table and tells the client which rows went', async () => {
    const { service, emit, del, count } = build([{ id: 'n1' }, { id: 'n2' }]);

    await service.cancelNotificationsByType({
      recipientId: 'me-id',
      type: NotificationType.FOLLOW_REQUEST,
    });

    expect(del).toHaveBeenCalledWith('notifications:unread:v2:me-id');
    expect(count).toHaveBeenCalledTimes(1);
    const cancelled = emit.mock.calls.filter(
      (c) => c[0] === 'notification:cancelled',
    );
    expect(cancelled.map((c) => c[1])).toEqual([
      { notificationId: 'n1', recipientId: 'me-id' },
      { notificationId: 'n2', recipientId: 'me-id' },
    ]);
  });

  it('does nothing when there is nothing to cancel', async () => {
    const { service, updateMany, emit } = build([]);

    const n = await service.cancelNotificationsByType({
      recipientId: 'me-id',
      type: NotificationType.FOLLOW_REQUEST,
    });

    expect(n).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});
