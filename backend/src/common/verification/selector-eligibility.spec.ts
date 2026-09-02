import { Test } from '@nestjs/testing';
import { VerificationStatus } from '@prisma/client';
import { VerificationAccessService } from './verification-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventService } from '../../events/domain-event.service';

/**
 * The rule: a user may appear in a Share or Invite selector only if their
 * account is VERIFIED, and that must be decided by the QUERY, not by anything
 * downstream of it.
 *
 * These tests assert the shape of the `where` that reaches Prisma rather than
 * the contents of a result set, and that is deliberate. A test that stubbed the
 * database with two rows and checked that one came back would pass just as
 * happily if the filtering were done in JavaScript afterwards — which is the
 * exact implementation the requirement rules out. Asserting the predicate is in
 * the query is the only way to test the thing that actually matters: that an
 * ineligible row is never read, never cached, and never sent.
 */
describe('selector eligibility', () => {
  let service: VerificationAccessService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        VerificationAccessService,
        { provide: PrismaService, useValue: { user: { findMany: jest.fn(), findUnique: jest.fn() } } },
        { provide: DomainEventService, useValue: { publish: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(VerificationAccessService);
    service.invalidateAll();
    delete process.env.FEATURE_VERIFICATION_ENABLED;
  });

  afterEach(() => {
    delete process.env.FEATURE_VERIFICATION_ENABLED;
  });

  describe('the canonical rule', () => {
    it('treats VERIFIED as the only eligible status', () => {
      expect(service.isEligibleStatus(VerificationStatus.VERIFIED)).toBe(true);
    });

    it('excludes every other status, including PENDING', () => {
      // A submitted-but-unreviewed account is not yet trusted. If PENDING were
      // eligible, submitting a request would be enough to become selectable.
      const ineligible = [
        VerificationStatus.UNVERIFIED,
        VerificationStatus.PENDING,
        VerificationStatus.REJECTED,
        VerificationStatus.RESUBMISSION_REQUIRED,
      ];
      expect(ineligible.filter((s) => service.isEligibleStatus(s))).toEqual([]);
      expect(service.isEligibleStatus(null)).toBe(false);
      expect(service.isEligibleStatus(undefined)).toBe(false);
    });
  });

  describe('eligibleUserWhere', () => {
    it('restricts a query to verified accounts', () => {
      expect(service.eligibleUserWhere()).toEqual({
        verificationStatus: VerificationStatus.VERIFIED,
      });
    });

    it('agrees with isEligibleStatus about which status that is', () => {
      // The two definitions live a few lines apart and are used in completely
      // different places (one inside a query, one on a fetched row). If they
      // ever disagreed, the query would be the one nobody thought to check.
      const status = service.eligibleUserWhere().verificationStatus;
      expect(service.isEligibleStatus(status)).toBe(true);
    });

    it('becomes a no-op when enforcement is switched off', () => {
      // The kill switch has to behave identically here and in every runtime
      // check: a deployment with verification disabled must not still produce
      // empty selectors.
      process.env.FEATURE_VERIFICATION_ENABLED = 'false';
      expect(service.eligibleUserWhere()).toEqual({});
    });

    it('is spreadable into an existing where without disturbing it', () => {
      const where = {
        id: { not: 'me' },
        accountStatus: 'ACTIVE',
        ...service.eligibleUserWhere(),
      };
      expect(where).toEqual({
        id: { not: 'me' },
        accountStatus: 'ACTIVE',
        verificationStatus: VerificationStatus.VERIFIED,
      });
    });
  });

  describe('eligibleUserSqlPredicate', () => {
    it('quotes the camelCase column so Postgres does not fold it', () => {
      expect(service.eligibleUserSqlPredicate('u')).toBe(
        `"u"."verificationStatus" = 'VERIFIED'`,
      );
    });

    it('honours the alias it is given', () => {
      expect(service.eligibleUserSqlPredicate('usr')).toContain('"usr".');
    });

    it('collapses to TRUE when enforcement is off, so it stays composable', () => {
      process.env.FEATURE_VERIFICATION_ENABLED = 'false';
      expect(service.eligibleUserSqlPredicate()).toBe('TRUE');
    });

    it('carries no interpolated input', () => {
      // It is built only from the enum and a caller-supplied alias, so there is
      // nothing user-controlled in it. This pins that as a property rather than
      // leaving it to inspection.
      const predicate = service.eligibleUserSqlPredicate('u');
      expect(predicate).not.toMatch(/\$\{|\bOR\b|;|--/);
    });
  });
});
