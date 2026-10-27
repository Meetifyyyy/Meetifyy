/**
 * Which traces the API keeps.
 *
 * Sentry asks this only for a span that STARTS a trace: an incoming request, a
 * queue job, a unit of background work (background-trace.ts), or anything else
 * that begins with no parent. Every span inside one of those inherits its
 * decision, so a request's database and Redis spans are kept or dropped with
 * the request — nothing here thins out a trace.
 *
 * WHY IT EXISTS: about ten hours of the development API on 2026-10-26, before
 * the org's span quota ran out. Sentry's estimate of what the API produced;
 * at the dev API's 20% sample rate it stored a fifth of each:
 *   redis-evalsha / redis-bzpopmin / redis-client …   ~121,000 spans
 *   instant-match process (the expiry sweep)           ~150,000 spans
 *   single Prisma queries from timers, sockets …       ~4,700 traces
 *   every real API request, together                   ~130,000 spans
 * The Redis ones were one-span traces of BullMQ's own polling and lock
 * renewals. The Prisma ones were queries made outside any request, each its
 * own trace. The sweep runs every ten seconds and does the same few queries
 * each time. Between them they spent the quota the requests needed.
 *
 * THE RULES, in order:
 *   1. A database or cache call never starts a trace, and neither does a
 *      Nest guard, interceptor or middleware. Inside a request or a job each
 *      is a child and is kept with it; on its own it is a fragment of work
 *      that should be traced as a unit instead (background-trace.ts). The
 *      Nest one is not hypothetical: Sentry wraps every @Injectable
 *      interceptor's intercept() in a span, and with no request around it —
 *      a socket event — that span was a trace of its own, once per event.
 *   2. The Instant Match sweep is traced at 1%.
 *   3. A unit that declares a lower rate (TRACE_RATE_ATTRIBUTE) gets it.
 *   4. Everything else: the environment's rate, or the browser's decision
 *      when the trace continues one.
 * Errors are not affected: they are sent whether or not their trace is.
 *
 * This file is loaded by instrument.ts before the rest of the app, so it must
 * not import application modules (they would load before Sentry instruments
 * them). The queue name is a literal for that reason; trace-sampler.spec.ts
 * keeps it equal to INSTANT_MATCH_QUEUE.
 */
import type { NodeOptions } from '@sentry/nestjs';
import { TRACE_RATE_ATTRIBUTE } from './background-trace';

type TracesSamplerContext = Parameters<
  NonNullable<NodeOptions['tracesSampler']>
>[0];
type Attributes = TracesSamplerContext['attributes'];

/**
 * Queues whose jobs are a timer, not work anyone asked for. The Instant Match
 * expiry sweep runs every 10 s (EXPIRY_SWEEP_MS), 8,640 times a day.
 */
export const SWEEP_QUEUES: ReadonlySet<string> = new Set(['instant-match']);

/** One sweep in a hundred is still about 86 a day: plenty to see its timings. */
export const SWEEP_TRACE_RATE = 0.01;

/**
 * A database or cache operation: Redis (ioredis), Postgres (node-postgres, if
 * it is ever re-enabled), and Prisma, whose own spans carry no `db.system` on
 * the operation itself but are all named `prisma:…`.
 */
function isDatabaseOrCacheCall(name: string, attributes: Attributes): boolean {
  if (attributes?.['db.system'] !== undefined) return true;
  if (attributes?.['db.system.name'] !== undefined) return true;
  const op = attributes?.['sentry.op'];
  if (typeof op === 'string' && /^(db|cache)(\.|$)/.test(op)) return true;
  return name.startsWith('prisma:');
}

/** A Nest guard, interceptor, pipe or middleware (op `middleware.nestjs`). */
function isFrameworkPlumbing(attributes: Attributes): boolean {
  const op = attributes?.['sentry.op'];
  return typeof op === 'string' && op.startsWith('middleware.');
}

function isSweepJob(attributes: Attributes): boolean {
  return (
    attributes?.['sentry.op'] === 'queue.process' &&
    SWEEP_QUEUES.has(String(attributes['messaging.destination.name']))
  );
}

function declaredRate(attributes: Attributes): number | undefined {
  const value = attributes?.[TRACE_RATE_ATTRIBUTE];
  return typeof value === 'number' && value >= 0 ? value : undefined;
}

/**
 * @param rate  the environment's trace sample rate (SENTRY_TRACES_SAMPLE_RATE)
 */
export function createTracesSampler(
  rate: number,
): (context: TracesSamplerContext) => number {
  return (context) => {
    if (isDatabaseOrCacheCall(context.name, context.attributes)) return 0;
    if (isFrameworkPlumbing(context.attributes)) return 0;
    if (isSweepJob(context.attributes)) return Math.min(rate, SWEEP_TRACE_RATE);
    const declared = declaredRate(context.attributes);
    if (declared !== undefined) return Math.min(rate, declared);
    // A request continuing a trace from the browser follows the browser's
    // decision; everything else is sampled at the environment's rate.
    return context.inheritOrSampleWith(rate);
  };
}
