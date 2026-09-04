import { Injectable, Logger } from '@nestjs/common';
import {
  RateLimiterMemory,
  RateLimiterRedis,
  RateLimiterRes,
} from 'rate-limiter-flexible';
import { createHmac } from 'crypto';
import { RedisService } from '../../redis/redis.service';
import { config } from '../../config';
import {
  RATE_LIMIT_POLICIES,
  RateLimitPolicy,
  RateLimitPolicyName,
} from '../../config/rate-limit.config';

/** The outcome of evaluating one policy. */
export interface RateLimitDecision {
  readonly policy: RateLimitPolicyName;
  readonly allowed: boolean;
  /** Points left in the window. */
  readonly remaining: number;
  /** Seconds until the budget refills. */
  readonly resetSeconds: number;
  readonly limit: number;
  readonly windowSeconds: number;
  /** True when the limit fired but shadow mode let the request through. */
  readonly shadowed: boolean;
  /** True when Redis could not answer and a fallback decided this. */
  readonly degraded: boolean;
}

interface LimiterEntry {
  limiter: RateLimiterMemory | RateLimiterRedis;
  /** Whether this entry is backed by Redis, so we know to rebuild if it wasn't. */
  redisBacked: boolean;
}

/**
 * Every rate-limit decision in the application goes through this service.
 *
 * It exists to hold the four things the previous per-guard implementations each
 * got wrong independently:
 *
 *  1. The Redis client is resolved PER CALL, not captured in a constructor.
 *     The old guards called `getClient()` once at bootstrap; ioredis connects
 *     lazily and asynchronously, so a process that started before Redis was
 *     ready stored `null` and had rate limiting silently disabled for its
 *     entire lifetime — no log line, no metric, no way to notice.
 *
 *  2. A Redis failure falls back to an in-memory limiter rather than removing
 *     the control. Per-instance counting is less accurate than shared counting,
 *     but it is enormously better than not counting at all, which is what
 *     "fail open" meant here.
 *
 *  3. Rejection is distinguished from failure by SHAPE, not by `instanceof
 *     Error`. The library rejects with a RateLimiterRes on a limit breach and
 *     an Error on a store failure — but so does a genuine bug inside the guard,
 *     and the old check quietly treated every bug as an outage and allowed the
 *     request.
 *
 *  4. Personal identifiers are hashed before they become Redis keys or log
 *     fields.
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger('RateLimit');

  /** One limiter per policy, built on first use and rebuilt if Redis appears. */
  private readonly limiters = new Map<string, LimiterEntry>();

  /** Per-instance fallbacks used when the Redis store cannot answer. */
  private readonly insurance = new Map<string, RateLimiterMemory>();

  /** Throttles the "running without Redis" warning to once a minute per policy. */
  private readonly lastDegradedWarn = new Map<string, number>();

  constructor(private readonly redisService: RedisService) {}

  /** Whether limits are enforced or only recorded. Never 'shadow' in production. */
  get mode(): 'enforce' | 'shadow' {
    return config.rateLimit.mode;
  }

  /**
   * Consumes one point against `policy` for `identifier`.
   *
   * Never throws. A caller that cannot get an answer gets an `allowed`
   * decision with `degraded: true`, and the failure is counted.
   */
  async consume(
    policy: RateLimitPolicyName,
    identifier: string,
    points = 1,
  ): Promise<RateLimitDecision> {
    const spec = RATE_LIMIT_POLICIES[policy] as RateLimitPolicy;
    const key = this.buildKey(policy, spec, identifier);

    const subject = this.subjectOf(identifier);

    try {
      const res = await this.limiterFor(policy, spec).consume(key, points);
      return this.decide(policy, spec, res, true, false, subject);
    } catch (err) {
      // A RateLimiterRes-shaped rejection means the budget is spent. Checking
      // the shape rather than `instanceof Error` is what stops a bug in this
      // file from being mistaken for a Redis outage and failing open.
      if (isRateLimiterRes(err)) {
        return this.decide(policy, spec, err, false, false, subject);
      }
      return this.handleStoreFailure(policy, spec, key, points, err, subject);
    }
  }

  /**
   * Consumes several policies together.
   *
   * All budgets are spent even when an earlier one rejects, so the cheaper key
   * cannot be probed indefinitely by a caller who knows it will be refused on
   * the expensive one. The first rejection is what gets reported.
   */
  async consumeAll(
    entries: Array<{ policy: RateLimitPolicyName; identifier: string }>,
  ): Promise<RateLimitDecision> {
    // An empty list is a wiring mistake, not a permission. Returning undefined
    // here would make the caller read `.allowed` off it and throw a TypeError
    // deep inside a request path; an explicit allow keeps the failure visible
    // in the logs instead of turning into a 500.
    if (!entries.length) {
      this.logger.warn(
        'ratelimit.no_policies_evaluated — consumeAll called with an empty list',
      );
      return {
        policy: 'global.user',
        allowed: true,
        remaining: 0,
        resetSeconds: 0,
        limit: 0,
        windowSeconds: 0,
        shadowed: false,
        degraded: true,
      };
    }

    const decisions = await Promise.all(
      entries.map(({ policy, identifier }) => this.consume(policy, identifier)),
    );

    const rejected = decisions.find((d) => !d.allowed);
    return rejected ?? decisions[0];
  }

  /**
   * Reads a budget WITHOUT spending a point.
   *
   * This is what makes "only failed attempts count" possible: the request is
   * checked on the way in, and a point is spent afterwards only if the attempt
   * actually failed. Consuming up front would let a user lock themselves out of
   * their own account by signing in successfully a few times.
   */
  async check(
    policy: RateLimitPolicyName,
    identifier: string,
  ): Promise<RateLimitDecision> {
    const spec = RATE_LIMIT_POLICIES[policy] as RateLimitPolicy;
    const key = this.buildKey(policy, spec, identifier);

    try {
      const res = await this.limiterFor(policy, spec).get(key);

      // No record yet — nothing has been spent.
      if (!res) {
        return {
          policy,
          allowed: true,
          remaining: spec.points,
          resetSeconds: spec.duration,
          limit: spec.points,
          windowSeconds: spec.duration,
          shadowed: false,
          degraded: false,
        };
      }

      // `>=`, not `>`. The library rejects when a consume pushes the count
      // ABOVE `points`, so a key sitting exactly AT `points` has nothing left
      // and the next attempt would be refused — which is precisely what this
      // read is asked to predict. `>` let one extra attempt through every time.
      const exhausted = res.consumedPoints >= spec.points;
      return this.decide(
        policy,
        spec,
        res,
        !exhausted,
        false,
        this.subjectOf(identifier),
      );
    } catch (err) {
      // A read failure must not refuse a legitimate sign-in; the consume path
      // that follows is where enforcement actually happens.
      this.warnDegraded(policy, (err as Error)?.message ?? String(err));
      return {
        policy,
        allowed: true,
        remaining: spec.points,
        resetSeconds: spec.duration,
        limit: spec.points,
        windowSeconds: spec.duration,
        shadowed: false,
        degraded: true,
      };
    }
  }

  /**
   * Spends a point after the fact — the counterpart to `check`.
   *
   * Deliberately returns nothing and never throws: the caller is already on a
   * failure path (a rejected password, a bad code) and the response it is about
   * to send must not change because the counter could not be written.
   */
  async penalize(
    policy: RateLimitPolicyName,
    identifier: string,
    points = 1,
  ): Promise<void> {
    try {
      await this.consume(policy, identifier, points);
    } catch {
      /* consume() already handles and records its own failures */
    }
  }

  /**
   * A short, stable, one-way label for whoever a decision was about.
   *
   * Always hashed, even for internal ids: this goes into log lines that may be
   * shipped to a third-party aggregator, and 12 hex characters is plenty to
   * count distinct subjects while being useless for identifying anyone.
   */
  private subjectOf(identifier: string): string {
    return this.hashIdentifier(identifier).slice(0, 12);
  }

  /**
   * Hashes a personal identifier — an IP or an email address — so it never
   * lands in Redis or a log line in the clear.
   *
   * Truncated to 128 bits: still far beyond collision risk at this cardinality,
   * and it keeps the keys short.
   */
  hashIdentifier(value: string): string {
    return createHmac('sha256', config.rateLimit.hashSecret)
      .update(value)
      .digest('hex')
      .slice(0, 32);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private buildKey(
    policy: string,
    spec: RateLimitPolicy,
    identifier: string,
  ): string {
    // User and resource ids are already internal, opaque and present in logs;
    // IPs and email addresses are personal data and are hashed.
    const needsHashing =
      spec.dimension === 'ip' || spec.dimension === 'account';
    const id = needsHashing ? this.hashIdentifier(identifier) : identifier;
    return `${policy}:${spec.dimension}:${id}`;
  }

  /**
   * The limiter for a policy, built on first use.
   *
   * Rebuilt once if it was created without Redis and Redis has since connected
   * — this is the recovery the old constructor-bound guards had no way of doing.
   */
  private limiterFor(policy: string, spec: RateLimitPolicy) {
    const existing = this.limiters.get(policy);
    const redis = this.redisService.getClient();

    if (existing && (existing.redisBacked || !redis)) {
      return existing.limiter;
    }

    const common = {
      points: spec.points,
      duration: spec.duration,
      ...(spec.blockDuration ? { blockDuration: spec.blockDuration } : {}),
      keyPrefix: `${config.rateLimit.keyPrefix}:`,
    };

    let entry: LimiterEntry;

    if (redis) {
      entry = {
        redisBacked: true,
        limiter: new RateLimiterRedis({
          ...common,
          storeClient: redis,
          // Keeps enforcing per-instance when the Redis store errors mid-flight,
          // instead of dropping the control entirely.
          insuranceLimiter: this.insuranceFor(policy, spec),
        }),
      };
      if (existing) {
        this.logger.log(
          `ratelimit.redis_recovered ${JSON.stringify({ policy })}`,
        );
      }
    } else {
      // No Redis configured or not yet connected — count in-process. Less
      // accurate across replicas, but a real limit rather than none.
      entry = { redisBacked: false, limiter: this.insuranceFor(policy, spec) };
      this.warnDegraded(policy, 'no-redis-client');
    }

    this.limiters.set(policy, entry);
    return entry.limiter;
  }

  private insuranceFor(policy: string, spec: RateLimitPolicy) {
    let mem = this.insurance.get(policy);
    if (!mem) {
      mem = new RateLimiterMemory({
        points: spec.points,
        duration: spec.duration,
        ...(spec.blockDuration ? { blockDuration: spec.blockDuration } : {}),
        keyPrefix: `${config.rateLimit.keyPrefix}:mem:`,
      });
      this.insurance.set(policy, mem);
    }
    return mem;
  }

  /**
   * The store could not answer. What happens next is a property of the policy,
   * not a global setting.
   */
  private async handleStoreFailure(
    policy: RateLimitPolicyName,
    spec: RateLimitPolicy,
    key: string,
    points: number,
    err: unknown,
    subject: string,
  ): Promise<RateLimitDecision> {
    this.warnDegraded(policy, (err as Error)?.message ?? String(err));

    if (spec.onRedisFailure === 'open') {
      return {
        policy,
        allowed: true,
        remaining: spec.points,
        resetSeconds: spec.duration,
        limit: spec.points,
        windowSeconds: spec.duration,
        shadowed: false,
        degraded: true,
      };
    }

    // 'closed' — an unmetered login or OTP endpoint during a Redis outage is
    // precisely when an attacker wants to arrive, so keep counting in-process.
    try {
      const res = await this.insuranceFor(policy, spec).consume(key, points);
      return { ...this.decide(policy, spec, res, true, true, subject) };
    } catch (memErr) {
      if (isRateLimiterRes(memErr)) {
        return this.decide(policy, spec, memErr, false, true, subject);
      }
      // Even the in-memory limiter failed. Refuse rather than leave a sensitive
      // endpoint unguarded.
      return {
        policy,
        allowed: false,
        remaining: 0,
        resetSeconds: spec.duration,
        limit: spec.points,
        windowSeconds: spec.duration,
        shadowed: false,
        degraded: true,
      };
    }
  }

  private decide(
    policy: RateLimitPolicyName,
    spec: RateLimitPolicy,
    res: RateLimiterRes,
    allowed: boolean,
    degraded: boolean,
    subject: string,
  ): RateLimitDecision {
    const resetSeconds = Math.max(1, Math.ceil((res.msBeforeNext ?? 0) / 1000));

    if (!allowed) {
      this.record(policy, spec, resetSeconds, degraded, subject);
    }

    return {
      policy,
      // Shadow mode records the breach and lets the request through.
      allowed: allowed || this.mode === 'shadow',
      remaining: Math.max(0, res.remainingPoints ?? 0),
      resetSeconds,
      limit: spec.points,
      windowSeconds: spec.duration,
      shadowed: !allowed && this.mode === 'shadow',
      degraded,
    };
  }

  /**
   * One structured line per rejection.
   *
   * `subject` is a short one-way hash of whoever was refused — never the user
   * id, the address or the email itself. It exists because the count of
   * rejections alone cannot answer the only question that matters when tuning a
   * limit: are MANY different people each hitting it once (the limit is too
   * tight, raise it), or is ONE person hitting it constantly (it is working)?
   * Those two look identical in a total, and opposite in a breakdown by
   * subject. Hashing keeps that measurable without putting anything personal in
   * the logs.
   *
   *   grep ratelimit.rejected app.log | grep '"policy":"msg.send.conversation"' \
   *     | grep -oP '"subject":"\K[^"]+' | sort | uniq -c | sort -rn
   */
  private record(
    policy: string,
    spec: RateLimitPolicy,
    resetSeconds: number,
    degraded: boolean,
    subject: string,
  ) {
    this.logger.warn(
      `ratelimit.rejected ${JSON.stringify({
        policy,
        dimension: spec.dimension,
        subject,
        limit: spec.points,
        window: spec.duration,
        resetSeconds,
        mode: this.mode,
        degraded,
        policyVersion: config.rateLimit.policyVersion,
        env: config.env,
      })}`,
    );
  }

  /**
   * Degraded operation is loud on purpose. The failure this replaces was
   * silent, which is why it survived so long.
   */
  private warnDegraded(policy: string, reason: string) {
    const now = Date.now();
    const last = this.lastDegradedWarn.get(policy) ?? 0;
    if (now - last < 60_000) return;
    this.lastDegradedWarn.set(policy, now);

    this.logger.error(
      `ratelimit.degraded ${JSON.stringify({
        policy,
        reason,
        effect:
          'counting in-process only; limits are not shared across instances',
        env: config.env,
      })}`,
    );
  }
}

/**
 * A rejection carries `msBeforeNext`; a store failure is an Error. Matching on
 * the shape rather than the class means an unexpected exception inside the
 * limiter is treated as a failure to be handled, never as a passing check.
 */
function isRateLimiterRes(err: unknown): err is RateLimiterRes {
  return (
    !!err &&
    typeof err === 'object' &&
    !(err instanceof Error) &&
    typeof (err as RateLimiterRes).msBeforeNext === 'number'
  );
}
