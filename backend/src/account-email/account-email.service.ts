import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  EmailChangeAction,
  EmailChannel,
  Prisma,
  ReauthPurpose,
  UserOtpPurpose,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { UserOtpService } from '../otp/user-otp.service';
import { ADDRESS_MAILER, type AddressMailer } from '../otp/address-mailer';
import { AuthService, clearAuthSyncCache } from '../auth/auth.service';
import type { AuthenticatedUser } from '../common/types/authenticated-request';
import {
  checkEmailFormat,
  normalizeEmail,
} from '../common/validation/email-format.util';
import { maskEmail } from '../common/campus/campus-affiliation.util';
import { errorMessage } from '../common/utils/error.util';
import {
  ReauthService,
  reauthRequired,
} from '../account-security/reauth.service';
import {
  EmailChangePolicyService,
  allChecks,
} from '../account-security/email-change-policy.service';
import { AUTH_EMAIL_INTENT_TTL_MS } from '../account-security/account-security.constants';
import { RateLimitService } from '../common/rate-limit/rate-limit.service';
import { rateLimitException } from '../common/rate-limit/rate-limit.response';

type Db = PrismaService | Prisma.TransactionClient;

/** How the caller re-proved it is the owner. Exactly one is required to verify. */
export interface EmailChangeProof {
  ip?: string | null;
  sessionId?: string | null;
  /** A grant from `/api/account/reauth` for `personal_email_change`. */
  reauthToken?: string;
  /** Legacy (installed apps before reauth grants): re-checked at verify. */
  currentPassword?: string;
}

/** Placeholder domains the platform itself writes. Never a real inbox. */
const RESERVED_DOMAINS = ['meetifyy.user', 'deleted.meetifyy'];

const isPlaceholder = (email: string) =>
  RESERVED_DOMAINS.includes(email.split('@')[1]?.toLowerCase() ?? '');

const emailTaken = () =>
  new ConflictException({
    code: 'email_taken',
    message: 'That email is already used by another account.',
  });

/**
 * Changing the sign-in (personal) email.
 *
 * The ONLY path that changes `User.email` or the Supabase auth email of an
 * existing account. Supabase Auth's own self-service change is refused by the
 * `auth.users` trigger (migration 00000000000029), so this cannot be routed
 * around with a direct `PUT /auth/v1/user`. In order:
 *   1. the caller reauthenticates (`/api/account/reauth`, a single-use grant
 *      bound to this session) — or, for installed apps that predate grants,
 *      sends the current password with the code, re-checked at verify;
 *   2. the 30-day cooldown is checked, then a code is sent ONLY to the new
 *      address, stored HMAC'd in `UserOtp` with `target` = that address;
 *   3. verify consumes the code atomically (single use); the address applied
 *      is the code's bound `target`, never a value from the request;
 *   4. under a lock on the user row the cooldown, uniqueness and in-flight
 *      checks run again, the grant is spent, and an AuthEmailChangeIntent
 *      authorises exactly this address for one minute;
 *   5. the auth email is set through the admin API (`email_confirm: true` —
 *      the code just proved control of it), then, under the lock again,
 *      `User.email` is written with the EmailChangeEvent that starts the
 *      cooldown, and the intent is cleared. If that write fails the auth email
 *      is put back, so the two never disagree and no cooldown starts;
 *   6. the previous address is told, idempotently, keyed by the event.
 * A crash between 5's two halves leaves an expired intent, which the next
 * request reconciles (`reconcile`).
 */
@Injectable()
export class AccountEmailService {
  private readonly logger = new Logger(AccountEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
    private readonly otp: UserOtpService,
    private readonly auth: AuthService,
    private readonly reauth: ReauthService,
    private readonly policy: EmailChangePolicyService,
    private readonly rateLimit: RateLimitService,
    @Inject(ADDRESS_MAILER) private readonly mailer: AddressMailer,
  ) {}

  async getStatus(
    userId: string,
    reconciled = false,
  ): Promise<{
    email: string | null;
    collegeEmail: string | null;
    needsPersonalEmail: boolean;
    /** When each address may next change (ISO), or null for now. */
    cooldowns: { personal: string | null; college: string | null };
  }> {
    // Usually one round trip: the intent lookup runs alongside the reads, and
    // only a stale one (a crashed change) costs a reconcile and a re-read.
    const [intent, user, cooldowns] = await Promise.all([
      this.prisma.authEmailChangeIntent.findUnique({
        where: { userId },
        select: { expiresAt: true },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          collegeAffiliation: {
            select: { email: true, emailNormalized: true },
          },
        },
      }),
      this.policy.getCooldowns(userId),
    ]);
    // Once at most: a reconcile that cannot reach Supabase leaves the intent.
    if (!reconciled && intent && intent.expiresAt <= new Date()) {
      await this.reconcile(userId);
      return this.getStatus(userId, true);
    }
    const affiliation = user?.collegeAffiliation ?? null;
    return {
      email: user?.email ?? null,
      collegeEmail: affiliation?.email ?? null,
      needsPersonalEmail: Boolean(
        affiliation &&
        user?.email &&
        normalizeEmail(user.email) === affiliation.emailNormalized,
      ),
      cooldowns: {
        personal: cooldowns.personal?.toISOString() ?? null,
        college: cooldowns.college?.toISOString() ?? null,
      },
    };
  }

  async requestOtp(
    userId: string,
    rawEmail: string,
    context: Omit<EmailChangeProof, 'currentPassword'> = {},
  ): Promise<{
    sent: true;
    emailMasked: string;
    expiresAt: string;
    resendAvailableAt: string;
  }> {
    const format = checkEmailFormat(rawEmail);
    const target = normalizeEmail(rawEmail);
    if (!format.valid || RESERVED_DOMAINS.includes(format.domain ?? '')) {
      throw new BadRequestException({
        code: 'invalid_email',
        message: 'Please enter a valid email address.',
      });
    }

    // Before anything is sent, in parallel: a code that could never be
    // redeemed is noise. A grant, when sent, must be live; without one (an
    // older app) the password is required at verify.
    const sessionId = context.sessionId ?? null;
    const [, user, held] = await allChecks([
      this.policy.assertEligible(userId, EmailChannel.PERSONAL),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, displayName: true },
      }),
      this.isEmailHeldByAnother(target, userId),
      context.reauthToken !== undefined
        ? this.reauth.assertGrant(
            userId,
            ReauthPurpose.PERSONAL_EMAIL_CHANGE,
            context.reauthToken,
            sessionId,
          )
        : Promise.resolve(),
    ]);
    if (user && normalizeEmail(user.email) === target) {
      throw new BadRequestException({
        code: 'same_email',
        message: 'That is already the email you sign in with.',
      });
    }
    if (held) throw emailTaken();

    const issued = await this.otp.issue(userId, UserOtpPurpose.PERSONAL_EMAIL, {
      ip: context.ip,
      target,
    });
    // From here the grant can be spent only on the address this live code
    // went to (bound after the issue, so a refused resend cannot move it).
    if (context.reauthToken !== undefined) {
      await this.reauth.assertGrant(
        userId,
        ReauthPurpose.PERSONAL_EMAIL_CHANGE,
        context.reauthToken,
        sessionId,
        target,
      );
    }
    // To the new address only: receiving it is the proof.
    await this.mailer.sendPersonalEmailOtp(
      target,
      user?.displayName ?? '',
      issued.code,
    );

    const challenge = await this.otp.getBoundChallenge(
      userId,
      UserOtpPurpose.PERSONAL_EMAIL,
    );
    return {
      sent: true,
      emailMasked: maskEmail(target),
      expiresAt: issued.expiresAt.toISOString(),
      resendAvailableAt: (
        challenge?.resendAvailableAt ?? issued.expiresAt
      ).toISOString(),
    };
  }

  /**
   * Whether another account already signs in with this address.
   *
   * Case-insensitive on purpose: `target` is normalized (lowercase), but
   * `User.email` is unique only as stored, and legacy rows may hold mixed
   * case. An exact match would miss `Jane@Gmail.com` and let a second account
   * take the same mailbox (the unique index would not catch it either).
   */
  private async isEmailHeldByAnother(
    target: string,
    userId: string,
    db: Db = this.prisma,
  ): Promise<boolean> {
    const holder = await db.user.findFirst({
      where: {
        email: { equals: target, mode: 'insensitive' },
        id: { not: userId },
      },
      select: { id: true },
    });
    return holder !== null;
  }

  async verify(
    user: AuthenticatedUser,
    code: string,
    proof: EmailChangeProof = {},
  ): Promise<{ email: string }> {
    if (!this.supabase.isConfigured) {
      throw new UnauthorizedException('Authentication is not configured.');
    }
    const sessionId = proof.sessionId ?? null;
    if (!proof.reauthToken && !proof.currentPassword) throw reauthRequired();

    await this.reconcile(user.id);
    const current = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true, displayName: true },
    });
    if (!current) throw new UnauthorizedException('Account not found.');

    // (1) Proof first, and the cooldown, in parallel: neither failure may
    // burn the code. The proof's refusal wins when both fail.
    await allChecks([
      proof.reauthToken
        ? this.reauth.assertGrant(
            user.id,
            ReauthPurpose.PERSONAL_EMAIL_CHANGE,
            proof.reauthToken,
            sessionId,
          )
        : this.checkLegacyPassword(user, current.email, proof.currentPassword),
      this.policy.assertEligible(user.id, EmailChannel.PERSONAL),
    ]);

    // (3) Consumed before anything is applied; the bound target is the ONLY
    // address that can be applied.
    const { target } = await this.otp.verifyBound(
      user.id,
      UserOtpPurpose.PERSONAL_EMAIL,
      code,
      { ip: proof.ip },
    );
    if (!target) {
      throw new BadRequestException({
        code: 'invalid_code',
        message: 'That code is not valid. Request a new one to continue.',
      });
    }
    if (normalizeEmail(current.email) === target) return { email: target };

    // Captured before any write, for the rollback and the notice.
    const previousEmail = current.email;
    const name = current.displayName ?? '';

    // (4) Authorise, under the lock.
    await this.prisma.$transaction(async (tx) => {
      const now = await this.policy.lockUser(tx, user.id);
      // Re-checked here, not trusted from above: another device may have
      // completed a change since.
      await this.policy.assertEligible(user.id, EmailChannel.PERSONAL, tx);
      if (await this.isEmailHeldByAnother(target, user.id, tx)) {
        throw emailTaken();
      }
      const inFlight = await tx.authEmailChangeIntent.findUnique({
        where: { userId: user.id },
        select: { userId: true },
      });
      if (inFlight) {
        throw new ConflictException({
          code: 'email_change_in_progress',
          message:
            'An email change is already in progress. Try again in a minute.',
        });
      }
      if (proof.reauthToken) {
        await this.reauth.consumeGrant(
          tx,
          user.id,
          ReauthPurpose.PERSONAL_EMAIL_CHANGE,
          proof.reauthToken,
          sessionId,
          target,
        );
      }
      await tx.authEmailChangeIntent.create({
        data: {
          userId: user.id,
          previousEmail,
          newEmail: target,
          expiresAt: new Date(now.getTime() + AUTH_EMAIL_INTENT_TTL_MS),
        },
      });
    });

    // (5) Auth email first, then the row; undo the first if the second fails.
    const { error } = await this.supabase.client.auth.admin.updateUserById(
      user.id,
      { email: target, email_confirm: true },
    );
    if (error) {
      if (/already|registered|exists/i.test(error.message ?? '')) {
        await this.clearIntent(user.id);
        throw emailTaken();
      }
      // Anything else (a timeout above all) may still have been applied.
      // The intent stays: once it expires, `reconcile` reads the auth email
      // and either finishes the change or clears it — the only side that
      // knows what happened is Supabase.
      this.logger.warn(
        `auth email update failed for ${user.id}: ${error.message}`,
      );
      throw new BadGatewayException(
        "Couldn't update your email right now. Please try again.",
      );
    }

    let eventId: string;
    try {
      eventId = await this.complete(user.id, previousEmail, target);
    } catch (err) {
      // The reconciler finished this same change first (a slow admin call
      // let the intent expire). It is complete and notified: never undo it.
      if (err instanceof ConflictException) {
        clearAuthSyncCache(user.id);
        return { email: target };
      }
      await this.restoreAuthEmail(user.id, previousEmail);
      await this.clearIntent(user.id);
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw emailTaken();
      }
      throw err;
    }

    clearAuthSyncCache(user.id);
    this.logger.log(`Sign-in email changed for user ${user.id}`);
    this.notifyPrevious(user.id, previousEmail, name, target, eventId);
    return { email: target };
  }

  /**
   * The password check for installed apps that predate grants. It is a
   * password oracle, so it spends the same per-user budget as every other
   * one; a grant-carrying verify spends none (it guesses nothing).
   */
  private async checkLegacyPassword(
    user: AuthenticatedUser,
    currentEmail: string,
    password: string | undefined,
  ): Promise<void> {
    const decision = await this.rateLimit.consume(
      'auth.verifypassword.user',
      user.id,
    );
    if (!decision.allowed) throw rateLimitException(decision);
    const { valid } = await this.auth.verifyPassword(
      { ...user, email: currentEmail },
      password ?? '',
    );
    if (!valid) {
      throw new ForbiddenException({
        code: 'invalid_password',
        message: 'Your current password is incorrect.',
      });
    }
  }

  /**
   * The second half of a change: `User.email`, the event that starts the
   * cooldown, and the intent's removal, in one transaction under the lock.
   * Refuses if the intent is gone, which is what makes a duplicate completion
   * (a retry racing the reconciler) a no-op rather than a second event.
   */
  private async complete(
    userId: string,
    previousEmail: string,
    target: string,
  ): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const now = await this.policy.lockUser(tx, userId);
      const intent = await tx.authEmailChangeIntent.findUnique({
        where: { userId },
        select: { newEmail: true },
      });
      if (!intent || intent.newEmail !== target) {
        throw new ConflictException({
          code: 'email_change_in_progress',
          message: 'This email change was already completed or replaced.',
        });
      }
      await tx.user.update({ where: { id: userId }, data: { email: target } });
      const event = await this.policy.record(tx, {
        userId,
        channel: EmailChannel.PERSONAL,
        action: EmailChangeAction.CHANGE,
        previousEmail,
        newEmail: target,
        at: now,
      });
      await tx.authEmailChangeIntent.delete({ where: { userId } });
      return event.id;
    });
  }

  /**
   * Settles an intent a crashed or timed-out request left behind. A live one
   * (still inside its window) belongs to a request in progress and is left
   * alone. Cheap when there is nothing to do: one primary-key lookup.
   */
  async reconcile(userId: string): Promise<void> {
    const intent = await this.prisma.authEmailChangeIntent.findUnique({
      where: { userId },
    });
    if (!intent || intent.expiresAt > new Date()) return;

    let authEmail: string | null = null;
    try {
      const { data } =
        await this.supabase.client.auth.admin.getUserById(userId);
      authEmail = data?.user?.email ? normalizeEmail(data.user.email) : null;
    } catch (err) {
      this.logger.warn(
        `reconcile read failed for ${userId}: ${errorMessage(err)}`,
      );
      return;
    }

    if (authEmail === intent.newEmail) {
      // The auth write landed and the row write did not: finish it.
      try {
        const eventId = await this.complete(
          userId,
          intent.previousEmail,
          intent.newEmail,
        );
        clearAuthSyncCache(userId);
        this.logger.warn(
          `Reconciled an interrupted email change for ${userId}`,
        );
        const row = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { displayName: true },
        });
        this.notifyPrevious(
          userId,
          intent.previousEmail,
          row?.displayName ?? '',
          intent.newEmail,
          eventId,
        );
      } catch (err) {
        // Another request finished it first: nothing left to do.
        if (err instanceof ConflictException) return;
        this.logger.error(
          `Could not reconcile email change for ${userId}: ${errorMessage(err)}`,
        );
      }
      return;
    }
    if (authEmail !== normalizeEmail(intent.previousEmail)) {
      // Neither address: something outside this flow. Needs a human.
      this.logger.error(
        `Auth email for ${userId} matches neither side of its email-change intent`,
      );
    }
    await this.clearIntent(userId);
  }

  private async clearIntent(userId: string): Promise<void> {
    await this.prisma.authEmailChangeIntent
      .deleteMany({ where: { userId } })
      .catch((err: unknown) =>
        this.logger.warn(
          `intent cleanup failed for ${userId}: ${errorMessage(err)}`,
        ),
      );
  }

  /**
   * Fire-and-forget on purpose: the change is committed on both sides, and a
   * mail-queue hiccup must not turn a completed change into an error the
   * client would retry. The notice goes to the OLD address — the one inbox an
   * owner who did not make this change still controls — and shows the new
   * address only masked. The event id is the job id, so a second enqueue for
   * the same change queues nothing; the queue retries delivery.
   */
  private notifyPrevious(
    userId: string,
    previousEmail: string,
    name: string,
    target: string,
    eventId: string,
  ): void {
    if (isPlaceholder(previousEmail)) return;
    void this.mailer
      .sendSignInEmailChangedNotice(
        previousEmail,
        name,
        maskEmail(target),
        eventId,
      )
      .catch((err: unknown) =>
        this.logger.warn(
          `email-changed notice failed for ${userId}: ${errorMessage(err)}`,
        ),
      );
  }

  /** Puts the auth email back; the trigger needs an intent naming it. */
  private async restoreAuthEmail(userId: string, previous: string) {
    try {
      await this.prisma.authEmailChangeIntent.upsert({
        where: { userId },
        create: {
          userId,
          previousEmail: previous,
          newEmail: previous,
          expiresAt: new Date(Date.now() + AUTH_EMAIL_INTENT_TTL_MS),
        },
        update: {
          newEmail: previous,
          expiresAt: new Date(Date.now() + AUTH_EMAIL_INTENT_TTL_MS),
        },
      });
      const { error } = await this.supabase.client.auth.admin.updateUserById(
        userId,
        { email: previous, email_confirm: true },
      );
      if (error) throw new Error(error.message);
    } catch (err) {
      // Loud: the auth email and User.email now disagree and need a human.
      this.logger.error(
        `Could not restore auth email for ${userId} after a failed update: ${errorMessage(err)}`,
      );
    }
  }
}
