import type { RedisService } from '../../redis/redis.service';

/** How long a send may hold its lock before Redis expires it. */
const CLIENT_SEND_LOCK_TTL_MS = 10_000;

/**
 * Serialises sends that carry the same client message id.
 *
 * Idempotency for messages is "look for a row with this `clientMessageId`,
 * otherwise insert one". Two copies of the same send arriving together (a
 * socket send and its REST fallback, or a retry racing the original) could
 * both find nothing and both insert, because the column's index is not
 * unique. Under this lock the second waits, then finds the first's row.
 * Without a client id there is nothing to match on, so nothing is locked.
 */
export function withClientSendLock<T>(
  redis: RedisService | undefined,
  senderId: string,
  clientMessageId: string | null | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!clientMessageId) return Promise.resolve(fn());
  // Only while Redis is up. Sending never depended on Redis before this lock,
  // and a lock that throws or queues while Redis is down would stop every
  // send with it. Unlocked, a send still dedupes by `clientMessageId`; only
  // the narrow two-copies-at-once race is uncovered while Redis is out.
  if (redis?.getClient()?.status !== 'ready') return fn();
  return runLocked(redis, `msg:send:${senderId}:${clientMessageId}`, fn);
}

async function runLocked<T>(
  redis: RedisService,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  let ran = false;
  try {
    return await redis.withLock(key, CLIENT_SEND_LOCK_TTL_MS, () => {
      ran = true;
      return fn();
    });
  } catch (err: unknown) {
    // The lock failed before the send ran (Redis dropped mid-acquire): send
    // anyway. An error from the send itself is the caller's, unchanged.
    if (!ran) return fn();
    throw err;
  }
}
