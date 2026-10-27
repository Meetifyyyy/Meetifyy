import {
  createTracesSampler,
  SWEEP_QUEUES,
  SWEEP_TRACE_RATE,
} from './trace-sampler';
import { TRACE_RATE_ATTRIBUTE } from './background-trace';
import { INSTANT_MATCH_QUEUE } from '../instant-match/instant-match.processor';

/**
 * Which traces the API keeps. Attribute shapes are the ones the SDK passes for
 * a root span (checked against a real Redis, BullMQ and Postgres: see
 * docs/sentry.md).
 */
type Attributes = Record<string, string | number | undefined>;

function decide(
  rate: number,
  name: string,
  attributes: Attributes = {},
  parentSampled?: boolean,
): number {
  const sample = createTracesSampler(rate);
  return sample({
    name,
    attributes,
    parentSampled,
    inheritOrSampleWith: (fallback: number) =>
      parentSampled === undefined ? fallback : Number(parentSampled),
  });
}

describe('API trace sampler', () => {
  describe('a database or cache call never starts a trace', () => {
    it("BullMQ's own Redis commands", () => {
      expect(
        decide(1, 'redis-bzpopmin', {
          'db.system': 'redis',
          'sentry.op': 'db.redis',
        }),
      ).toBe(0);
      expect(decide(1, 'redis-evalsha', { 'db.system': 'redis' })).toBe(0);
      expect(
        decide(1, 'redis-connect', {
          'db.system': 'redis',
          'sentry.op': 'db.redis.connect',
        }),
      ).toBe(0);
      expect(decide(1, 'redis-get', { 'db.system.name': 'redis' })).toBe(0);
    });

    it('a Prisma operation outside any request or unit', () => {
      expect(decide(1, 'prisma:client:operation', { method: 'findMany' })).toBe(
        0,
      );
      expect(decide(1, 'prisma:engine:js:query:sql')).toBe(0);
    });

    it('a Postgres query or a cache op, whatever the client', () => {
      expect(
        decide(1, 'SELECT 1', { 'db.system': 'postgresql', 'sentry.op': 'db' }),
      ).toBe(0);
      expect(decide(1, 'cache get', { 'sentry.op': 'cache.get' })).toBe(0);
    });
  });

  it('a Nest interceptor or guard never starts a trace', () => {
    // What Sentry wraps round SocketTraceInterceptor.intercept() on a socket
    // event: no request around it, so it would be a root.
    expect(
      decide(1, 'SocketTraceInterceptor', { 'sentry.op': 'middleware.nestjs' }),
    ).toBe(0);
  });

  it('samples the Instant Match sweep at its own low rate', () => {
    const sweep = {
      'sentry.op': 'queue.process',
      'messaging.destination.name': 'instant-match',
    };
    expect(decide(1, 'instant-match process', sweep)).toBe(SWEEP_TRACE_RATE);
    // Never above the environment's own rate.
    expect(decide(0.001, 'instant-match process', sweep)).toBe(0.001);
  });

  it('honours the rate a unit of background work declares, capped', () => {
    const typing = {
      'sentry.op': 'websocket.server',
      [TRACE_RATE_ATTRIBUTE]: 0.01,
    };
    expect(decide(1, 'ws typing:start', typing)).toBe(0.01);
    expect(decide(0.005, 'ws typing:start', typing)).toBe(0.005);
  });

  it('traces units, jobs and boot at the environment rate', () => {
    expect(
      decide(0.5, 'task sessions.retention-sweep', { 'sentry.op': 'task' }),
    ).toBe(0.5);
    expect(
      decide(0.5, 'push process', {
        'sentry.op': 'queue.process',
        'messaging.destination.name': 'push',
      }),
    ).toBe(0.5);
    expect(
      decide(0.5, 'Create Nest App', { 'sentry.op': 'app_creation.nestjs' }),
    ).toBe(0.5);
  });

  it('samples requests at the environment rate, or follows the browser', () => {
    expect(
      decide(0.1, 'GET /api/messages', { 'sentry.op': 'http.server' }),
    ).toBe(0.1);
    expect(decide(0.1, 'GET /api/messages', {}, true)).toBe(1);
    expect(decide(0.1, 'GET /api/messages', {}, false)).toBe(0);
  });

  it('names the sweep queue exactly as the processor does', () => {
    expect(SWEEP_QUEUES.has(INSTANT_MATCH_QUEUE)).toBe(true);
  });
});
