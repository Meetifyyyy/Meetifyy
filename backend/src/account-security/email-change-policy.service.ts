import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { EmailChangeAction, EmailChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  EMAIL_CHANGE_COOLDOWN_CODE,
  EMAIL_CHANGE_COOLDOWN_HOURS,
} from './account-security.constants';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Runs independent checks in parallel but reports the failure of the FIRST
 * listed one, so a request refused for two reasons always gets the same
 * answer (e.g. a replayed grant is `reauth_required`, not sometimes the
 * cooldown). Resolves with every result when all pass.
 */
export async function allChecks<T extends readonly unknown[]>(checks: {
  [K in keyof T]: Promise<T[K]>;
}): Promise<T> {
  const settled = await Promise.allSettled(checks);
  for (const result of settled) {
    if (result.status === 'rejected') throw result.reason;
  }
  return settled.map(
    (r) => (r as PromiseFulfilledResult<unknown>).value,
  ) as unknown as T;
}

/** When each channel may change again; null means now. */
export interface EmailCooldowns {
  personal: Date | null;
  college: Date | null;
}

/** User changes start a cooldown; Super Admin recovery does not. */
const COUNTS_TOWARD_COOLDOWN: ReadonlySet<EmailChangeAction> = new Set([
  EmailChangeAction.CHANGE,
  EmailChangeAction.ADD,
  EmailChangeAction.REMOVE,
]);

const COOLDOWN_DATE = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

export function cooldownError(
  channel: EmailChannel,
  availableAt: Date,
): ForbiddenException {
  return new ForbiddenException({
    code: EMAIL_CHANGE_COOLDOWN_CODE,
    channel: channel.toLowerCase(),
    // ISO so the client can show it in the viewer's own time zone.
    availableAt: availableAt.toISOString(),
    message: `For account security, you can change this email again on ${COOLDOWN_DATE.format(availableAt)} UTC.`,
  });
}

/**
 * The 30-day email-change cooldowns.
 *
 * Computed from `EmailChangeEvent`, which only the backend writes, and always
 * against the database clock: the device's time and time zone play no part.
 * The personal and college channels are independent rows, so neither can
 * reset or extend the other.
 *
 * Enforcement is check-then-record inside ONE transaction that first locks the
 * user row (`lockUser`), so two requests for the same account serialise: the
 * second sees the first one's event and is refused. Every completing write
 * (`record`) is made in that same transaction, so a change that fails or rolls
 * back leaves no event and starts no cooldown.
 */
@Injectable()
export class EmailChangePolicyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Locks the user row for the rest of the transaction and returns the
   * database's current UTC time, which the caller stamps the event with.
   */
  async lockUser(tx: Prisma.TransactionClient, userId: string): Promise<Date> {
    const rows = await tx.$queryRaw<{ now: Date }[]>`
      SELECT timezone('utc', now()) AS "now"
      FROM "User" WHERE "id" = ${userId}
      FOR UPDATE`;
    if (!rows[0]) throw new UnauthorizedException('Account not found.');
    return rows[0].now;
  }

  /** Both channels' next-eligible times, in one query. */
  async getCooldowns(
    userId: string,
    db: Db = this.prisma,
  ): Promise<EmailCooldowns> {
    const rows = await db.$queryRaw<{ channel: string; availableAt: Date }[]>`
      SELECT "channel"::text AS "channel",
             max("createdAt") + (${EMAIL_CHANGE_COOLDOWN_HOURS}::int * interval '1 hour') AS "availableAt"
      FROM "EmailChangeEvent"
      WHERE "userId" = ${userId} AND "countsTowardCooldown"
      GROUP BY "channel"
      HAVING max("createdAt") + (${EMAIL_CHANGE_COOLDOWN_HOURS}::int * interval '1 hour') > timezone('utc', now())`;
    const at = (channel: EmailChannel) =>
      rows.find((r) => r.channel === channel)?.availableAt ?? null;
    return {
      personal: at(EmailChannel.PERSONAL),
      college: at(EmailChannel.COLLEGE),
    };
  }

  /** Refuses with `email_change_cooldown` while the channel is cooling down. */
  async assertEligible(
    userId: string,
    channel: EmailChannel,
    db: Db = this.prisma,
  ): Promise<void> {
    const cooldowns = await this.getCooldowns(userId, db);
    const availableAt =
      channel === EmailChannel.PERSONAL
        ? cooldowns.personal
        : cooldowns.college;
    if (availableAt) throw cooldownError(channel, availableAt);
  }

  /** Whether the account has ever had a college email transition recorded. */
  async hasCollegeHistory(
    userId: string,
    db: Db = this.prisma,
  ): Promise<boolean> {
    const row = await db.emailChangeEvent.findFirst({
      where: { userId, channel: EmailChannel.COLLEGE },
      select: { id: true },
    });
    return row !== null;
  }

  /** Appends a completed transition. Call inside the transaction that made it. */
  async record(
    tx: Prisma.TransactionClient,
    event: {
      userId: string;
      channel: EmailChannel;
      action: EmailChangeAction;
      previousEmail?: string | null;
      newEmail?: string | null;
      at: Date;
    },
  ): Promise<{ id: string }> {
    return tx.emailChangeEvent.create({
      data: {
        userId: event.userId,
        channel: event.channel,
        action: event.action,
        countsTowardCooldown: COUNTS_TOWARD_COOLDOWN.has(event.action),
        previousEmail: event.previousEmail ?? null,
        newEmail: event.newEmail ?? null,
        createdAt: event.at,
      },
      select: { id: true },
    });
  }
}
