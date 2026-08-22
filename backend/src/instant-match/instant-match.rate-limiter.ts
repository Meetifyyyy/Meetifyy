import { Injectable } from '@nestjs/common';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window per-user limiter for Instant Match socket actions.
 *
 * Deliberately in-process: these limits exist to stop one client hammering
 * `queue:join` or spamming responses, and a per-instance ceiling is enough
 * for that. Correctness guarantees (duplicate prevention, authorization)
 * live in the database transitions, not here.
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
