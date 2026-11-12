import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { stub } from '../common/testing/stub';
import { RedisService } from './redis.service';

describe('RedisService heartbeat', () => {
  function connection(status: Redis['status']) {
    const ping = jest.fn<Promise<'PONG'>, []>(() => Promise.resolve('PONG'));
    return { redis: stub<Redis>({ status, ping }), ping };
  }

  it('pings every ready connection, the subscriber included', () => {
    const service = new RedisService(stub<ConfigService>());
    const shared = connection('ready');
    const sub = connection('ready');
    service['client'] = shared.redis;
    service['subClient'] = sub.redis;

    service['pingIdleConnections']();

    expect(shared.ping).toHaveBeenCalledTimes(1);
    expect(sub.ping).toHaveBeenCalledTimes(1);
  });

  it('leaves a connection that is not ready to ioredis', () => {
    const service = new RedisService(stub<ConfigService>());
    const shared = connection('reconnecting');
    service['client'] = shared.redis;

    service['pingIdleConnections']();

    expect(shared.ping).not.toHaveBeenCalled();
  });

  it('swallows a failed ping instead of raising an unhandled rejection', async () => {
    const service = new RedisService(stub<ConfigService>());
    const ping = jest.fn<Promise<'PONG'>, []>(() =>
      Promise.reject(new Error('Connection is closed')),
    );
    service['client'] = stub<Redis>({ status: 'ready', ping });

    expect(() => service['pingIdleConnections']()).not.toThrow();
    await Promise.resolve();
    expect(ping).toHaveBeenCalledTimes(1);
  });
});
