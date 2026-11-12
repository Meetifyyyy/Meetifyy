import type { RedisService } from './redis.service';

/**
 * Runs `fn` unless another replica is already running the same sweep.
 *
 * `RedisService.runIfLockFree` is the primitive, but it rejects when Redis
 * cannot be reached, and a housekeeping sweep should not stop because a cache
 * is down. Every caller of this wraps work that is safe to repeat (a delete of
 * rows past a cut-off, a cache drop), so the lock only prevents redundant
 * overlap and giving it up is harmless: with the lock unavailable the sweep
 * runs unlocked, exactly as it did before there was a lock.
 *
 * Not for work whose side effects must happen once. That needs a claim in the
 * database, which stays correct when Redis is down.
 */
export async function runOnOneReplica<T>(
  redis: Pick<RedisService, 'runIfLockFree'> | undefined,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false }> {
  if (!redis) return { ran: true, value: await fn() };

  // Tells a failure to take the lock apart from a failure of `fn` itself: only
  // the first falls back to running unlocked, the second is the caller's.
  let started = false;
  try {
    return await redis.runIfLockFree(key, ttlMs, () => {
      started = true;
      return fn();
    });
  } catch (err: unknown) {
    if (started) throw err;
    return { ran: true, value: await fn() };
  }
}
