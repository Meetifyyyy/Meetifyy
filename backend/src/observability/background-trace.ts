/**
 * One unit of background work — a timer tick, a socket event, a pub/sub
 * message — traced as ONE named transaction.
 *
 * Work that runs outside an HTTP request has no trace to join, so every
 * database query or Redis command inside it used to start a trace of its own:
 * on the development API, about 4,700 single-query traces in ten hours, none
 * of which said what work it was part of. trace-sampler.ts now drops a
 * database or cache call that starts a trace, and this is how such work is
 * traced instead: under its own name, with its queries as children, and at a
 * lower rate when it runs often.
 *
 * Each unit starts a NEW trace, detached from whatever happened to be active
 * when its timer or listener was registered. A timer armed during boot would
 * otherwise run every tick inside the boot trace, and each tick's spans would
 * be sent later as orphans of that long-finished trace.
 *
 * Errors are not affected by any of this: they are reported whether or not
 * their trace is sampled.
 */
import * as Sentry from '@sentry/nestjs';

/** Read by trace-sampler.ts as an upper bound on this unit's sample rate. */
export const TRACE_RATE_ATTRIBUTE = 'meetifyy.trace_rate';

export type BackgroundOp = 'task' | 'websocket.server' | 'pubsub.process';

export interface BackgroundWork {
  /** How it reads in Sentry, e.g. "task activities.lifecycle-sweep". */
  name: string;
  op: BackgroundOp;
  /**
   * Upper bound on how often this unit is traced, for work that runs every few
   * seconds. Never above the environment's rate. Omitted: the environment's.
   */
  traceRate?: number;
}

export async function traceBackground<T>(
  work: BackgroundWork,
  run: () => T | Promise<T>,
): Promise<T> {
  const attributes: Record<string, number> = {};
  if (work.traceRate !== undefined) {
    attributes[TRACE_RATE_ATTRIBUTE] = work.traceRate;
  }
  return Sentry.startNewTrace(() =>
    Sentry.startSpan(
      { name: work.name, op: work.op, forceTransaction: true, attributes },
      run,
    ),
  );
}
