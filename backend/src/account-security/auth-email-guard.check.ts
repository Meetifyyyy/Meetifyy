import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { errorMessage } from '../common/utils/error.util';

/**
 * Says loudly at boot when the auth.users email guard is missing.
 *
 * Migration 00000000000029 installs it, but finishes without it rather than
 * failing when the migrating role may not create triggers on `auth.users` (a
 * failed migration blocks every later one). Without the trigger a client can
 * change its sign-in email through Supabase Auth directly, around the
 * reauthentication and cooldown, so that state must not pass unnoticed.
 * Silent on a database with no `auth` schema (tests, plain Postgres).
 */
@Injectable()
export class AuthEmailGuardCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthEmailGuardCheck.name);

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    // Deliberately not awaited: a diagnostic must not delay or fail boot.
    void this.check();
  }

  async check(): Promise<boolean | null> {
    try {
      const rows = await this.prisma.$queryRaw<
        { hasAuth: boolean; hasTrigger: boolean }[]
      >`
        SELECT to_regclass('auth.users') IS NOT NULL AS "hasAuth",
               EXISTS (
                 SELECT 1 FROM pg_trigger
                 WHERE tgname = 'meetifyy_guard_auth_email_change'
                   AND tgrelid = to_regclass('auth.users')
               ) AS "hasTrigger"`;
      const row = rows[0];
      if (!row?.hasAuth) return null;
      if (!row.hasTrigger) {
        this.logger.error(
          'auth.users email guard trigger is MISSING: sign-in emails can be changed through Supabase Auth directly, bypassing reauthentication and the 30-day cooldown. See docs/email-change-security.md.',
        );
      }
      return row.hasTrigger;
    } catch (err) {
      this.logger.warn(`auth email guard check failed: ${errorMessage(err)}`);
      return null;
    }
  }
}
