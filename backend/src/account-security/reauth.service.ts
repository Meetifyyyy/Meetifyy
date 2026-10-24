import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { Prisma, ReauthPurpose, UserOtpPurpose } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthService } from '../auth/auth.service';
import { UserOtpService } from '../otp/user-otp.service';
import { ADDRESS_MAILER, type AddressMailer } from '../otp/address-mailer';
import { maskEmail } from '../common/campus/campus-affiliation.util';
import { errorMessage } from '../common/utils/error.util';
import type { AuthenticatedUser } from '../common/types/authenticated-request';
import {
  REAUTH_GRANT_TTL_MS,
  REAUTH_REQUIRED_CODE,
} from './account-security.constants';

/** The purposes as the API spells them. */
export const REAUTH_PURPOSES = {
  personal_email_change: ReauthPurpose.PERSONAL_EMAIL_CHANGE,
  college_email_change: ReauthPurpose.COLLEGE_EMAIL_CHANGE,
  college_email_remove: ReauthPurpose.COLLEGE_EMAIL_REMOVE,
} as const;
export type ReauthPurposeName = keyof typeof REAUTH_PURPOSES;

/**
 * How an account can prove it is its owner right now.
 *
 *  'password'    — the account has a password identity: it must re-enter it.
 *  'email_code'  — no password (an OAuth or passwordless identity): a code is
 *                  sent to the current sign-in address instead.
 */
export type ReauthMethod = 'password' | 'email_code';

export const reauthRequired = () =>
  new ForbiddenException({
    code: REAUTH_REQUIRED_CODE,
    message: "For your security, confirm it's you to continue.",
  });

const PLACEHOLDER_DOMAINS = ['meetifyy.user', 'deleted.meetifyy'];

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** What every check of a grant matches on, besides the token itself. */
function liveGrantWhere(
  userId: string,
  purpose: ReauthPurpose,
  token: string,
  sessionId: string | null,
  now: Date,
): Prisma.ReauthGrantWhereInput {
  return {
    tokenHash: hashToken(token),
    userId,
    purpose,
    sessionId,
    consumedAt: null,
    expiresAt: { gt: now },
  };
}

/**
 * Fresh reauthentication for the sensitive email operations.
 *
 * A successful check issues a grant: an opaque 256-bit token the client holds
 * in memory and sends with the operation. The server never accepts a flag, a
 * timestamp or an existing session as proof; only a live grant whose hash
 * matches, issued to THIS user, for THIS purpose, in THIS session, unexpired
 * and unspent. It is bound to the address it is first used with, and spent by
 * the conditional update inside the transaction that applies the change, so it
 * works exactly once and a rolled-back change leaves it spendable.
 *
 * Password checks go through `AuthService.verifyPassword` (Supabase), so no
 * password is compared, stored or logged here. The routes carry the
 * `auth.verifypassword.user` budget; email codes carry the OTP limits.
 */
@Injectable()
export class ReauthService {
  private readonly logger = new Logger(ReauthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
    private readonly auth: AuthService,
    private readonly otp: UserOtpService,
    @Inject(ADDRESS_MAILER) private readonly mailer: AddressMailer,
  ) {}

  /**
   * The sign-in address and whether a password identity exists, read from
   * Supabase Auth (the only holder of either). If that read fails the account
   * is treated as a password account: the password check then fails closed.
   */
  private async identity(
    userId: string,
  ): Promise<{ email: string | null; hasPassword: boolean }> {
    try {
      const { data, error } =
        await this.supabase.client.auth.admin.getUserById(userId);
      if (error || !data?.user) throw new Error(error?.message ?? 'no user');
      const identities = data.user.identities;
      const email = data.user.email ?? null;
      return {
        email:
          email && !PLACEHOLDER_DOMAINS.includes(email.split('@')[1] ?? '')
            ? email
            : null,
        hasPassword: identities
          ? identities.some((i) => i.provider === 'email')
          : true,
      };
    } catch (err) {
      this.logger.warn(
        `reauth identity lookup failed for ${userId}: ${errorMessage(err)}`,
      );
      return { email: null, hasPassword: true };
    }
  }

  async getMethods(userId: string): Promise<{ methods: ReauthMethod[] }> {
    const { email, hasPassword } = await this.identity(userId);
    if (hasPassword) return { methods: ['password'] };
    return { methods: email ? ['email_code'] : [] };
  }

  async withPassword(
    user: AuthenticatedUser,
    purpose: ReauthPurpose,
    password: string,
    sessionId: string | null,
  ): Promise<{ reauthToken: string; expiresAt: string }> {
    const { email, hasPassword } = await this.identity(user.id);
    if (!hasPassword) {
      throw new BadRequestException({
        code: 'password_not_set',
        message:
          "This account doesn't use a password. Confirm by email instead.",
      });
    }
    // The address just read from Supabase Auth: saves verifyPassword a second
    // lookup. Null (placeholder or failed read) falls back to its own.
    const { valid } = await this.auth.verifyPassword(
      user,
      password,
      email ?? undefined,
    );
    if (!valid) {
      throw new ForbiddenException({
        code: 'invalid_password',
        message: 'Your password is incorrect.',
      });
    }
    return this.issueGrant(user.id, purpose, sessionId, 'password');
  }

  /**
   * For an account with no password: a code to the CURRENT sign-in address.
   * A password account cannot take this path — that would let a stolen
   * session with mailbox access skip the stronger factor the owner chose.
   */
  async sendCode(
    user: AuthenticatedUser,
    purpose: ReauthPurpose,
    context: { ip?: string | null } = {},
  ): Promise<{
    sent: true;
    emailMasked: string;
    expiresAt: string;
    resendAvailableAt: string;
  }> {
    const { email, hasPassword } = await this.identity(user.id);
    if (hasPassword) {
      throw new BadRequestException({
        code: 'use_password',
        message: 'Confirm with your password.',
      });
    }
    if (!email) {
      throw new BadRequestException({
        code: 'no_reauth_method',
        message: 'Contact support to make this change.',
      });
    }
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { displayName: true },
    });
    // Bound to the purpose, so a code for one operation cannot open another.
    const issued = await this.otp.issue(user.id, UserOtpPurpose.REAUTH, {
      ip: context.ip,
      target: purpose,
    });
    await this.mailer.sendReauthCode(
      email,
      row?.displayName ?? '',
      issued.code,
    );
    const challenge = await this.otp.getBoundChallenge(
      user.id,
      UserOtpPurpose.REAUTH,
    );
    return {
      sent: true,
      emailMasked: maskEmail(email),
      expiresAt: issued.expiresAt.toISOString(),
      resendAvailableAt: (
        challenge?.resendAvailableAt ?? issued.expiresAt
      ).toISOString(),
    };
  }

  async withCode(
    user: AuthenticatedUser,
    purpose: ReauthPurpose,
    code: string,
    sessionId: string | null,
    context: { ip?: string | null } = {},
  ): Promise<{ reauthToken: string; expiresAt: string }> {
    const { target } = await this.otp.verifyBound(
      user.id,
      UserOtpPurpose.REAUTH,
      code,
      context,
    );
    if (target !== purpose) {
      throw new BadRequestException({
        code: 'invalid_code',
        message: 'That code is not valid. Request a new one to continue.',
      });
    }
    return this.issueGrant(user.id, purpose, sessionId, 'email_code');
  }

  /** One live grant per (user, purpose): issuing replaces the previous one. */
  private async issueGrant(
    userId: string,
    purpose: ReauthPurpose,
    sessionId: string | null,
    method: 'password' | 'email_code',
  ): Promise<{ reauthToken: string; expiresAt: string }> {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + REAUTH_GRANT_TTL_MS);
    await this.prisma.$transaction([
      this.prisma.reauthGrant.deleteMany({
        where: {
          userId,
          OR: [
            { purpose },
            { expiresAt: { lte: now } },
            { consumedAt: { not: null } },
          ],
        },
      }),
      this.prisma.reauthGrant.create({
        data: {
          userId,
          purpose,
          tokenHash: hashToken(token),
          sessionId,
          method,
          expiresAt,
        },
      }),
    ]);
    this.logger.log(
      `Reauth grant issued (${purpose}, ${method}) for ${userId}`,
    );
    return { reauthToken: token, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Checks a grant without spending it, and binds it to `target`: the grant
   * then can only be spent on the address the live code was sent to. Sending
   * a code to a different address rebinds it, which is safe because issuing
   * that code also replaced the previous one (one live code per purpose).
   * Throws `reauth_required` for anything but a live, matching grant.
   */
  async assertGrant(
    userId: string,
    purpose: ReauthPurpose,
    token: string | null | undefined,
    sessionId: string | null,
    target?: string,
  ): Promise<void> {
    if (!token) throw reauthRequired();
    const where = liveGrantWhere(userId, purpose, token, sessionId, new Date());
    if (target) {
      const bound = await this.prisma.reauthGrant.updateMany({
        where,
        data: { target },
      });
      if (bound.count === 0) throw reauthRequired();
      return;
    }
    const live = await this.prisma.reauthGrant.findFirst({
      where,
      select: { id: true },
    });
    if (!live) throw reauthRequired();
  }

  /**
   * Spends a grant inside the caller's transaction. Exactly one of any number
   * of concurrent requests carrying the same token can match the unspent row.
   */
  async consumeGrant(
    tx: Prisma.TransactionClient,
    userId: string,
    purpose: ReauthPurpose,
    token: string | null | undefined,
    sessionId: string | null,
    target?: string,
  ): Promise<void> {
    if (!token) throw reauthRequired();
    const now = new Date();
    const where = liveGrantWhere(userId, purpose, token, sessionId, now);
    const spent = await tx.reauthGrant.updateMany({
      where: target ? { ...where, OR: [{ target: null }, { target }] } : where,
      data: { consumedAt: now },
    });
    if (spent.count === 0) throw reauthRequired();
  }
}
