import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import { RedisPresenceStore } from './presence-store';
import { PresenceService } from './presence.service';
import { presenceStoreContract } from './testing/presence-store-contract';

/**
 * Presence against a real Redis (MSG-16): the Lua scripts keep the same
 * contract as the in-memory store, and two services on their own connections,
 * standing in for two replicas, race without losing a socket or announcing a
 * change twice.
 *
 * Needs a disposable Redis on localhost named in PRESENCE_TEST_REDIS_URL.
 * Skipped otherwise, so it can never run against a shared one.
 */
const URL = process.env.PRESENCE_TEST_REDIS_URL ?? '';
const runnable = /^redis:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(URL);
const describeRedis = runnable ? describe : describe.skip;

describeRedis('presence on Redis', () => {
  const connections: Redis[] = [];
  const connect = () => {
    const redis = new Redis(URL, { lazyConnect: false });
    connections.push(redis);
    return redis;
  };

  afterAll(async () => {
    await Promise.all(connections.map((redis) => redis.quit()));
  });

  describe('RedisPresenceStore', () => {
    let redis: Redis;
    beforeAll(() => {
      redis = connect();
    });
    presenceStoreContract(() => new RedisPresenceStore(redis), randomUUID);

    it('gives the record a TTL on every write', async () => {
      const store = new RedisPresenceStore(redis);
      const user = randomUUID();
      await store.online(user, 'a', Date.now());
      const ttl = await redis.pttl(`presence:v2:${user}`);
      expect(ttl).toBeGreaterThan(80_000);
      expect(ttl).toBeLessThanOrEqual(90_000);
    });
  });

  describe('two replicas', () => {
    type Replica = {
      service: PresenceService;
      held: Set<string>;
      said: Array<[string, string]>;
    };
    const replica = (): Replica => {
      const redis = connect();
      const service = new PresenceService(
        stub<RedisService>({ getClient: () => redis }),
        stub<PrismaService>({
          user: { update: jest.fn(() => Promise.resolve({})) },
        }),
      );
      const held = new Set<string>();
      const said: Array<[string, string]> = [];
      service.registerSocketValidator((id) => held.has(id));
      service.onStatusChange((userId, status) => said.push([userId, status]));
      return { service, held, said };
    };
    const open = (r: Replica, user: string, socket: string) => {
      r.held.add(socket);
      return r.service.setOnline(user, socket);
    };
    const close = (r: Replica, user: string, socket: string) => {
      r.held.delete(socket);
      return r.service.setOffline(user, socket);
    };
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    let one: Replica;
    let two: Replica;
    beforeEach(() => {
      one = replica();
      two = replica();
    });
    const both = (user: string) =>
      [...one.said, ...two.said].filter(([id]) => id === user);

    it('two sockets connecting at once on different replicas are both kept, announced once', async () => {
      for (let round = 0; round < 100; round += 1) {
        const user = randomUUID();
        await Promise.all([
          open(one, user, `one-${round}`),
          open(two, user, `two-${round}`),
        ]);
        expect(both(user)).toEqual([[user, 'online']]);
        // Read through the replica that does not hold the second socket.
        const presence = await one.service.getPresence(user);
        expect([...(presence?.socketIds ?? [])].sort()).toEqual([
          `one-${round}`,
          `two-${round}`,
        ]);
      }
    });

    it('two sockets on one replica connecting at once are both kept', async () => {
      for (let round = 0; round < 100; round += 1) {
        const user = randomUUID();
        await Promise.all([
          open(one, user, `a-${round}`),
          open(one, user, `b-${round}`),
        ]);
        // Read through the replica holding both: nothing to prune, so a
        // missing socket can only be a lost write.
        const presence = await one.service.getPresence(user);
        expect(presence?.socketIds).toHaveLength(2);
        expect(both(user)).toEqual([[user, 'online']]);
      }
    });

    it('both replicas losing their socket together say offline once', async () => {
      const users = Array.from({ length: 20 }, () => randomUUID());
      await Promise.all(
        users.map((user) =>
          Promise.all([open(one, user, 'x'), open(two, user, 'y')]),
        ),
      );
      await Promise.all(
        users.map((user) =>
          Promise.all([close(one, user, 'x'), close(two, user, 'y')]),
        ),
      );
      await sleep(2600);
      for (const user of users) {
        expect(both(user)).toEqual([
          [user, 'online'],
          [user, 'offline'],
        ]);
        // A re-check may still be waiting on whichever replica saw the other
        // socket live; removing the record cancels it.
        await one.service.removePresence(user);
        await two.service.removePresence(user);
      }
    });

    it('a reconnect to the other replica inside the grace period shows nothing', async () => {
      const user = randomUUID();
      await open(one, user, 'x');
      await close(one, user, 'x');
      await sleep(500);
      await open(two, user, 'y');
      await sleep(2300);
      expect(both(user)).toEqual([[user, 'online']]);
      await expect(one.service.getPresence(user)).resolves.toMatchObject({
        status: 'online',
        socketIds: ['y'],
      });
    });
  });
});
