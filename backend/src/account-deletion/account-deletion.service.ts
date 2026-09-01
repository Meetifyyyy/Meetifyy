import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UserOtpPurpose } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  UserOtpService,
  type OtpChallengeState,
} from '../otp/user-otp.service';
import { ACCOUNT_MAILER, type AccountMailer } from '../otp/account-mailer';
import { RedisService } from '../redis/redis.service';
import { PresenceService } from '../presence/presence.service';
import { DomainEventService } from '../events/domain-event.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { clearAuthSyncCache } from '../auth/auth.service';
import {
  RECOVERY_WINDOW_DAYS,
  RECOVERY_WINDOW_MS,
} from './account-deletion.constants';
import { OTP_RESEND_COOLDOWN_MS } from '../otp/user-otp.constants';

export interface OtpChallengeResponse {
  otpRequired: true;
  /** e.g. "s••@university.edu" — enough to recognise, not enough to read out. */
  maskedEmail: string;
  expiresAt: string;
  resendAvailableAt: string;
}

/**
 * Masks a mailbox for display.
 *
 * Keeps the first character and the domain, which is what makes an address
 * recognisable to its owner, and hides the rest — the screen may be visible to
 * whoever is standing behind the user, and they are usually the reason the OTP
 * step exists.
 */
function maskEmail(email: string): string {
  const [local, domain] = String(email ?? '').split('@');
  if (!domain) return '••••';
  // A FIXED number of dots, not one per hidden character: padding to the real
  // length would quietly publish how long the local part is, which is a small
  // but free gift to anyone guessing at the address.
  const head = local.slice(0, 1);
  return `${head}••••@${domain}`;
}

export interface DeletionStatus {
  pendingDeletion: boolean;
  /** ISO instant the request was made. Server clock, always. */
  deletionRequestedAt: string | null;
  /** ISO instant after which the account becomes eligible for purge. */
  scheduledPurgeAt: string | null;
  /** Whole days left, floored, computed server-side. UI convenience only. */
  daysRemaining: number | null;
  recoverable: boolean;
  recoveryWindowDays: number;
  email: string | null;
}

/**
 * Owns the reversible half of the account lifecycle: requesting deletion,
 * recovering, and reporting status. The irreversible half lives in
 * `AccountDeletionPurgeService`.
 *
 * ── Why requesting deletion sets `deletedAt` ──────────────────────────────
 * The codebase already filters `deletedAt: null` in ~137 user-facing queries —
 * search, profiles, suggestions, followers, mentions, community rosters. Reusing
 * that column is what makes a pending-deletion account disappear everywhere at
 * once instead of requiring each of those call sites to learn a new state and
 * one of them to be forgotten. Nothing is anonymized at this point, so the row
 * still carries every original value and recovery is a pure state transition.
 *
 * ── Why recovery is safe against the worker ───────────────────────────────
 * Both recovery and the worker's claim are single conditional `updateMany`
 * statements whose WHERE clause includes the state they expect to find. Postgres
 * serializes the two row locks, so exactly one of them matches and the other
 * sees `count === 0` and reports the loss honestly. There is no read-then-write
 * gap for the two to interleave in.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly presenceService: PresenceService,
    private readonly domainEventService: DomainEventService,
    private readonly otpService: UserOtpService,
    @Inject(ACCOUNT_MAILER) private readonly emailService: AccountMailer,
  ) {}

  // ── Step 1: prove the person asking is the account owner ─────────────────

  /**
   * Emails a one-time code that must be entered before deletion is scheduled.
   *
   * Pressing "Delete account" no longer schedules anything. A session can be
   * left open on a shared machine, and account destruction is the single most
   * damaging thing a passer-by could do with one — so the mailbox is made to
   * confirm it, which is the one factor a borrowed session does not carry.
   *
   * Returns only the challenge's timing. Never the code, and never anything
   * that would tell a caller whether a code already existed.
   */
  async requestDeletionOtp(
    userId: string,
    context: { ip?: string | null } = {},
  ): Promise<OtpChallengeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        accountStatus: true,
        deletedAt: true,
      },
    });

    if (!user) throw new NotFoundException("This profile isn't available.");

    // Already scheduled — say so plainly rather than sending a pointless code.
    // Safe to disclose: this is the caller's own account.
    if (user.accountStatus === 'PENDING_DELETION') {
      throw new ConflictException({
        code: 'ALREADY_PENDING_DELETION',
        message: 'This account is already scheduled for deletion.',
      });
    }

    if (user.accountStatus === 'DELETED' || user.deletedAt) {
      throw new NotFoundException("This profile isn't available.");
    }

    if (user.accountStatus === 'BANNED') {
      throw new BadRequestException(
        'This account cannot be deleted from here. Contact support.',
      );
    }

    // A live code already in flight is RESUMED rather than re-sent.
    //
    // Without this, refreshing the page during the code step — or opening a
    // second tab, or double-clicking Delete — hits the resend cooldown and
    // strands the user on an error for a minute, holding a perfectly good code
    // in their inbox that the UI has forgotten about. Returning the existing
    // challenge sends no new mail and reveals nothing: it is the caller's own
    // account, and the code itself never leaves the mail.
    const live = await this.otpService.getChallengeState(
      userId,
      UserOtpPurpose.ACCOUNT_DELETION,
    );
    if (live) return this.resumeChallenge(user.email, live);

    const { code, expiresAt } = await this.otpService.issue(
      userId,
      UserOtpPurpose.ACCOUNT_DELETION,
      context,
    );

    // Awaited: if the mail cannot even be queued, the client must be told now
    // rather than being sent to an OTP screen for a code that will never come.
    await this.emailService.sendAccountDeletionOtpEmail(
      user.email,
      user.displayName,
      code,
    );

    return this.challengeResponse(user.email, expiresAt);
  }

  /**
   * Emails a one-time code that must be entered before a deletion is cancelled.
   *
   * Symmetrical to the deletion code and for the same reason: an unattended
   * session must not be able to quietly reverse a deletion its owner chose.
   */
  async requestRecoveryOtp(
    userId: string,
    context: { ip?: string | null } = {},
  ): Promise<OtpChallengeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        accountStatus: true,
        scheduledPurgeAt: true,
        purgeStartedAt: true,
      },
    });

    if (!user) throw new NotFoundException("This profile isn't available.");

    if (user.accountStatus === 'ACTIVE') {
      // Nothing to recover. Idempotent rather than an error: a second tab, or a
      // retried request after a recovery that already succeeded.
      throw new ConflictException({
        code: 'NOT_PENDING_DELETION',
        message: 'This account is already active.',
      });
    }

    if (
      user.accountStatus !== 'PENDING_DELETION' ||
      !user.scheduledPurgeAt ||
      user.scheduledPurgeAt <= new Date() ||
      user.purgeStartedAt !== null
    ) {
      // Checked before a code is sent so the user is not walked through an OTP
      // screen for a recovery that cannot succeed at the end of it.
      throw new ConflictException({
        code: 'RECOVERY_WINDOW_CLOSED',
        message:
          'The recovery window for this account has closed and permanent deletion is already under way.',
      });
    }

    // Same resume behaviour as deletion: a refresh of the recovery screen must
    // not cost the user a minute of cooldown for a code they already have.
    const live = await this.otpService.getChallengeState(
      userId,
      UserOtpPurpose.ACCOUNT_RECOVERY,
    );
    if (live) return this.resumeChallenge(user.email, live);

    const { code, expiresAt } = await this.otpService.issue(
      userId,
      UserOtpPurpose.ACCOUNT_RECOVERY,
      context,
    );

    await this.emailService.sendAccountRecoveryOtpEmail(
      user.email,
      user.displayName,
      code,
      user.scheduledPurgeAt.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    );

    return this.challengeResponse(user.email, expiresAt);
  }

  /**
   * What the OTP screen is told.
   *
   * The address is masked rather than returned whole. The user needs to
   * recognise which mailbox to check; showing the full address adds nothing
   * they do not know and puts it on screen for anyone standing nearby.
   */
  /**
   * Reports an already-live challenge, without sending anything.
   *
   * The resend deadline comes from the stored row rather than being recomputed,
   * so a resumed screen counts down to the same instant the server will
   * actually accept a resend at — a freshly computed one would let a refresh
   * quietly reset the cooldown.
   */
  private resumeChallenge(
    email: string,
    live: OtpChallengeState,
  ): OtpChallengeResponse {
    return {
      otpRequired: true,
      maskedEmail: maskEmail(email),
      expiresAt: live.expiresAt,
      resendAvailableAt: live.resendAvailableAt,
    };
  }

  private challengeResponse(
    email: string,
    expiresAt: Date,
  ): OtpChallengeResponse {
    return {
      otpRequired: true,
      maskedEmail: maskEmail(email),
      expiresAt: expiresAt.toISOString(),
      resendAvailableAt: new Date(
        Date.now() + OTP_RESEND_COOLDOWN_MS,
      ).toISOString(),
    };
  }

  /** What the full-screen recovery gate renders. Never inferred client-side. */
  async getStatus(userId: string): Promise<DeletionStatus> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        accountStatus: true,
        deletionRequestedAt: true,
        scheduledPurgeAt: true,
        purgeStartedAt: true,
      },
    });

    if (!user) throw new NotFoundException("This profile isn't available.");

    if (user.accountStatus !== 'PENDING_DELETION') {
      return {
        pendingDeletion: false,
        deletionRequestedAt: null,
        scheduledPurgeAt: null,
        daysRemaining: null,
        recoverable: false,
        recoveryWindowDays: RECOVERY_WINDOW_DAYS,
        email: user.email ?? null,
      };
    }

    const now = Date.now();
    const purgeAt = user.scheduledPurgeAt?.getTime() ?? now;
    const msLeft = Math.max(0, purgeAt - now);

    return {
      pendingDeletion: true,
      deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
      scheduledPurgeAt: user.scheduledPurgeAt?.toISOString() ?? null,
      daysRemaining: Math.floor(msLeft / (24 * 60 * 60 * 1000)),
      // Once the worker has claimed the row the anonymization is already in
      // flight and there is nothing left to restore, so the button goes away
      // rather than failing when pressed.
      recoverable: msLeft > 0 && user.purgeStartedAt === null,
      recoveryWindowDays: RECOVERY_WINDOW_DAYS,
      email: user.email ?? null,
    };
  }

  // ── Step 2: act, once the code has been proved ───────────────────────────

  /**
   * Verifies the deletion code, then schedules the deletion.
   *
   * The order is the whole point: nothing is written until the code has been
   * consumed, so a failed or replayed code leaves the account untouched.
   */
  async confirmDeletion(
    userId: string,
    otp: string,
    context: { ip?: string | null } = {},
  ): Promise<DeletionStatus> {
    await this.otpService.verify(
      userId,
      UserOtpPurpose.ACCOUNT_DELETION,
      otp,
      context,
    );
    return this.requestDeletion(userId);
  }

  /**
   * Verifies the recovery code, then cancels the deletion.
   *
   * If the state transition fails (the window closed between the code being
   * issued and entered) the code has still been consumed — deliberately. A
   * consumed code that did not achieve anything is a minor annoyance; a code
   * left live after being shown to have been received is a replayable
   * credential.
   */
  async confirmRecovery(
    userId: string,
    otp: string,
    context: { ip?: string | null } = {},
  ): Promise<DeletionStatus> {
    await this.otpService.verify(
      userId,
      UserOtpPurpose.ACCOUNT_RECOVERY,
      otp,
      context,
    );
    return this.recoverAccount(userId);
  }

  /**
   * Moves an ACTIVE account into the recovery window.
   *
   * Not reachable directly from HTTP — `confirmDeletion` is the only caller,
   * so the OTP step cannot be skipped by hitting a route. Kept as its own
   * method because the state transition and the identity proof are separate
   * concerns and the tests for each are clearer apart.
   *
   * Idempotent: a second request from a duplicate tab or a retried fetch
   * returns the existing schedule rather than restarting the clock, which would
   * otherwise let a user extend their own window indefinitely by re-requesting.
   */
  async requestDeletion(userId: string): Promise<DeletionStatus> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, accountStatus: true, deletedAt: true },
    });

    if (!user) throw new NotFoundException("This profile isn't available.");

    if (user.accountStatus === 'PENDING_DELETION') {
      return this.getStatus(userId);
    }

    if (user.accountStatus === 'DELETED' || user.deletedAt) {
      throw new NotFoundException("This profile isn't available.");
    }

    if (user.accountStatus === 'BANNED') {
      throw new BadRequestException(
        'This account cannot be deleted from here. Contact support.',
      );
    }

    const now = new Date();
    const scheduledPurgeAt = new Date(now.getTime() + RECOVERY_WINDOW_MS);

    // Conditional on the state we read, so two concurrent requests cannot both
    // stamp a schedule and the second simply reports the first one's.
    const claimed = await this.prisma.user.updateMany({
      where: { id: userId, accountStatus: user.accountStatus, deletedAt: null },
      data: {
        accountStatus: 'PENDING_DELETION',
        // Reusing the column every existing visibility filter already checks.
        deletedAt: now,
        deletionRequestedAt: now,
        scheduledPurgeAt,
        purgeStartedAt: null,
        purgeCompletedAt: null,
        purgeAttempts: 0,
        purgeLastError: null,
      },
    });

    if (claimed.count === 0) {
      // Someone else transitioned the row between our read and write.
      return this.getStatus(userId);
    }

    await this.applySoftDeletionSideEffects(userId);

    // Fire-and-forget: the state change is already committed, and a listener
    // (the conversation-cache eviction) failing must not fail the request.
    void this.domainEventService.emit('user.deletion_requested', {
      userId,
      scheduledPurgeAt: scheduledPurgeAt.toISOString(),
    });

    this.logger.log(
      `Account ${userId} entered PENDING_DELETION; purge eligible ${scheduledPurgeAt.toISOString()}`,
    );

    return this.getStatus(userId);
  }

  /**
   * Returns an account inside its window to ACTIVE.
   *
   * Atomic and idempotent. The single `updateMany` below is the whole race
   * resolution: it matches only a row that is still PENDING_DELETION, still
   * inside its window, and not yet claimed by the worker. If the worker won,
   * `count` is 0 and the user is told plainly rather than being shown a
   * "recovered" screen over an account that is being erased.
   */
  async recoverAccount(userId: string): Promise<DeletionStatus> {
    const now = new Date();

    const restored = await this.prisma.user.updateMany({
      where: {
        id: userId,
        accountStatus: 'PENDING_DELETION',
        scheduledPurgeAt: { gt: now },
        purgeStartedAt: null,
      },
      data: {
        accountStatus: 'ACTIVE',
        deletedAt: null,
        deletionRequestedAt: null,
        scheduledPurgeAt: null,
        purgeAttempts: 0,
        purgeLastError: null,
      },
    });

    if (restored.count === 0) {
      const current = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { accountStatus: true, scheduledPurgeAt: true },
      });

      // Already active — a double-click, or a second device. Idempotent success.
      if (current?.accountStatus === 'ACTIVE') return this.getStatus(userId);

      if (!current || current.accountStatus === 'DELETED') {
        throw new NotFoundException(
          'This account has already been permanently deleted and cannot be recovered.',
        );
      }

      throw new ConflictException(
        'The recovery window for this account has closed and permanent deletion is already under way.',
      );
    }

    await this.applyRecoverySideEffects(userId);

    void this.domainEventService.emit('user.deletion_cancelled', { userId });
    this.logger.log(`Account ${userId} recovered from PENDING_DELETION`);

    return this.getStatus(userId);
  }

  /**
   * Everything outside Postgres that has to agree the account is now hidden.
   *
   * Ordered so that the authoritative caches drop first: a stale account-status
   * entry in `JwtGuard` is the only thing that could let a request through the
   * gate, and a stale auth-sync entry is the only thing that could hand the
   * client a profile that still says ACTIVE.
   */
  private async applySoftDeletionSideEffects(userId: string): Promise<void> {
    // Not `revokeUser` — that kills the session outright, and the user needs a
    // working one to reach the recovery screen. Dropping the cached status is
    // enough: the next request re-reads PENDING_DELETION and JwtGuard refuses
    // everything except the recovery routes.
    JwtGuard.clearAccountStatus(userId);
    clearAuthSyncCache(userId);

    // A recovery code issued during an earlier pass through this flow must not
    // survive into the new window — it would let the deletion be cancelled
    // without a fresh proof of identity.
    await this.otpService
      .invalidate(userId, UserOtpPurpose.ACCOUNT_RECOVERY)
      .catch(() => {});

    await this.presenceService.removePresence(userId).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Presence removal failed for ${userId}: ${message}`);
    });

    await this.invalidateUserCaches(userId);
  }

  private async applyRecoverySideEffects(userId: string): Promise<void> {
    JwtGuard.clearAccountStatus(userId);
    clearAuthSyncCache(userId);

    // Every outstanding code for this user is dropped, both purposes.
    // The recovery code has already been consumed, but a deletion code issued
    // just before the account was recovered would otherwise stay live for the
    // rest of its ten minutes — and it is a code that schedules a deletion.
    await this.otpService.invalidateAll(userId).catch((err) => {
      this.logger.warn(
        `Could not clear one-time codes for ${userId}: ${(err as Error)?.message}`,
      );
    });
    // A deletion request never calls `revokeUser`, but an admin action or an
    // older code path might have; clearing it here makes recovery total.
    JwtGuard.unrevokeUser(userId);
    await this.invalidateUserCaches(userId);
  }

  /**
   * Drops every Redis key that could still describe this user as active.
   *
   * Presence is deliberately NOT rebuilt on recovery — the user comes back
   * online when their socket reconnects, which is the same path a normal
   * sign-in takes.
   */
  private async invalidateUserCaches(userId: string): Promise<void> {
    const redis = this.redisService.getClient();
    if (!redis) return;
    try {
      await redis.del(
        `user:${userId}`,
        `profile:${userId}`,
        `user:profile:${userId}`,
        `suggestions:${userId}`,
      );
    } catch (err) {
      // A cache that failed to clear is a staleness bug, not a correctness one:
      // Postgres is the source of truth and every gate reads it.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Cache invalidation failed for ${userId}: ${message}`);
    }
  }
}
