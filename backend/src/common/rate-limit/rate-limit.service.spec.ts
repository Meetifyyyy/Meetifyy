import { RateLimitService } from './rate-limit.service';
import { RedisService } from '../../redis/redis.service';

/**
 * These run against the in-memory fallback path (no Redis client), which is
 * exactly the path the old guards silently took whenever the process started
 * before Redis finished connecting — except that it enforced nothing.
 */
function serviceWithoutRedis(): RateLimitService {
  const redis = { getClient: () => null } as unknown as RedisService;
  return new RateLimitService(redis);
}

describe('RateLimitService', () => {
  describe('boundary behaviour', () => {
    it('allows exactly `points` requests and refuses the next', async () => {
      const svc = serviceWithoutRedis();
      const id = `user-${Math.random()}`;

      // auth.probe.ip is 20/60s.
      for (let i = 0; i < 20; i++) {
        const d = await svc.consume('auth.probe.ip', id);
        expect(d.allowed).toBe(true);
      }

      const refused = await svc.consume('auth.probe.ip', id);
      expect(refused.allowed).toBe(false);
      expect(refused.remaining).toBe(0);
      expect(refused.resetSeconds).toBeGreaterThan(0);
    });

    it('counts different identifiers independently', async () => {
      const svc = serviceWithoutRedis();

      for (let i = 0; i < 20; i++) await svc.consume('auth.probe.ip', 'a');

      expect((await svc.consume('auth.probe.ip', 'a')).allowed).toBe(false);
      expect((await svc.consume('auth.probe.ip', 'b')).allowed).toBe(true);
    });

    it('counts different policies independently', async () => {
      const svc = serviceWithoutRedis();
      const id = 'shared-identifier';

      for (let i = 0; i < 20; i++) await svc.consume('auth.probe.ip', id);

      expect((await svc.consume('auth.probe.ip', id)).allowed).toBe(false);
      expect((await svc.consume('global.user', id)).allowed).toBe(true);
    });
  });

  describe('concurrency', () => {
    /**
     * A read-then-write limiter lets all 50 through. The count must hold under
     * parallel consumption.
     */
    it('admits exactly the budget when requests arrive in parallel', async () => {
      const svc = serviceWithoutRedis();
      const id = `parallel-${Math.random()}`;

      const results = await Promise.all(
        Array.from({ length: 50 }, () => svc.consume('auth.probe.ip', id)),
      );

      expect(results.filter((r) => r.allowed)).toHaveLength(20);
      expect(results.filter((r) => !r.allowed)).toHaveLength(30);
    });
  });

  describe('consumeAll', () => {
    it('spends every budget even when an earlier one rejects', async () => {
      const svc = serviceWithoutRedis();
      const ip = `ip-${Math.random()}`;
      const email = `email-${Math.random()}`;

      // support.request.ip is 5/hour; support.request.email is 3/hour.
      // Five composite calls exhaust the email budget after three.
      const outcomes = [];
      for (let i = 0; i < 5; i++) {
        outcomes.push(
          await svc.consumeAll([
            { policy: 'support.request.ip', identifier: ip },
            { policy: 'support.request.email', identifier: email },
          ]),
        );
      }

      expect(outcomes.filter((o) => o.allowed)).toHaveLength(3);

      // The IP budget was still charged on the rejected attempts, so the
      // cheaper key cannot be probed indefinitely by someone who knows the
      // expensive one will refuse.
      expect((await svc.consume('support.request.ip', ip)).allowed).toBe(false);
    });

    it('reports the rejecting policy, not the first one evaluated', async () => {
      const svc = serviceWithoutRedis();
      const ip = `ip2-${Math.random()}`;
      const email = `email2-${Math.random()}`;

      for (let i = 0; i < 3; i++) {
        await svc.consumeAll([
          { policy: 'support.request.ip', identifier: ip },
          { policy: 'support.request.email', identifier: email },
        ]);
      }

      const rejected = await svc.consumeAll([
        { policy: 'support.request.ip', identifier: ip },
        { policy: 'support.request.email', identifier: email },
      ]);

      expect(rejected.allowed).toBe(false);
      expect(rejected.policy).toBe('support.request.email');
    });
  });

  describe('Redis unavailability', () => {
    /**
     * The defect this replaces: the old guards captured `getClient()` in their
     * constructor, so a process that booted before ioredis connected stored
     * null and enforced nothing for its entire lifetime, silently.
     */
    it('still enforces when there is no Redis client', async () => {
      const svc = serviceWithoutRedis();
      const id = `no-redis-${Math.random()}`;

      for (let i = 0; i < 20; i++) await svc.consume('auth.probe.ip', id);

      expect((await svc.consume('auth.probe.ip', id)).allowed).toBe(false);
    });

    it('recovers to the shared store once Redis connects', async () => {
      let client: any = null;
      const svc = new RateLimitService({
        getClient: () => client,
      } as unknown as RedisService);

      await svc.consume('global.user', 'user-1');

      // A client appearing later must be picked up; the old guards could not.
      client = { fake: true };
      const built = (svc as any).limiterFor('global.user', {
        points: 300,
        duration: 60,
        dimension: 'user',
        onRedisFailure: 'open',
        message: '',
      });

      expect(built.constructor.name).toBe('RateLimiterRedis');
    });

    /**
     * A store failure must not be confused with a limit breach. The old check
     * was `instanceof Error`, which also swallowed genuine bugs and allowed the
     * request; policies marked `closed` must keep counting instead.
     */
    it('keeps enforcing a sensitive policy when the store throws', async () => {
      const exploding = {
        getClient: () => ({}),
      } as unknown as RedisService;
      const svc = new RateLimitService(exploding);

      // Force the Redis-backed limiter to fail on every call.
      (svc as any).limiters.set('auth.login.ip', {
        redisBacked: true,
        limiter: {
          consume: () => Promise.reject(new Error('ECONNRESET')),
        },
      });

      const id = `store-fail-${Math.random()}`;
      const results = [];
      for (let i = 0; i < 12; i++) {
        results.push(await svc.consume('auth.login.ip', id));
      }

      // auth.login.ip is 10/300s and marked onRedisFailure: 'closed'.
      expect(results.filter((r) => r.allowed)).toHaveLength(10);
      expect(results.every((r) => r.degraded)).toBe(true);
    });

    it('allows a read policy through when the store throws', async () => {
      const svc = new RateLimitService({
        getClient: () => ({}),
      } as unknown as RedisService);

      (svc as any).limiters.set('global.user', {
        redisBacked: true,
        limiter: { consume: () => Promise.reject(new Error('ECONNRESET')) },
      });

      const d = await svc.consume('global.user', 'reader');
      expect(d.allowed).toBe(true);
      expect(d.degraded).toBe(true);
    });
  });

  describe('identifier hashing', () => {
    it('never puts a raw address or email in the key', () => {
      const svc = serviceWithoutRedis();
      const key = (svc as any).buildKey(
        'support.request.email',
        { dimension: 'account' },
        'student@example.edu',
      );

      expect(key).not.toContain('student@example.edu');
      expect(key).not.toContain('example.edu');
    });

    it('hashes deterministically so the same caller shares a bucket', () => {
      const svc = serviceWithoutRedis();
      expect(svc.hashIdentifier('203.0.113.7')).toBe(
        svc.hashIdentifier('203.0.113.7'),
      );
      expect(svc.hashIdentifier('203.0.113.7')).not.toBe(
        svc.hashIdentifier('203.0.113.8'),
      );
    });

    it('leaves internal ids readable, since they are already in the logs', () => {
      const svc = serviceWithoutRedis();
      const key = (svc as any).buildKey(
        'global.user',
        { dimension: 'user' },
        'user-abc-123',
      );
      expect(key).toContain('user-abc-123');
    });
  });

  describe('rejection logging', () => {
    /**
     * The whole point of the subject field: a total count cannot distinguish
     * "many people each hit this once" (limit too tight) from "one person hit
     * it fifty times" (working correctly). Those are opposite conclusions from
     * the same number, and only a breakdown by subject separates them.
     */
    it('labels each rejection with a stable subject so spread is measurable', async () => {
      const svc = serviceWithoutRedis();
      const lines: string[] = [];
      jest
        .spyOn((svc as any).logger, 'warn')
        .mockImplementation((m: string) => lines.push(m));

      // One user hits the wall repeatedly.
      for (let i = 0; i < 22; i++) await svc.consume('auth.probe.ip', 'heavy');
      // Two others are refused once each.
      for (let i = 0; i < 21; i++)
        await svc.consume('auth.probe.ip', 'light-1');
      for (let i = 0; i < 21; i++)
        await svc.consume('auth.probe.ip', 'light-2');

      const subjects = lines
        .filter((l) => l.includes('ratelimit.rejected'))
        .map((l) => JSON.parse(l.replace('ratelimit.rejected ', '')).subject);

      // Three distinct subjects, one of them dominating the count.
      const distinct = new Set(subjects);
      expect(distinct.size).toBe(3);

      const counts = [...distinct].map(
        (s) => subjects.filter((x) => x === s).length,
      );
      expect(Math.max(...counts)).toBeGreaterThan(Math.min(...counts));
    });

    it('never puts the raw identifier in the log line', async () => {
      const svc = serviceWithoutRedis();
      const lines: string[] = [];
      jest
        .spyOn((svc as any).logger, 'warn')
        .mockImplementation((m: string) => lines.push(m));

      const email = 'student@example.edu';
      for (let i = 0; i < 6; i++) {
        await svc.consume('support.request.email', email);
      }

      const rejected = lines.filter((l) => l.includes('ratelimit.rejected'));
      expect(rejected.length).toBeGreaterThan(0);
      for (const line of rejected) {
        expect(line).not.toContain(email);
        expect(line).not.toContain('example.edu');
      }
    });
  });
});
