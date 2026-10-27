import * as Sentry from '@sentry/nestjs';
import { TRACE_RATE_ATTRIBUTE, traceBackground } from './background-trace';

/**
 * A unit of background work is one transaction of its own, against the real
 * SDK: nothing is sent (the transport is a stub), every transaction that would
 * have been is recorded here.
 */
type Sent = { name?: string; op?: string; traceId?: string; parent?: string };
const sent: Sent[] = [];

beforeAll(() => {
  Sentry.init({
    dsn: 'https://public@o0.ingest.sentry.io/0',
    tracesSampleRate: 1,
    transport: () => ({
      send: () => Promise.resolve({}),
      flush: () => Promise.resolve(true),
    }),
    beforeSendTransaction(event) {
      sent.push({
        name: event.transaction,
        op: event.contexts?.trace?.op,
        traceId: event.contexts?.trace?.trace_id,
        parent: event.contexts?.trace?.parent_span_id,
      });
      return null;
    },
  });
});

afterAll(() => Sentry.close());
beforeEach(() => {
  sent.length = 0;
});

describe('traceBackground', () => {
  it('runs the work as one named transaction and returns its result', async () => {
    const result = await traceBackground(
      { name: 'task example.sweep', op: 'task' },
      () => Promise.resolve(42),
    );
    await Sentry.flush(2000);
    expect(result).toBe(42);
    expect(sent).toEqual([
      expect.objectContaining({ name: 'task example.sweep', op: 'task' }),
    ]);
  });

  it('starts a new trace even when another span is active', async () => {
    let outer = { traceId: '', spanId: '' };
    await Sentry.startSpan({ name: 'boot', forceTransaction: true }, (span) => {
      outer = span.spanContext();
      return traceBackground(
        { name: 'ws connect', op: 'websocket.server' },
        () => Promise.resolve(),
      );
    });
    await Sentry.flush(2000);
    const unit = sent.find((t) => t.name === 'ws connect');
    expect(unit).toBeDefined();
    expect(unit?.traceId).not.toBe(outer.traceId);
    // A fresh trace's "parent" is the SDK's random propagation id, never the
    // span that was active when the work was scheduled.
    expect(unit?.parent).not.toBe(outer.spanId);
  });

  it('declares its rate on the span for the sampler', async () => {
    let seen: unknown;
    await traceBackground(
      { name: 'ws typing:start', op: 'websocket.server', traceRate: 0.01 },
      () => {
        const active = Sentry.getActiveSpan();
        seen = active && Sentry.spanToJSON(active).data[TRACE_RATE_ATTRIBUTE];
      },
    );
    expect(seen).toBe(0.01);
  });

  it('passes a failure through unchanged', async () => {
    const failure = new Error('sweep failed');
    await expect(
      traceBackground({ name: 'task failing', op: 'task' }, () =>
        Promise.reject(failure),
      ),
    ).rejects.toBe(failure);
  });
});
