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
  EmailChangeAction,
  EmailChannel,
  Prisma,
  ReauthPurpose,
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
import {
  CampusCommunityOwnerError,
  campusCommunityOwnerConflict,
  getCampusCommunityStanding,
  leaveCampusCommunities,
  type CampusCommunityExit,
  type CampusCommunityStanding,
  type CampusOwnerPolicy,
} from '../common/campus/campus-community-exit';
import { CommunitiesService } from '../communities/communities.service';
import { deriveBatchYearForStorage } from '../common/student-year/batch-year.util';
import { errorMessage } from '../common/utils/error.util';
import {
  ReauthService,
  reauthRequired,
} from '../account-security/reauth.service';
import {
  EmailChangePolicyService,
  allChecks,
} from '../account-security/email-change-policy.service';
import { RateLimitService } from '../common/rate-limit/rate-limit.service';
import { rateLimitException } from '../common/rate-limit/rate-limit.response';

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

/** How the caller re-proved it is the owner, where that is required. */
export interface CollegeEmailProof {
  ip?: string | null;
  sessionId?: string | null;
  /** A grant from `/api/account/reauth`. */
  reauthToken?: string;
}

export interface AffiliationStatus {
  affiliation: AffiliationView | null;
  /**
   * The person's standing in the campus communities of their current college,
   * so the settings screen can say what ending the campus will also do, and
   * which communities must be handed over first. Empty without an active
   * affiliation.
   */
  campusCommunities: CampusCommunityStanding;
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

/** The college an affiliation change left, and what leaving it did. */
type CampusExit = { collegeId: string; exit: CampusCommunityExit } | null;

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
 * Every add, change and removal after the first-ever verification needs a
 * fresh reauthentication grant, and each one starts the 30-day college
 * cooldown (EmailChangePolicyService), which also gates adding an address
 * back after removing one — so remove-and-re-add cannot skip it. The first
 * verification on an account needs no grant (it is how Campus is joined; the
 * code proves the mailbox) but still starts the cooldown. Removal is never
 * blocked by the cooldown: giving up access must always be possible.
 *
 * Whenever an affiliation ends — removed, switched to another college, revoked
 * or released — the person leaves every campus community of the college they
 * left, in the same transaction (`leaveCampusCommunities`). An owner must hand
 * their communities over first when they act themselves (409
 * `CAMPUS_COMMUNITY_OWNER`); an admin's revoke or release cannot be refused, so
 * ownership passes to a successor instead.
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
    private readonly reauth: ReauthService,
    private readonly policy: EmailChangePolicyService,
    private readonly rateLimit: RateLimitService,
    @Inject(ADDRESS_MAILER) private readonly mailer: AddressMailer,
    // Required, not optional: an optional dependency that failed to resolve
    // would silently skip the cache and realtime follow-up of a campus exit.
    private readonly communities: CommunitiesService,
  ) {}

  /**
   * Whether this account has had a college email before (now, revoked, or in
   * its history), which is what makes the next one a change that needs a
   * fresh reauthentication rather than a first verification.
   */
  private async needsReauth(
    userId: string,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<boolean> {
    const row = await db.collegeAffiliation.findUnique({
      where: { userId },
      select: { id: true },
    });
    return row !== null || (await this.policy.hasCollegeHistory(userId, db));
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async getAffiliationView(userId: string): Promise<AffiliationView | null> {
    const row = await this.prisma.collegeAffiliation.findUnique({
      where: { userId },
      select: AFFILIATION_VIEW_SELECT,
    });
    return presentAffiliation(row);
  }

  async getStatus(userId: string): Promise<AffiliationStatus> {
    // Read on every Campus visit, so it stays a few lookups, the challenge one
    // running beside the other two. The cooldown date reaches the client from
    // /api/account/email and from the refusal itself.
    const [{ affiliation, campusCommunities }, challenge] = await Promise.all([
      this.getAffiliationView(userId).then(async (view) => ({
        affiliation: view,
        campusCommunities: view?.active
          ? await getCampusCommunityStanding(
              this.prisma,
              userId,
              view.collegeId,
            )
          : { joinedCount: 0, owned: [] },
      })),
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
    return { affiliation, pending, campusCommunities };
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
    context: CollegeEmailProof = {},
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
        select: {
          emailNormalized: true,
          collegeId: true,
          revokedAt: true,
          college: { select: { name: true } },
        },
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

    // Moving to another college would end this one, and an owner cannot do
    // that until they hand their campus communities over. Said now, before a
    // code is mailed, rather than after they have typed it in.
    const leaving = mine
      ? { id: mine.collegeId, name: mine.college.name }
      : await this.mirroredCollege(this.prisma, userId);
    if (leaving && leaving.id !== college.id) {
      const { owned } = await getCampusCommunityStanding(
        this.prisma,
        userId,
        leaving.id,
      );
      if (owned.length > 0) {
        throw campusCommunityOwnerConflict(leaving.name, owned, 'switch');
      }
    }

    // Before any mail, in parallel: a code that could never be redeemed is
    // noise. `mine` already answers half of needsReauth.
    const sessionId = context.sessionId ?? null;
    const [, needsGrant, user] = await allChecks([
      this.policy.assertEligible(userId, EmailChannel.COLLEGE),
      mine ? Promise.resolve(true) : this.policy.hasCollegeHistory(userId),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { displayName: true },
      }),
    ]);
    if (needsGrant) {
      await this.reauth.assertGrant(
        userId,
        ReauthPurpose.COLLEGE_EMAIL_CHANGE,
        context.reauthToken,
        sessionId,
      );
    }

    const issued = await this.otp.issue(userId, UserOtpPurpose.COLLEGE_EMAIL, {
      ip: context.ip,
      target: normalized,
      collegeId: college.id,
    });
    // The grant can now be spent only on the address this live code went to.
    if (needsGrant) {
      await this.reauth.assertGrant(
        userId,
        ReauthPurpose.COLLEGE_EMAIL_CHANGE,
        context.reauthToken,
        sessionId,
        normalized,
      );
    }
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
    context: CollegeEmailProof = {},
  ): Promise<{ affiliation: AffiliationView | null }> {
    const sessionId = context.sessionId ?? null;
    // Checked before the code is consumed, so neither failure burns it.
    const [needsGrant] = await allChecks([
      this.needsReauth(userId),
      this.policy.assertEligible(userId, EmailChannel.COLLEGE),
    ]);
    if (needsGrant) {
      await this.reauth.assertGrant(
        userId,
        ReauthPurpose.COLLEGE_EMAIL_CHANGE,
        context.reauthToken,
        sessionId,
      );
    }

    // Consumed here, before anything is applied, so a replay fails.
    const bound = await this.otp.verifyBound(
      userId,
      UserOtpPurpose.COLLEGE_EMAIL,
      code,
      { ip: context.ip },
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

    let left: CampusExit;
    try {
      left = await this.prisma.$transaction(async (tx) => {
        // Serialises every email change for this account. Everything below is
        // re-checked under it, not trusted from the checks above.
        const now = await this.policy.lockUser(tx, userId);
        await this.policy.assertEligible(userId, EmailChannel.COLLEGE, tx);
        if (await this.needsReauth(userId, tx)) {
          await this.reauth.consumeGrant(
            tx,
            userId,
            ReauthPurpose.COLLEGE_EMAIL_CHANGE,
            context.reauthToken,
            sessionId,
            target,
          );
        }

        const [holder, mine, user] = await Promise.all([
          tx.collegeAffiliation.findUnique({
            where: { emailNormalized: target },
            select: { userId: true },
          }),
          tx.collegeAffiliation.findUnique({
            where: { userId },
            select: {
              revokedAt: true,
              collegeId: true,
              email: true,
              college: { select: { name: true } },
            },
          }),
          tx.user.findUnique({
            where: { id: userId },
            select: { collegeId: true, isCampusRep: true, batchYear: true },
          }),
        ]);
        if (mine?.revokedAt) throw revoked();
        if (holder && holder.userId !== userId) throw unavailable();

        // A switch ends the old campus: the person leaves its campus
        // communities in this same transaction, or is refused while they own
        // one. A new address at the same college changes nothing here.
        // The college being left is the affiliation's, or — for an account the
        // legacy backfill skipped, which has only the User mirror — the
        // mirror's. Ignoring the mirror let such an owner switch colleges and
        // leave their old campus communities and ownership behind.
        const leavingId = mine?.collegeId ?? user?.collegeId ?? null;
        const exit: CampusExit =
          leavingId && leavingId !== collegeId
            ? {
                collegeId: leavingId,
                exit: await this.leaveCommunitiesOf(
                  tx,
                  userId,
                  leavingId,
                  mine?.college.name ?? (await this.collegeName(tx, leavingId)),
                  'refuse',
                  'switch',
                ),
              }
            : null;

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

        // Starts the 30-day college cooldown; only a committed change does.
        await this.policy.record(tx, {
          userId,
          channel: EmailChannel.COLLEGE,
          action: mine ? EmailChangeAction.CHANGE : EmailChangeAction.ADD,
          previousEmail: mine?.email ?? null,
          newEmail: target,
          at: now,
        });
        return exit;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw unavailable();
      throw err;
    }

    if (left) await this.afterCampusExit(userId, left);
    const affiliation = await this.getAffiliationView(userId);
    await this.announce(userId, affiliation);
    return { affiliation };
  }

  // ── Release ──────────────────────────────────────────────────────────────

  /**
   * The user removes their affiliation; the address becomes free and Campus
   * closes at once (every campus check reads the affiliation row, uncached).
   *
   * Needs a `college_email_remove` grant, or — for installed apps that
   * predate grants — the password, re-checked here. Never blocked by the
   * cooldown, but restarts it, so the next add waits 30 days.
   */
  async remove(
    user: AuthenticatedUser,
    proof: CollegeEmailProof & { password?: string },
  ): Promise<{ success: true }> {
    const sessionId = proof.sessionId ?? null;
    if (proof.reauthToken) {
      await this.reauth.assertGrant(
        user.id,
        ReauthPurpose.COLLEGE_EMAIL_REMOVE,
        proof.reauthToken,
        sessionId,
      );
    } else if (proof.password) {
      // The legacy body is a password oracle: it spends the password budget.
      const decision = await this.rateLimit.consume(
        'auth.verifypassword.user',
        user.id,
      );
      if (!decision.allowed) throw rateLimitException(decision);
      const row = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { email: true },
      });
      // Checked against the CURRENT sign-in address: after a personal-email
      // change the token may still carry the previous one.
      const { valid } = await this.auth.verifyPassword(
        { ...user, email: row?.email ?? user.email },
        proof.password,
      );
      if (!valid) {
        throw new ForbiddenException({
          code: 'invalid_password',
          message: 'Your password is incorrect.',
        });
      }
    } else {
      throw reauthRequired();
    }

    const affiliation = await this.prisma.collegeAffiliation.findUnique({
      where: { userId: user.id },
      select: { revokedAt: true },
    });
    if (affiliation?.revokedAt) throw revoked();

    const left = await this.prisma.$transaction(async (tx) => {
      const now = await this.policy.lockUser(tx, user.id);
      if (proof.reauthToken) {
        await this.reauth.consumeGrant(
          tx,
          user.id,
          ReauthPurpose.COLLEGE_EMAIL_REMOVE,
          proof.reauthToken,
          sessionId,
        );
      }
      const existing = await tx.collegeAffiliation.findUnique({
        where: { userId: user.id },
        select: {
          email: true,
          revokedAt: true,
          collegeId: true,
          college: { select: { name: true } },
        },
      });
      if (existing?.revokedAt) throw revoked();
      // Refused while the person owns a campus community. It happens inside
      // the transaction, after the grant is consumed, so the refusal rolls
      // the grant back and they can retry once they have handed over.
      const exit: CampusExit = existing
        ? {
            collegeId: existing.collegeId,
            exit: await this.leaveCommunitiesOf(
              tx,
              user.id,
              existing.collegeId,
              existing.college.name,
              'refuse',
              'remove',
            ),
          }
        : null;
      await tx.collegeAffiliation.deleteMany({ where: { userId: user.id } });
      await tx.user.update({
        where: { id: user.id },
        data: { collegeId: null, collegeEmail: null, isCampusRep: false },
      });
      // A retry after a removal that already committed removes nothing and
      // must not push the cooldown further out.
      if (existing) {
        await this.policy.record(tx, {
          userId: user.id,
          channel: EmailChannel.COLLEGE,
          action: EmailChangeAction.REMOVE,
          previousEmail: existing.email,
          at: now,
        });
      }
      return exit;
    });
    if (left) await this.afterCampusExit(user.id, left);
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
      select: { id: true, email: true, collegeId: true },
    });
    if (!existing) {
      throw new NotFoundException('This user has no college affiliation.');
    }
    // Security revocation: never blocked by a cooldown, and starts none.
    const exit = await this.prisma.$transaction(async (tx) => {
      const now = await this.policy.lockUser(tx, userId);
      // Re-read under the user lock: the pre-transaction read could predate a
      // switch to another college, which would leave the wrong campus's
      // communities behind.
      const current = await tx.collegeAffiliation.findUnique({
        where: { userId },
        select: { collegeId: true },
      });
      // An admin cannot be refused: owned communities pass to a successor.
      const left = await this.leaveCommunitiesOf(
        tx,
        userId,
        current?.collegeId ?? existing.collegeId,
        '',
        'transfer',
      );
      await tx.collegeAffiliation.update({
        where: { userId },
        data: { revokedAt: now, revokedReason: trimmed },
      });
      await tx.user.update({
        where: { id: userId },
        data: { collegeId: null, collegeEmail: null, isCampusRep: false },
      });
      await this.policy.record(tx, {
        userId,
        channel: EmailChannel.COLLEGE,
        action: EmailChangeAction.ADMIN_REVOKE,
        previousEmail: existing.email,
        at: now,
      });
      return left;
    });
    await this.afterCampusExit(userId, {
      collegeId: existing.collegeId,
      exit,
    });
    await this.announce(userId, await this.getAffiliationView(userId));
    return { collegeAffiliation: await this.getAdminView(userId) };
  }

  /**
   * Admin "reset college": deletes the affiliation (releasing the address) and
   * clears the mirror, so the two can never disagree.
   */
  async adminRelease(userId: string): Promise<void> {
    const left = await this.prisma.$transaction(async (tx) => {
      const now = await this.policy.lockUser(tx, userId);
      const existing = await tx.collegeAffiliation.findUnique({
        where: { userId },
        select: { email: true, collegeId: true },
      });
      const exit: CampusExit = existing
        ? {
            collegeId: existing.collegeId,
            exit: await this.leaveCommunitiesOf(
              tx,
              userId,
              existing.collegeId,
              '',
              'transfer',
            ),
          }
        : null;
      await tx.collegeAffiliation.deleteMany({ where: { userId } });
      await tx.user.update({
        where: { id: userId },
        data: { collegeId: null, collegeEmail: null, isCampusRep: false },
      });
      // Recovery, recorded for audit; starts no cooldown.
      if (existing) {
        await this.policy.record(tx, {
          userId,
          channel: EmailChannel.COLLEGE,
          action: EmailChangeAction.ADMIN_RELEASE,
          previousEmail: existing.email,
          at: now,
        });
      }
      return exit;
    });
    if (left) await this.afterCampusExit(userId, left);
    await this.announce(userId, null);
  }

  // ── Campus communities ───────────────────────────────────────────────────

  /**
   * Runs the campus-community exit inside the caller's transaction and turns
   * the owner refusal into the 409 the apps show. `collegeName` is used only
   * for that message, which only a user path can reach.
   */
  /**
   * The college an account is mirrored to when it has no affiliation row: the
   * legacy backfill skipped duplicate or malformed college emails, so such
   * accounts can still hold `User.collegeId` (and campus communities).
   */
  private async mirroredCollege(
    db: Prisma.TransactionClient,
    userId: string,
  ): Promise<{ id: string; name: string } | null> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { collegeId: true },
    });
    if (!user?.collegeId) return null;
    return {
      id: user.collegeId,
      name: await this.collegeName(db, user.collegeId),
    };
  }

  private async collegeName(
    db: Prisma.TransactionClient,
    collegeId: string,
  ): Promise<string> {
    const college = await db.college.findUnique({
      where: { id: collegeId },
      select: { name: true },
    });
    return college?.name ?? 'your college';
  }

  private async leaveCommunitiesOf(
    tx: Prisma.TransactionClient,
    userId: string,
    collegeId: string,
    collegeName: string,
    owners: CampusOwnerPolicy,
    action: 'remove' | 'switch' = 'remove',
  ): Promise<CampusCommunityExit> {
    try {
      return await leaveCampusCommunities(tx, { userId, collegeId, owners });
    } catch (err) {
      if (err instanceof CampusCommunityOwnerError) {
        throw campusCommunityOwnerConflict(
          collegeName,
          err.communities,
          action,
        );
      }
      throw err;
    }
  }

  /**
   * After the commit: the cache and realtime follow-up of the leaves and
   * handovers, and a log line for any owned community nobody could inherit.
   * Best effort — the rows are already correct, and every campus read consults
   * the database.
   */
  private async afterCampusExit(
    userId: string,
    { collegeId, exit }: NonNullable<CampusExit>,
  ): Promise<void> {
    for (const communityId of exit.unsuccessored) {
      this.logger.warn(
        `No eligible successor for campus community ${communityId}; ownership left unchanged`,
      );
    }
    if (exit.removed.length === 0 && exit.transfers.length === 0) return;
    try {
      await this.communities.announceCampusExit(userId, collegeId, exit);
    } catch (err) {
      this.logger.warn(
        `campus community exit announce failed for ${userId}: ${errorMessage(err)}`,
      );
    }
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
