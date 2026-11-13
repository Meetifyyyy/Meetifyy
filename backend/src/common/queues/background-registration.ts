import type { Logger } from '@nestjs/common';
import { redisReconnectDelay } from '../../redis/redis.service';
import { errorMessage } from '../utils/error.util';

/** After the first failure, further ones are logged at most this often. */
export const REGISTRATION_LOG_INTERVAL_MS = 60_000;

export interface BackgroundRegistration {
  /** Stops retrying. An attempt already in flight is left to finish. */
  stop(): void;
}

export interface BackgroundRegistrationOptions {
  /** What is being registered, for the log lines. */
  description: string;
  logger: Pick<Logger, 'error' | 'warn'>;
  /** One try. Rejects if the registration could not be made. */
  attempt: () => Promise<unknown>;
  /** Appended to the first failure's log line (what happens meanwhile). */
  firstFailureNote?: string;
  /** Runs once, on the first failure only. */
  onFirstFailure?: () => void;
}

/**
 * Makes a boot-time registration (a repeatable job) without holding boot, and
 * keeps trying until it succeeds.
 *
 * Producers now fail fast while Redis is down, so a registration awaited in
 * `onModuleInit` would either give up for the life of the process or, if its
 * error were swallowed, leave a schedule that is never created. A registration
 * is not a request: nobody is waiting on it, so it retries with the same
 * capped, jittered backoff as the Redis connection itself and never gives up.
 * The caller is not awaited, and the failure is logged once and then at most
 * once a minute so a long outage does not flood the log.
 */
export function registerInBackground(
  options: BackgroundRegistrationOptions,
): BackgroundRegistration {
  const { description, logger, attempt, firstFailureNote, onFirstFailure } =
    options;
  let stopped = false;
  let failures = 0;
  let lastLoggedAt = 0;
  let timer: NodeJS.Timeout | null = null;

  const run = async (): Promise<void> => {
    try {
      await attempt();
    } catch (err) {
      failures += 1;
      const now = Date.now();
      if (failures === 1) {
        lastLoggedAt = now;
        logger.error(
          `Could not register ${description}: ${errorMessage(err)}.` +
            ` Retrying until it succeeds${firstFailureNote ? `; ${firstFailureNote}` : ''}`,
        );
        onFirstFailure?.();
      } else if (now - lastLoggedAt >= REGISTRATION_LOG_INTERVAL_MS) {
        lastLoggedAt = now;
        logger.warn(
          `${description} is still not registered after ${failures} attempts: ${errorMessage(err)}`,
        );
      }
      if (stopped) return;
      timer = setTimeout(() => void run(), redisReconnectDelay(failures));
      // A pending retry must not keep the process alive on its own.
      timer.unref?.();
    }
  };

  // Not awaited: the registration runs behind boot. `run` never rejects.
  void run();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
