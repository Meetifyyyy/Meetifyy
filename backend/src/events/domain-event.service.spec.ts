import type Redis from 'ioredis';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { stub } from '../common/testing/stub';
import type { RedisService } from '../redis/redis.service';
import { DomainEventService } from './domain-event.service';

describe('DomainEventService publish', () => {
  function build() {
    const publish = jest.fn<Promise<number>, [string, string]>(() =>
      Promise.resolve(1),
    );
    const emitter = new EventEmitter2();
    const local = jest.fn<void, [unknown]>();
    emitter.on('follow.created', local);
    const service = new DomainEventService(
      emitter,
      stub<RedisService>({
        getPubClient: () => stub<Redis>({ publish }),
      }),
    );
    return { service, publish, local };
  }

  it('stamps a fresh eventId on the Redis copy only', async () => {
    const { service, publish, local } = build();
    await service.emit('follow.created', { userId: 'u1' });
    await service.emit('follow.created', { userId: 'u1' });

    const sent = publish.mock.calls.map(
      ([, wire]) => JSON.parse(wire) as Record<string, unknown>,
    );
    expect(typeof sent[0].eventId).toBe('string');
    expect(sent[0].eventId).not.toBe(sent[1].eventId);
    expect(sent[0]).toMatchObject({
      type: 'follow.created',
      data: { userId: 'u1' },
      targetUserIds: ['u1'],
    });
    // In-process listeners get the event without the transport id.
    const [received] = local.mock.calls[0];
    expect(received).toMatchObject({ type: 'follow.created' });
    expect(Object.keys(received as object)).not.toContain('eventId');
  });
});
