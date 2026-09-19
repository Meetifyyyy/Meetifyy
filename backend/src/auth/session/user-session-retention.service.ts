import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { UserSessionService } from './user-session.service';

/**
 * Deletes session rows that can no longer authorize anything.
 *
 * `UserSessionService.purgeExpired` has existed, and been tested, since
 * sessions were introduced — with no caller. Nothing ever ran it, so the table
 * only ever grew: every sign-in adds a row, every rotation adds another, and
 * the ones that age out or get revoked stay forever. Development alone had
 * accumulated rows for sessions belonging to browsers that no longer exist.
 *
 * Deleting them is not only housekeeping. A revoked or expired row is a record
 * of a device someone used, with its IP and user agent, kept indefinitely for
 * no purpose the product has — and it is read on the hot path by the guard's
 * session lookup.
 *
 * Deliberately conservative about WHAT it removes: only rows past `expiresAt`.
 * A revoked-but-unexpired row must stay, because it is what makes a replayed
 * refresh token detectable as a replay rather than merely unknown — deleting
 * those early would turn a detected theft into a silent one.
 *
 * Same shape as the other sweeps here: run once at boot, then on an interval,
 * never throw, and never hold the process open.
 */
@Injectable()
export class UserSessionRetentionService
  implements OnModuleInit, OnModuleDestroy
{
  private static readonly SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

  private readonly logger = new Logger(UserSessionRetentionService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly sessions: UserSessionService) {}

  async onModuleInit(): Promise<void> {
    await this.sweep();
    this.timer = setInterval(
      () => void this.sweep(),
      UserSessionRetentionService.SWEEP_INTERVAL_MS,
    );
    // Never a reason to keep the process alive for this.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass. Never throws — it runs from a timer and at boot. */
  async sweep(): Promise<number> {
    try {
      const removed = await this.sessions.purgeExpired();
      if (removed > 0) {
        this.logger.log(`session.purge_expired ${JSON.stringify({ removed })}`);
      }
      return removed;
    } catch (e) {
      // A failed sweep is a table that stays large for another six hours. It
      // must never be a failed boot.
      this.logger.warn(`session purge failed: ${(e as Error).message}`);
      return 0;
    }
  }
}
