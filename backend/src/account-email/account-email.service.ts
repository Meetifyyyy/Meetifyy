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
import { Prisma, UserOtpPurpose } from '@prisma/client';
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

/** Placeholder domains the platform itself writes. Never a real inbox. */
const RESERVED_DOMAINS = ['meetifyy.user', 'deleted.meetifyy'];

const emailTaken = () =>
  new ConflictException({
    code: 'email_taken',
    message: 'That email is already used by another account.',
  });

/**
 * Changing the sign-in (personal) email.
 *
 * The ONLY path that changes `User.email` or the Supabase auth email of an
 * existing account. In order:
 *   1. a code is sent ONLY to the new address, stored HMAC'd in `UserOtp`
 *      (purpose PERSONAL_EMAIL) with `target` = the normalized new address;
 *   2. verify takes `{ code, currentPassword }` and nothing else; the current
 *      password is re-proven first, so a borrowed session cannot do this;
 *   3. the code is consumed atomically (single use) before anything is applied,
 *      and the address applied is the code's bound `target`;
 *   4. `target` is re-checked against every other `User.email`;
 *   5. only then is the auth email set (`email_confirm: true` — the code just
 *      proved control of it), then `User.email`. If the database write fails
 *      the auth email is put back, so the two never disagree.
 */
@Injectable()
export class AccountEmailService {
  private readonly logger = new Logger(AccountEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
    private readonly otp: UserOtpService,
    private readonly auth: AuthService,
    @Inject(ADDRESS_MAILER) private readonly mailer: AddressMailer,
  ) {}

  async getStatus(userId: string): Promise<{
    email: string | null;
    collegeEmail: string | null;
    needsPersonalEmail: boolean;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        collegeAffiliation: { select: { email: true, emailNormalized: true } },
      },
    });
    const affiliation = user?.collegeAffiliation ?? null;
    return {
      email: user?.email ?? null,
      collegeEmail: affiliation?.email ?? null,
      needsPersonalEmail: Boolean(
        affiliation &&
        user?.email &&
        normalizeEmail(user.email) === affiliation.emailNormalized,
      ),
    };
  }

  async requestOtp(
    userId: string,
    rawEmail: string,
    context: { ip?: string | null } = {},
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

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, displayName: true },
    });
    if (user && normalizeEmail(user.email) === target) {
      throw new BadRequestException({
        code: 'same_email',
        message: 'That is already the email you sign in with.',
      });
    }
    if (await this.isEmailHeldByAnother(target, userId)) throw emailTaken();

    const issued = await this.otp.issue(userId, UserOtpPurpose.PERSONAL_EMAIL, {
      ip: context.ip,
      target,
    });
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
  ): Promise<boolean> {
    const holder = await this.prisma.user.findFirst({
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
    currentPassword: string,
    context: { ip?: string | null } = {},
  ): Promise<{ email: string }> {
    if (!this.supabase.isConfigured) {
      throw new UnauthorizedException('Authentication is not configured.');
    }
    const current = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true, displayName: true },
    });
    if (!current) throw new UnauthorizedException('Account not found.');

    // (2) Password first: a wrong password must not burn the code.
    const { valid } = await this.auth.verifyPassword(
      { ...user, email: current.email },
      currentPassword,
    );
    if (!valid) {
      throw new ForbiddenException({
        code: 'invalid_password',
        message: 'Your current password is incorrect.',
      });
    }

    // (3) Consumed before anything is applied; the bound target is the ONLY
    // address that can be applied.
    const { target } = await this.otp.verifyBound(
      user.id,
      UserOtpPurpose.PERSONAL_EMAIL,
      code,
      context,
    );
    if (!target) {
      throw new BadRequestException({
        code: 'invalid_code',
        message: 'That code is not valid. Request a new one to continue.',
      });
    }

    // (4) Someone may have taken the address since the code went out.
    if (await this.isEmailHeldByAnother(target, user.id)) throw emailTaken();
    if (normalizeEmail(current.email) === target) return { email: target };

    // Captured before any write, for the rollback and the notice.
    const previousEmail = current.email;
    const name = current.displayName ?? '';

    // (5) Auth email first, then the row; undo the first if the second fails.
    const { error } = await this.supabase.client.auth.admin.updateUserById(
      user.id,
      { email: target, email_confirm: true },
    );
    if (error) {
      if (/already|registered|exists/i.test(error.message ?? '')) {
        throw emailTaken();
      }
      this.logger.warn(
        `auth email update failed for ${user.id}: ${error.message}`,
      );
      throw new BadGatewayException(
        "Couldn't update your email right now. Please try again.",
      );
    }

    try {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { email: target },
      });
    } catch (err) {
      await this.restoreAuthEmail(user.id, previousEmail);
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

    // Fire-and-forget on purpose: the change is committed on both sides, and a
    // mail-queue hiccup must not turn a completed change into an error the
    // client would retry. The notice goes to the OLD address — the one inbox
    // an owner who did not make this change still controls — and shows the
    // new address only masked.
    void this.mailer
      .sendSignInEmailChangedNotice(previousEmail, name, maskEmail(target))
      .catch((err: unknown) =>
        this.logger.warn(
          `email-changed notice failed for ${user.id}: ${errorMessage(err)}`,
        ),
      );
    return { email: target };
  }

  private async restoreAuthEmail(userId: string, previous: string) {
    try {
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
