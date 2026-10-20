import type { RedisService } from '../../redis/redis.service';

/** How long the pair lock may be held before Redis expires it. */
const DM_CREATE_LOCK_TTL_MS = 5000;

/**
 * Lock key for creating a DM between two users. Built from the SORTED pair so
 * A->B and B->A tapping "Message" at the same moment contend for one lock, and
 * the second caller then finds the first one's conversation instead of
 * creating a duplicate under READ COMMITTED.
 */
export function dmCreateLockKey(userA: string, userB: string): string {
  const [lo, hi] = userA < userB ? [userA, userB] : [userB, userA];
  return `dm:create:${lo}:${hi}`;
}

/** Runs `fn` under the pair lock; runs it unlocked when no Redis service is wired. */
export function withDmCreateLock<T>(
  redis: RedisService | undefined,
  userA: string,
  userB: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!redis) return fn();
  return redis.withLock(
    dmCreateLockKey(userA, userB),
    DM_CREATE_LOCK_TTL_MS,
    fn,
  );
}
