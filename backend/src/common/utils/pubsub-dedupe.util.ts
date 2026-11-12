import { randomUUID } from 'crypto';
import { LruCache } from './lru-cache.util';

/**
 * Drops pub/sub messages this process has already handled.
 *
 * Redis pub/sub is at most once on the wire, but ioredis makes it at least
 * once: when a connection drops with commands in flight it re-sends them on
 * reconnect (`autoResendUnfulfilledCommands`). A PUBLISH that reached the
 * server before the drop is then published again, and every subscriber
 * handles it twice — a second `message:new`, a second unread bump.
 *
 * Every published message carries a random id; a subscriber handles an id
 * once. The window only has to outlast a reconnect (seconds), so five minutes
 * is generous; the size cap bounds memory under a burst, and an id evicted by
 * the cap is far older than any resend.
 */
export class SeenMessageIds {
  private readonly seen = new LruCache<string, true>(20_000, 5 * 60_000);

  /** True the first time `id` is offered, false for a repeat. */
  firstSighting(id: string): boolean {
    if (this.seen.get(id)) return false;
    this.seen.set(id, true);
    return true;
  }
}

/** A fresh id for one published message. */
export function newMessageId(): string {
  return randomUUID();
}
