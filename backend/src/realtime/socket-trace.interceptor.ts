import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { defer, from, lastValueFrom, Observable } from 'rxjs';
import { traceBackground } from '../observability/background-trace';

/**
 * Socket events whose trace rate is capped, because a connected client sends
 * them all the time. Everything else (sending a message, joining a room,
 * Instant Match actions) is traced at the environment's rate, like a request.
 *
 * 0 means not traced at all: `ping` does no I/O, so there is nothing to see.
 */
export const SOCKET_TRACE_RATES: Readonly<Record<string, number>> = {
  ping: 0,
  // One every 25 s from every connected client.
  'presence:heartbeat': 0.01,
  // Several per second while someone types.
  'typing:start': 0.01,
  'typing:stop': 0.01,
  // One per message per recipient, and per conversation opened.
  'message:received': 0.05,
  'message:delivered': 0.05,
  'messages:seen': 0.05,
  'conversation:mark_seen': 0.05,
};

/**
 * Runs each socket event handler as one traced unit named `ws <event>`, so the
 * queries it makes are children of the event instead of each starting a trace
 * of its own (observability/trace-sampler.ts no longer lets them).
 *
 * The handler's result passes through unchanged: handlers here return an ack
 * value or nothing, never a stream, and a thrown error still reaches the
 * gateway's exception handling as before.
 */
@Injectable()
export class SocketTraceInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'ws') return next.handle();
    const event = context.switchToWs().getPattern();
    const traceRate = SOCKET_TRACE_RATES[event];
    if (traceRate === 0) return next.handle();
    return defer(() =>
      from(
        traceBackground(
          { name: `ws ${event}`, op: 'websocket.server', traceRate },
          () => lastValueFrom(next.handle(), { defaultValue: undefined }),
        ),
      ),
    );
  }
}
