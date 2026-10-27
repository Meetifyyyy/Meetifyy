import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import type { BackgroundWork } from '../observability/background-trace';
import { stub } from '../common/testing/stub';

const units: BackgroundWork[] = [];
jest.mock('../observability/background-trace', () => ({
  traceBackground: jest.fn(
    (work: BackgroundWork, run: () => Promise<unknown>) => {
      units.push(work);
      return run();
    },
  ),
}));

import {
  SOCKET_TRACE_RATES,
  SocketTraceInterceptor,
} from './socket-trace.interceptor';

function wsContext(event: string, type = 'ws'): ExecutionContext {
  return stub<ExecutionContext>({
    getType: <T extends string>() => type as T,
    switchToWs: () => ({ getPattern: () => event }),
  });
}

const handler = (result: unknown): CallHandler =>
  stub<CallHandler>({ handle: () => of(result) });

describe('SocketTraceInterceptor', () => {
  const interceptor = new SocketTraceInterceptor();
  beforeEach(() => {
    units.length = 0;
  });

  it('traces an event as one unit and passes its ack through', async () => {
    const ack = { status: 'ok' };
    const result = await lastValueFrom(
      interceptor.intercept(wsContext('message:send'), handler(ack)),
    );
    expect(result).toBe(ack);
    expect(units).toEqual([
      { name: 'ws message:send', op: 'websocket.server', traceRate: undefined },
    ]);
  });

  it('caps frequent events at their own rate', async () => {
    await lastValueFrom(
      interceptor.intercept(wsContext('typing:start'), handler(undefined)),
    );
    expect(units[0].traceRate).toBe(SOCKET_TRACE_RATES['typing:start']);
    expect(units[0].traceRate).toBeLessThan(0.1);
  });

  it('does not trace ping at all', async () => {
    const pong = { event: 'pong' };
    const result = await lastValueFrom(
      interceptor.intercept(wsContext('ping'), handler(pong)),
    );
    expect(result).toBe(pong);
    expect(units).toEqual([]);
  });

  it('a handler with no ack still completes', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(
        wsContext('post:leave'),
        stub<CallHandler>({
          handle: () => of(),
        }),
      ),
      { defaultValue: 'nothing' },
    );
    expect(result).toBeUndefined();
  });

  it("lets a handler's error reach the gateway as before", async () => {
    const failure = new Error('handler failed');
    await expect(
      lastValueFrom(
        interceptor.intercept(
          wsContext('message:send'),
          stub<CallHandler>({ handle: () => throwError(() => failure) }),
        ),
      ),
    ).rejects.toBe(failure);
  });

  it('leaves non-socket contexts alone', async () => {
    await lastValueFrom(
      interceptor.intercept(wsContext('x', 'http'), handler(1)),
    );
    expect(units).toEqual([]);
  });
});
