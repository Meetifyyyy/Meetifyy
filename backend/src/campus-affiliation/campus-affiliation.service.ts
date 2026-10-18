import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CollegeAffiliationMethod,
  Prisma,
  UserOtpPurpose,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UserOtpService } from '../otp/user-otp.service';
import { ADDRESS_MAILER, type AddressMailer } from '../otp/address-mailer';
import { DomainValidatorService } from '../common/services/domain-validator.service';
import { DomainEventService } from '../events/domain-event.service';
import { AuthService, clearAuthSyncCache } from '../auth/auth.service';
import type { AuthenticatedUser } from '../common/types/authenticated-request';
import {
  domainOf,
  maskEmail,
  normalizeCollegeEmail,
  presentAffiliation,
  type AffiliationView,
} from '../common/campus/campus-affiliation.util';
import { deriveBatchYearForStorage } from '../common/student-year/batch-year.util';
import { errorMessage } from '../common/utils/error.util';

/** The realtime event clients drop their campus caches on. */
export const CAMPUS_CHANGED_EVENT = 'user:campus_changed';

const AFFILIATION_VIEW_SELECT = {
  collegeId: true,
  email: true,
  method: true,
  verifiedAt: true,
  revokedAt: true,
  college: {
    select: {
      name: true,
      logoKey: true,
      isActive: true,
      status: true,
      deletedAt: true,
    },
  },
} satisfies Prisma.CollegeAffiliationSelect;

/** What the Super Admin console shows for a user's affiliation. */
export interface AdminAffiliationView {
  collegeId: string;
  collegeName: string;
  email: string;
  method: CollegeAffiliationMethod;
  verifiedAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
}

export interface AffiliationStatus {
  affiliation: AffiliationView | null;
  pending: {
    collegeId: string;
    collegeName: string;
    emailMasked: string;
    expiresAt: string;
    resendAvailableAt: string;
  } | null;
}

export interface OtpSent {
  sent: true;
  emailMasked: string;
  expiresAt: string;
  resendAvailableAt: string;
}

const unavailable = () =>
  new ConflictException({
    code: 'college_email_unavailable',
    // Never says who holds it, or whether it is held at all versus reserved.
    message: 'This college email cannot be used. Try a different address.',
  });

const revoked = () =>
  new ForbiddenException({
    code: 'affiliation_revoked',
    message:
      'Your college verification was revoked by Meetifyy. Contact support to resolve it.',
  });

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/**
 * Verified college email → campus access.
 *
 * The only writer of `CollegeAffiliation` and of its mirror on the user row
 * (`User.collegeId`, `User.collegeEmail`). Every change happens in one
 * transaction with the mirror, then drops the caller's cached profile and
 * announces `user:campus_changed` so open clients refetch campus data.
 *
 * Uniqueness of an address is enforced three times on purpose: a pre-check
 * before any mail is sent (so a taken address does not cost a code), a recheck
 * inside the verify transaction, and the unique index as the final arbiter for
 * the race between the two. All three answer the same generic 409.
 */
@Injectable()
export class CampusAffiliationService {
  private readonly logger = new Logger(CampusAffiliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: UserOtpService,
    private readonly domains: DomainValidatorService,
    private readonly events: DomainEventService,
    private readonly auth: AuthService,
    @Inject(ADDRESS_MAILER) private readonly mailer: AddressMailer,
  ) {}

  // ── Reads ────────────────────────────────────────────────────────────────

  async getAffiliationView(userId: string): Promise<AffiliationView | null> {
    const row = await this.prisma.collegeAffiliation.findUnique({
      where: { userId },
      select: AFFILIATION_VIEW_SELECT,
    });
    return presentAffiliation(row);
  }

  async getStatus(userId: string): Promise<AffiliationStatus> {
    const [affiliation, challenge] = await Promise.all([
      this.getAffiliationView(userId),
      this.otp.getBoundChallenge(userId, UserOtpPurpose.COLLEGE_EMAIL),
    ]);

    let pending: AffiliationStatus['pending'] = null;
    if (challenge?.collegeId && challenge.target) {
      const college = await this.prisma.college.findUnique({
        where: { id: challenge.collegeId },
        select: { name: true },
      });
      pending = {
        collegeId: challenge.collegeId,
        collegeName: college?.name ?? '',
        emailMasked: maskEmail(challenge.target),
        expiresAt: challenge.expiresAt.toISOString(),
        resendAvailableAt: challenge.resendAvailableAt.toISOString(),
      };
    }
    return { affiliation, pending };
  }

  // ── Verification ─────────────────────────────────────────────────────────

  /** An active, approved, not-deleted college, or `invalid_college`. */
  private async requireOpenCollege(collegeId: string) {
    const college = await this.prisma.college.findFirst({
      where: {
        id: collegeId,
        deletedAt: null,
        isActive: true,
        status: 'APPROVED',
      },
      select: { id: true, name: true },
    });
    if (!college) {
      throw new BadRequestException({
        code: 'invalid_college',
        message: 'That college is not available. Choose another one.',
      });
    }
    return college;
  }

  /** The address's domain must be an ACTIVE domain of THAT college. */
  private async assertDomainOfCollege(normalized: string, collegeId: string) {
    const domain = await this.prisma.collegeDomain.findFirst({
      where: {
        collegeId,
        status: 'ACTIVE',
        domain: { equals: domainOf(normalized), mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (!domain) {
      throw new BadRequestException({
        code: 'domain_mismatch',
        message: "That address isn't on this college's email domain.",
      });
    }
  }

  async requestOtp(
    userId: string,
    input: { collegeId: string; email: string },
    context: { ip?: string | null } = {},
  ): Promise<OtpSent> {
    const college = await this.requireOpenCollege(input.collegeId);

    const normalized = normalizeCollegeEmail(input.email, this.domains);
    if (!normalized) {
      throw new BadRequestException({
        code: 'invalid_email',
        message: 'Please enter a valid email address.',
      });
    }
    await this.assertDomainOfCollege(normalized, college.id);

    const [holder, mine] = await Promise.all([
      this.prisma.collegeAffiliation.findUnique({
        where: { emailNormalized: normalized },
        select: { userId: true },
      }),
      this.prisma.collegeAffiliation.findUnique({
        where: { userId },
        select: { emailNormalized: true, collegeId: true, revokedAt: true },
      }),
    ]);
    // An admin revocation is not undone by verifying again.
    if (mine?.revokedAt) throw revoked();
    if (holder && holder.userId !== userId) throw unavailable();
    if (
      mine &&
      mine.emailNormalized === normalized &&
      mine.collegeId === college.id
    ) {
      throw new ConflictException({
        code: 'already_affiliated',
        message: 'This address is already verified on your account.',
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });

    const issued = await this.otp.issue(userId, UserOtpPurpose.COLLEGE_EMAIL, {
      ip: context.ip,
      target: normalized,
      collegeId: college.id,
    });
    // Sent to the address being proven, and only to it.
    await this.mailer.sendCollegeEmailOtp(
      normalized,
      user?.displayName ?? '',
      issued.code,
      college.name,
    );

    const challenge = await this.otp.getBoundChallenge(
      userId,
      UserOtpPurpose.COLLEGE_EMAIL,
    );
    return {
      sent: true,
      emailMasked: maskEmail(normalized),
      expiresAt: issued.expiresAt.toISOString(),
      resendAvailableAt: (
        challenge?.resendAvailableAt ?? issued.expiresAt
      ).toISOString(),
    };
  }

  async verify(
    userId: string,
    code: string,
    context: { ip?: string | null } = {},
  ): Promise<{ affiliation: AffiliationView | null }> {
    // Consumed here, before anything is applied, so a replay fails.
    const bound = await this.otp.verifyBound(
      userId,
      UserOtpPurpose.COLLEGE_EMAIL,
      code,
      context,
    );
    const target = bound.target;
    const collegeId = bound.collegeId;
    if (!target || !collegeId) {
      throw new BadRequestException({
        code: 'invalid_code',
        message: 'That code is not valid. Request a new one to continue.',
      });
    }

    // The college or its domain may have been disabled since the code went out.
    await this.requireOpenCollege(collegeId);
    await this.assertDomainOfCollege(target, collegeId);

    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        const [holder, mine, user] = await Promise.all([
          tx.collegeAffiliation.findUnique({
            where: { emailNormalized: target },
            select: { userId: true },
          }),
          tx.collegeAffiliation.findUnique({
            where: { userId },
            select: { revokedAt: true, collegeId: true },
          }),
          tx.user.findUnique({
            where: { id: userId },
            select: { collegeId: true, isCampusRep: true, batchYear: true },
          }),
        ]);
        if (mine?.revokedAt) throw revoked();
        if (holder && holder.userId !== userId) throw unavailable();

        // One row per user: a new address replaces the old one in place,
        // which is what releases the old address.
        await tx.collegeAffiliation.upsert({
          where: { userId },
          create: {
            userId,
            collegeId,
            email: target,
            emailNormalized: target,
            method: CollegeAffiliationMethod.CAMPUS_OTP,
            verifiedAt: now,
          },
          update: {
            collegeId,
            email: target,
            emailNormalized: target,
            method: CollegeAffiliationMethod.CAMPUS_OTP,
            verifiedAt: now,
            revokedAt: null,
            revokedReason: null,
          },
        });

        // The batch year derived from the address is a default, not an
        // authority: re-verifying (or changing to another address at the same
        // college) must not overwrite the year the user set or corrected. It
        // is written only when there is none yet, or when the college itself
        // changed (the old year belonged to another institution). A null
        // derivation never erases an existing value.
        const previousCollegeId = mine?.collegeId ?? user?.collegeId ?? null;
        const collegeChanged = previousCollegeId !== collegeId;
        const derivedBatchYear = deriveBatchYearForStorage(target);
        const writeBatchYear =
          derivedBatchYear !== null &&
          (user?.batchYear == null || collegeChanged);

        await tx.user.update({
          where: { id: userId },
          data: {
            collegeId,
            collegeEmail: target,
            ...(writeBatchYear ? { batchYear: derivedBatchYear } : {}),
            // A campus representative is a representative OF a campus.
            ...(user?.isCampusRep && user.collegeId !== collegeId
              ? { isCampusRep: false }
              : {}),
          },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw unavailable();
      throw err;
    }

    const affiliation = await this.getAffiliationView(userId);
    await this.announce(userId, affiliation);
    return { affiliation };
  }

  // ── Release ──────────────────────────────────────────────────────────────

  /** The user removes their affiliation; the address becomes free. */
  async remove(
    user: AuthenticatedUser,
    password: string,
  ): Promise<{ success: true }> {
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true },
    });
    // Checked against the CURRENT sign-in address: after a personal-email
    // change the token may still carry the previous one.
    const { valid } = await this.auth.verifyPassword(
      { ...user, email: row?.email ?? user.email },
      password,
    );
    if (!valid) {
      throw new ForbiddenException({
        code: 'invalid_password',
        message: 'Your password is incorrect.',
      });
    }

    const affiliation = await this.prisma.collegeAffiliation.findUnique({
      where: { userId: user.id },
      select: { revokedAt: true },
    });
    if (affiliation?.revokedAt) throw revoked();

    await this.prisma.$transaction(async (tx) => {
      await tx.collegeAffiliation.deleteMany({ where: { userId: user.id } });
      await tx.user.update({
        where: { id: user.id },
        data: { collegeId: null, collegeEmail: null, isCampusRep: false },
      });
    });
    await this.otp.invalidate(user.id, UserOtpPurpose.COLLEGE_EMAIL);
    await this.announce(user.id, null);
    return { success: true };
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  async getAdminView(userId: string): Promise<AdminAffiliationView | null> {
    const row = await this.prisma.collegeAffiliation.findUnique({
      where: { userId },
      select: {
        collegeId: true,
        email: true,
        method: true,
        verifiedAt: true,
        revokedAt: true,
        revokedReason: true,
        college: { select: { name: true } },
      },
    });
    if (!row) return null;
    return {
      collegeId: row.collegeId,
      collegeName: row.college.name,
      email: row.email,
      method: row.method,
      verifiedAt: row.verifiedAt,
      revokedAt: row.revokedAt,
      revokedReason: row.revokedReason,
    };
  }

  /**
   * Admin revocation. Campus access ends and the mirror is cleared; the row and
   * therefore the address stay reserved for audit until an admin deletes it.
   */
  async revoke(
    userId: string,
    reason: string,
  ): Promise<{ collegeAffiliation: AdminAffiliationView | null }> {
    const trimmed = reason.trim().slice(0, 300);
    if (!trimmed) {
      throw new BadRequestException('A reason is required.');
    }
    const existing = await this.prisma.collegeAffiliation.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('This user has no college affiliation.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.collegeAffiliation.update({
        where: { userId },
        data: { revokedAt: new Date(), revokedReason: trimmed },
      });
      await tx.user.update({
        where: { id: userId },
        data: { collegeId: null, collegeEmail: null, isCampusRep: false },
      });
    });
    await this.announce(userId, await this.getAffiliationView(userId));
    return { collegeAffiliation: await this.getAdminView(userId) };
  }

  /**
   * Admin "reset college": deletes the affiliation (releasing the address) and
   * clears the mirror, so the two can never disagree.
   */
  async adminRelease(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.collegeAffiliation.deleteMany({ where: { userId } });
      await tx.user.update({
        where: { id: userId },
        data: { collegeId: null, collegeEmail: null, isCampusRep: false },
      });
    });
    await this.announce(userId, null);
  }

  /**
   * Drops the user's cached profile on every replica and tells their open
   * clients. The gateway also evicts per-user campus caches on this event
   * (RealtimeGateway.handleDomainEvent). Best effort: the next fetch is
   * correct regardless, because every campus read consults the database.
   */
  private async announce(
    userId: string,
    campusAffiliation: AffiliationView | null,
  ): Promise<void> {
    clearAuthSyncCache(userId);
    try {
      await this.events.emit(
        CAMPUS_CHANGED_EVENT,
        { userId, campusAffiliation },
        [userId],
      );
    } catch (err) {
      this.logger.warn(
        `campus_changed announce failed for ${userId}: ${errorMessage(err)}`,
      );
    }
  }
}
