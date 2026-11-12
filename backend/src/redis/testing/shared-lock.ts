import type { RedisService } from '../redis.service';
import { stub } from '../../common/testing/stub';

/**
 * A `RedisService` whose `runIfLockFree` behaves like the real one across
 * several "replicas": every caller built from the same instance shares one set
 * of held keys, a caller that finds its key held is skipped, and the key is
 * released when the work settles. Never constructs the real service.
 */
export function sharedLock(): RedisService {
  const held = new Set<string>();
  const runIfLockFree: RedisService['runIfLockFree'] = async (
    key,
    _ttlMs,
    fn,
  ) => {
    if (held.has(key)) return { ran: false };
    held.add(key);
    try {
      return { ran: true, value: await fn() };
    } finally {
      held.delete(key);
    }
  };
  return stub<RedisService>({ runIfLockFree, getClient: () => null });
}
