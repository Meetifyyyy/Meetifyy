import { Logger } from '@nestjs/common';

const logger = new Logger('Detached');

/**
 * Runs background work nobody is waiting on, and keeps its failures contained.
 *
 * The pattern this replaces is an async callback handed to `setImmediate`,
 * `setInterval` or an event registration. Those signatures expect no return
 * value, so the promise the callback produces is dropped on the floor: nothing
 * observes it, and a rejection becomes an unhandled rejection, which under
 * Node's default terminates the process. Work deliberately pushed off the
 * request path — a system message, a fan-out, a cache sweep — should be able to
 * fail without taking the server with it.
 *
 * The synchronous `try` matters too. An `async` function only converts a throw
 * into a rejection once it starts executing; a throw while evaluating the
 * argument list happens before that and would propagate into the timer.
 */
export function detach(label: string, work: () => Promise<unknown>): void {
  try {
    void work().catch((err) => {
      logger.error(`Detached task "${label}" failed`, err);
    });
  } catch (err) {
    logger.error(`Detached task "${label}" threw synchronously`, err);
  }
}
