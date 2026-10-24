import { HttpException } from '@nestjs/common';
import { Prisma, UserOtpPurpose } from '@prisma/client';
import { CampusAffiliationService } from './campus-affiliation.service';
import { UserOtpService } from '../otp/user-otp.service';
import { DomainValidatorService } from '../common/services/domain-validator.service';
import { CampusAccessService } from '../common/campus/campus-access.service';
import { createUserOtpStore } from '../otp/testing/user-otp-store.fake';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { AuthService } from '../auth/auth.service';
import type { AddressMailer } from '../otp/address-mailer';
import type { AuthenticatedUser } from '../common/types/authenticated-request';
import type { ReauthService } from '../account-security/reauth.service';
import type { EmailChangePolicyService } from '../account-security/email-change-policy.service';
import type { RateLimitService } from '../common/rate-limit/rate-limit.service';

/**
 * Campus college-email verification, end to end through the real OTP service
 * over an in-memory database.
 */
describe('CampusAffiliationService', () => {
  const ME = 'user-me';
  const OTHER = 'user-other';
  const GLA = 'college-gla';
  const IIT = 'college-iit';
  const CLOSED = 'college-closed';

  interface CollegeRow {
    id: string;
    name: string;
    logoKey: string | null;
    isActive: boolean;
    status: string;
    deletedAt: Date | null;
  }
  interface AffRow {
    id: string;
    userId: string;
    collegeId: string;
    email: string;
    emailNormalized: string;
    method: string;
    verifiedAt: Date;
    revokedAt: Date | null;
    revokedReason: string | null;
  }
  interface UserRow {
    id: string;
    email: string;
    displayName: string;
    collegeId: string | null;
    collegeEmail: string | null;
    isCampusRep: boolean;
    batchYear: number | null;
  }

  let colleges: Map<string, CollegeRow>;
  let domains: Array<{ collegeId: string; domain: string; status: string }>;
  let affiliations: Map<string, AffRow>;
  let users: Map<string, UserRow>;
  let otpStore: ReturnType<typeof createUserOtpStore>;
  let raceOnNextUpsert: boolean;
  let sentCodes: Array<{ to: string; code: string }>;
  let emit: jest.Mock;
  let verifyPassword: jest.Mock;
  let service: CampusAffiliationService;
  let access: CampusAccessService;

  const p2002 = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });

  const withCollege = (row: AffRow) => ({
    ...row,
    college: colleges.get(row.collegeId)!,
  });

  const findAffiliation = (where: {
    userId?: string;
    emailNormalized?: string;
  }) => {
    if (where.userId) return affiliations.get(where.userId) ?? null;
    for (const row of affiliations.values()) {
      if (row.emailNormalized === where.emailNormalized) return row;
    }
    return null;
  };

  const buildPrisma = () => {
    const db = {
      userOtp: otpStore.model,
      college: {
        findFirst: jest.fn(
          ({ where }: { where: { id: string; deletedAt: null } }) => {
            const c = colleges.get(where.id);
            return Promise.resolve(
              c && c.isActive && c.status === 'APPROVED' && !c.deletedAt
                ? { id: c.id, name: c.name }
                : null,
            );
          },
        ),
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(colleges.get(where.id) ?? null),
        ),
      },
      collegeDomain: {
        findFirst: jest.fn(
          ({
            where,
          }: {
            where: {
              collegeId: string;
              status: string;
              domain: { equals: string };
            };
          }) =>
            Promise.resolve(
              domains.find(
                (d) =>
                  d.collegeId === where.collegeId &&
                  d.status === where.status &&
                  d.domain.toLowerCase() === where.domain.equals.toLowerCase(),
              )
                ? { id: 'd' }
                : null,
            ),
        ),
      },
      collegeAffiliation: {
        findUnique: jest.fn(
          ({
            where,
          }: {
            where: { userId?: string; emailNormalized?: string };
          }) => {
            const row = findAffiliation(where);
            return Promise.resolve(row ? withCollege(row) : null);
          },
        ),
        upsert: jest.fn(
          ({
            where,
            create,
            update,
          }: {
            where: { userId: string };
            create: Omit<AffRow, 'id' | 'revokedAt' | 'revokedReason'>;
            update: Partial<AffRow>;
          }) => {
            if (raceOnNextUpsert) {
              raceOnNextUpsert = false;
              return Promise.reject(p2002());
            }
            const existing = affiliations.get(where.userId);
            const next: AffRow = existing
              ? { ...existing, ...update }
              : {
                  id: `aff-${where.userId}`,
                  revokedAt: null,
                  revokedReason: null,
                  ...create,
                };
            for (const row of affiliations.values()) {
              if (
                row.userId !== where.userId &&
                row.emailNormalized === next.emailNormalized
              ) {
                return Promise.reject(p2002());
              }
            }
            affiliations.set(where.userId, next);
            return Promise.resolve(next);
          },
        ),
        update: jest.fn(
          ({
            where,
            data,
          }: {
            where: { userId: string };
            data: Partial<AffRow>;
          }) => {
            const row = affiliations.get(where.userId)!;
            Object.assign(row, data);
            return Promise.resolve(row);
          },
        ),
        deleteMany: jest.fn(({ where }: { where: { userId: string } }) => {
          const had = affiliations.delete(where.userId);
          return Promise.resolve({ count: had ? 1 : 0 });
        }),
      },
      user: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(users.get(where.id) ?? null),
        ),
        update: jest.fn(
          ({
            where,
            data,
          }: {
            where: { id: string };
            data: Partial<UserRow>;
          }) => {
            const row = users.get(where.id)!;
            Object.assign(row, data);
            return Promise.resolve(row);
          },
        ),
      },
    };
    return {
      ...db,
      $transaction: jest.fn((fn: (tx: typeof db) => Promise<unknown>) =>
        fn(db),
      ),
    };
  };

  beforeEach(() => {
    colleges = new Map([
      [
        GLA,
        {
          id: GLA,
          name: 'GLA University',
          logoKey: 'colleges/gla.png',
          isActive: true,
          status: 'APPROVED',
          deletedAt: null,
        },
      ],
      [
        IIT,
        {
          id: IIT,
          name: 'IIT',
          logoKey: null,
          isActive: true,
          status: 'APPROVED',
          deletedAt: null,
        },
      ],
      [
        CLOSED,
        {
          id: CLOSED,
          name: 'Closed',
          logoKey: null,
          isActive: false,
          status: 'APPROVED',
          deletedAt: null,
        },
      ],
    ]);
    domains = [
      { collegeId: GLA, domain: 'gla.ac.in', status: 'ACTIVE' },
      { collegeId: GLA, domain: 'old.gla.ac.in', status: 'DISABLED' },
      { collegeId: IIT, domain: 'iit.ac.in', status: 'ACTIVE' },
      { collegeId: CLOSED, domain: 'closed.edu', status: 'ACTIVE' },
    ];
    affiliations = new Map();
    users = new Map([
      [
        ME,
        {
          id: ME,
          email: 'me@gmail.com',
          displayName: 'Me',
          collegeId: null,
          collegeEmail: null,
          isCampusRep: false,
          batchYear: null,
        },
      ],
      [
        OTHER,
        {
          id: OTHER,
          email: 'other@gmail.com',
          displayName: 'Other',
          collegeId: null,
          collegeEmail: null,
          isCampusRep: false,
          batchYear: null,
        },
      ],
    ]);
    otpStore = createUserOtpStore();
    raceOnNextUpsert = false;
    sentCodes = [];
    emit = jest.fn(() => Promise.resolve());
    verifyPassword = jest.fn((_u: AuthenticatedUser, password: string) =>
      Promise.resolve({ valid: password === 'right-password' }),
    );

    const prisma = stub<PrismaService>(buildPrisma());
    const otp = new UserOtpService(
      prisma,
      stub<RedisService>({ getClient: () => null }),
    );
    const mailer: AddressMailer = {
      sendCollegeEmailOtp: jest.fn((to: string, _n: string, code: string) => {
        sentCodes.push({ to, code });
        return Promise.resolve();
      }),
      sendPersonalEmailOtp: jest.fn(() => Promise.resolve()),
      sendReauthCode: jest.fn(() => Promise.resolve()),
      sendSignInEmailChangedNotice: jest.fn(() => Promise.resolve()),
    };
    service = new CampusAffiliationService(
      prisma,
      otp,
      new DomainValidatorService(prisma),
      stub<DomainEventService>({ emit }),
      stub<AuthService>({ verifyPassword }),
      // Grants and cooldowns are covered against a real database in
      // account-security/email-change.db.spec.ts; here they always pass.
      stub<ReauthService>({
        assertGrant: jest.fn(() => Promise.resolve()),
        consumeGrant: jest.fn(() => Promise.resolve()),
      }),
      stub<EmailChangePolicyService>({
        lockUser: jest.fn(() => Promise.resolve(new Date())),
        assertEligible: jest.fn(() => Promise.resolve()),
        hasCollegeHistory: jest.fn(() => Promise.resolve(false)),
        getCooldowns: jest.fn(() =>
          Promise.resolve({ personal: null, college: null }),
        ),
        record: jest.fn(() => Promise.resolve({ id: 'event-1' })),
      }),
      stub<RateLimitService>({
        consume: jest.fn(() => Promise.resolve({ allowed: true })),
      }),
      mailer,
    );
    access = new CampusAccessService(prisma);
  });

  const errorCode = async (p: Promise<unknown>) => {
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HttpException);
    return ((err as HttpException).getResponse() as { code?: string }).code;
  };

  /** Rewinds the stored code past its resend cooldown. */
  const pastCooldown = (userId = ME) => {
    const row = otpStore.get(userId, UserOtpPurpose.COLLEGE_EMAIL);
    if (row) row.createdAt = new Date(Date.now() - 120_000);
  };

  const lastCode = () => sentCodes[sentCodes.length - 1].code;

  const verifyAs = async (userId: string, email: string, collegeId = GLA) => {
    await service.requestOtp(userId, { collegeId, email });
    return service.verify(userId, lastCode());
  };

  describe('sending a code', () => {
    it('sends to the normalized college address only, and masks it in the reply', async () => {
      const res = await service.requestOtp(ME, {
        collegeId: GLA,
        email: '  Sarthak.Saini_CS25@GLA.ac.in ',
      });
      expect(sentCodes.map((m) => m.to)).toEqual([
        'sarthak.saini_cs25@gla.ac.in',
      ]);
      expect(lastCode()).toMatch(/^\d{6}$/);
      expect(res.emailMasked).toBe('sa***@gla.ac.in');
      expect(JSON.stringify(res)).not.toContain(lastCode());
      const stored = otpStore.get(ME, UserOtpPurpose.COLLEGE_EMAIL)!;
      expect(stored.target).toBe('sarthak.saini_cs25@gla.ac.in');
      expect(stored.collegeId).toBe(GLA);
    });

    it('refuses an address whose domain belongs to a different college', async () => {
      expect(
        await errorCode(
          service.requestOtp(ME, { collegeId: GLA, email: 'me@iit.ac.in' }),
        ),
      ).toBe('domain_mismatch');
      expect(sentCodes).toHaveLength(0);
    });

    it('refuses a personal domain and a disabled domain of the right college', async () => {
      expect(
        await errorCode(
          service.requestOtp(ME, { collegeId: GLA, email: 'me@gmail.com' }),
        ),
      ).toBe('domain_mismatch');
      expect(
        await errorCode(
          service.requestOtp(ME, { collegeId: GLA, email: 'me@old.gla.ac.in' }),
        ),
      ).toBe('domain_mismatch');
    });

    it('refuses an inactive, unknown or deleted college', async () => {
      expect(
        await errorCode(
          service.requestOtp(ME, { collegeId: CLOSED, email: 'a@closed.edu' }),
        ),
      ).toBe('invalid_college');
      expect(
        await errorCode(
          service.requestOtp(ME, { collegeId: 'nope', email: 'a@gla.ac.in' }),
        ),
      ).toBe('invalid_college');
    });

    it('refuses an address already verified by someone else, without sending', async () => {
      await verifyAs(OTHER, 'shared@gla.ac.in');
      sentCodes = [];
      expect(
        await errorCode(
          service.requestOtp(ME, { collegeId: GLA, email: 'SHARED@gla.ac.in' }),
        ),
      ).toBe('college_email_unavailable');
      expect(sentCodes).toHaveLength(0);
    });

    it('says already_affiliated for the address the user already holds', async () => {
      await verifyAs(ME, 'me@gla.ac.in');
      pastCooldown();
      expect(
        await errorCode(
          service.requestOtp(ME, { collegeId: GLA, email: 'me@gla.ac.in' }),
        ),
      ).toBe('already_affiliated');
    });
  });

  describe('verifying', () => {
    it('creates the affiliation, mirrors it onto the user and announces it', async () => {
      const { affiliation } = await verifyAs(
        ME,
        'sarthak.saini_cs25@gla.ac.in',
      );

      expect(affiliation).toMatchObject({
        collegeId: GLA,
        collegeName: 'GLA University',
        logoUrl: '/api/media/colleges/gla.png',
        method: 'CAMPUS_OTP',
        active: true,
      });
      expect(affiliation?.email).not.toContain('saini');
      expect(users.get(ME)).toMatchObject({
        collegeId: GLA,
        collegeEmail: 'sarthak.saini_cs25@gla.ac.in',
        batchYear: 2025,
      });
      expect(emit).toHaveBeenCalledWith(
        'user:campus_changed',
        expect.objectContaining({ userId: ME }),
        [ME],
      );
      await expect(access.requireAffiliation(ME)).resolves.toEqual({
        collegeId: GLA,
      });
    });

    it('refuses a wrong code and leaves nothing behind', async () => {
      await service.requestOtp(ME, { collegeId: GLA, email: 'me@gla.ac.in' });
      const wrong = lastCode() === '000000' ? '111111' : '000000';
      expect(await errorCode(service.verify(ME, wrong))).toBe('invalid_code');
      expect(affiliations.size).toBe(0);
      expect(users.get(ME)?.collegeId).toBeNull();
    });

    it('refuses an expired code', async () => {
      await service.requestOtp(ME, { collegeId: GLA, email: 'me@gla.ac.in' });
      otpStore.get(ME, UserOtpPurpose.COLLEGE_EMAIL)!.expiresAt = new Date(
        Date.now() - 1000,
      );
      expect(await errorCode(service.verify(ME, lastCode()))).toBe(
        'expired_code',
      );
      expect(affiliations.size).toBe(0);
    });

    it('refuses a replayed code', async () => {
      await verifyAs(ME, 'me@gla.ac.in');
      expect(await errorCode(service.verify(ME, lastCode()))).toBe(
        'invalid_code',
      );
    });

    it('stops after the attempt budget, even for the right code', async () => {
      await service.requestOtp(ME, { collegeId: GLA, email: 'me@gla.ac.in' });
      const right = lastCode();
      const wrong = right === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        await service.verify(ME, wrong).catch(() => undefined);
      }
      expect(await errorCode(service.verify(ME, right))).toBe(
        'too_many_attempts',
      );
      expect(affiliations.size).toBe(0);
    });

    it('applies the bound address, not anything the caller could change later', async () => {
      // A code sent for one address cannot be used after a second request for
      // another: the second issue rebinds and invalidates the first.
      await service.requestOtp(ME, {
        collegeId: GLA,
        email: 'first@gla.ac.in',
      });
      const firstCode = lastCode();
      pastCooldown();
      await service.requestOtp(ME, {
        collegeId: IIT,
        email: 'second@iit.ac.in',
      });
      expect(await errorCode(service.verify(ME, firstCode))).toBe(
        'invalid_code',
      );
      await service.verify(ME, lastCode());
      expect(affiliations.get(ME)).toMatchObject({
        collegeId: IIT,
        emailNormalized: 'second@iit.ac.in',
      });
    });

    it('rechecks uniqueness inside the transaction', async () => {
      await service.requestOtp(ME, { collegeId: GLA, email: 'race@gla.ac.in' });
      const myCode = lastCode();
      // Someone else verifies the same address after my code went out.
      await verifyAs(OTHER, 'race@gla.ac.in');
      expect(await errorCode(service.verify(ME, myCode))).toBe(
        'college_email_unavailable',
      );
      expect(affiliations.get(ME)).toBeUndefined();
    });

    it('turns a unique-index race (P2002) into the same generic 409', async () => {
      await service.requestOtp(ME, { collegeId: GLA, email: 'me@gla.ac.in' });
      raceOnNextUpsert = true;
      const err = await service.verify(ME, lastCode()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(409);
      expect(
        ((err as HttpException).getResponse() as { code: string }).code,
      ).toBe('college_email_unavailable');
      expect(users.get(ME)?.collegeId).toBeNull();
    });

    it('refuses if the domain was disabled after the code was sent', async () => {
      await service.requestOtp(ME, { collegeId: GLA, email: 'me@gla.ac.in' });
      domains[0].status = 'DISABLED';
      expect(await errorCode(service.verify(ME, lastCode()))).toBe(
        'domain_mismatch',
      );
    });
  });

  describe('changing and releasing', () => {
    it('verifying a new address replaces the old one in place and releases it', async () => {
      await verifyAs(ME, 'old@gla.ac.in');
      pastCooldown();
      await verifyAs(ME, 'new@gla.ac.in');

      expect(affiliations.size).toBe(1);
      expect(affiliations.get(ME)?.emailNormalized).toBe('new@gla.ac.in');
      // The old address is free for someone else now.
      await expect(verifyAs(OTHER, 'old@gla.ac.in')).resolves.toBeDefined();
    });

    it('clears the campus-rep flag when the college changes', async () => {
      await verifyAs(ME, 'me@gla.ac.in');
      users.get(ME)!.isCampusRep = true;
      pastCooldown();
      await verifyAs(ME, 'me@iit.ac.in', IIT);
      expect(users.get(ME)?.isCampusRep).toBe(false);
    });

    describe('batch year', () => {
      it('keeps a batch year the user set when re-verifying at the same college', async () => {
        await verifyAs(ME, 'sarthak.saini_cs25@gla.ac.in');
        // The user corrected the derived year in their profile.
        users.get(ME)!.batchYear = 2024;
        pastCooldown();
        await verifyAs(ME, 'sarthak.saini_cs23@gla.ac.in');
        expect(users.get(ME)?.batchYear).toBe(2024);
      });

      it('fills a missing batch year from a derivable address', async () => {
        await verifyAs(ME, 'me@gla.ac.in'); // not derivable
        expect(users.get(ME)?.batchYear).toBeNull();
        pastCooldown();
        await verifyAs(ME, 'sarthak.saini_cs25@gla.ac.in');
        expect(users.get(ME)?.batchYear).toBe(2025);
      });

      it('replaces the year when the college changes', async () => {
        await verifyAs(ME, 'sarthak.saini_cs25@gla.ac.in');
        pastCooldown();
        await verifyAs(ME, 'someone_cs24@iit.ac.in', IIT);
        expect(users.get(ME)?.batchYear).toBe(2024);
      });

      it('never erases a year with an underivable address', async () => {
        users.get(ME)!.batchYear = 2023;
        await verifyAs(ME, 'me@iit.ac.in', IIT);
        expect(users.get(ME)?.batchYear).toBe(2023);
      });
    });

    it('removal requires the password', async () => {
      await verifyAs(ME, 'me@gla.ac.in');
      expect(
        await errorCode(
          service.remove(stub<AuthenticatedUser>({ id: ME, email: 'x' }), {
            password: 'bad',
          }),
        ),
      ).toBe('invalid_password');
      expect(affiliations.has(ME)).toBe(true);
    });

    it('removal deletes the row, clears the mirror, ends access and frees the address', async () => {
      await verifyAs(ME, 'me@gla.ac.in');
      await expect(
        service.remove(
          stub<AuthenticatedUser>({ id: ME, email: 'stale@token' }),
          { password: 'right-password' },
        ),
      ).resolves.toEqual({ success: true });

      // Checked against the current sign-in address, not the token's.
      expect(verifyPassword).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'me@gmail.com' }),
        'right-password',
      );
      expect(affiliations.has(ME)).toBe(false);
      expect(users.get(ME)).toMatchObject({
        collegeId: null,
        collegeEmail: null,
      });
      expect(await errorCode(access.requireAffiliation(ME))).toBe(
        'campus_affiliation_required',
      );
      await expect(verifyAs(OTHER, 'me@gla.ac.in')).resolves.toBeDefined();
    });
  });

  describe('admin revocation', () => {
    it('ends access, clears the mirror and keeps the address reserved', async () => {
      await verifyAs(ME, 'me@gla.ac.in');
      const res = await service.revoke(ME, '  fake student  ');

      expect(res.collegeAffiliation).toMatchObject({
        revokedReason: 'fake student',
        email: 'me@gla.ac.in',
      });
      expect(users.get(ME)?.collegeId).toBeNull();
      expect(await access.hasAffiliation(ME)).toBe(false);
      expect(
        await errorCode(
          service.requestOtp(OTHER, { collegeId: GLA, email: 'me@gla.ac.in' }),
        ),
      ).toBe('college_email_unavailable');
    });

    it('cannot be undone by the user re-verifying or removing', async () => {
      await verifyAs(ME, 'me@gla.ac.in');
      await service.revoke(ME, 'reason');
      expect(
        await errorCode(
          service.requestOtp(ME, { collegeId: GLA, email: 'other@gla.ac.in' }),
        ),
      ).toBe('affiliation_revoked');
      expect(
        await errorCode(
          service.remove(stub<AuthenticatedUser>({ id: ME }), {
            password: 'right-password',
          }),
        ),
      ).toBe('affiliation_revoked');
    });
  });

  describe('campus access', () => {
    it('is refused when the affiliated college is closed later', async () => {
      await verifyAs(ME, 'me@gla.ac.in');
      colleges.get(GLA)!.status = 'DISABLED';
      expect(await access.getActiveCollegeId(ME)).toBeNull();
      expect((await service.getStatus(ME)).affiliation?.active).toBe(false);
    });

    it('reports a pending code with its college and a masked address', async () => {
      await service.requestOtp(ME, { collegeId: GLA, email: 'me@gla.ac.in' });
      const { affiliation, pending } = await service.getStatus(ME);
      expect(affiliation).toBeNull();
      expect(pending).toMatchObject({
        collegeId: GLA,
        collegeName: 'GLA University',
        emailMasked: 'm***@gla.ac.in',
      });
    });
  });
});
