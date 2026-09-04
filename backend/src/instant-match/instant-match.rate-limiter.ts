import { Injectable } from '@nestjs/common';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * In-process fixed-window throttle for HIGH-FREQUENCY EPHEMERAL socket events —
 * typing indicators, presence heartbeats, pings.
 *
 * It previously also carried the durable Instant Match actions (`queue:join`,
 * `match:respond`). That was wrong once there was more than one replica: the
 * counters live in one process's memory, so the real ceiling was silently
 * multiplied by the number of instances and reset on every deploy. Those
 * actions now go through RateLimitService and share a Redis-backed budget.
 *
 * Per-process counting is the RIGHT choice for what remains. These events fire
 * many times a minute per socket, so a Redis round-trip each would cost more
 * than the events themselves, and the resource being protected is this
 * process's own event loop. Callers drop refused events silently rather than
 * acking an error — a lost typing indicator is invisible, an error toast is a
 * bug.
 */
@Injectable()
export class InstantMatchRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  /** Returns true when the action is allowed and consumes one point. */
  consume(key: string, points: number, windowMs: number): boolean {
    const now = Date.now();
    this.sweep(now);

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (bucket.count >= points) return false;

    bucket.count += 1;
    return true;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Drops elapsed windows so the map does not grow with every user seen. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
