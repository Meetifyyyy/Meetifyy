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
  if (!redis || !clientMessageId) return fn();
  return redis.withLock(
    `msg:send:${senderId}:${clientMessageId}`,
    CLIENT_SEND_LOCK_TTL_MS,
    fn,
  );
}
