import { LegalConsentService } from './legal-consent.service';

/**
 * The gate that decides whether a user may keep using Meetifyy.
 *
 * The behaviour worth pinning down is not "does it read the table" — it is the
 * caching, because every authenticated request in the product goes through it
 * and a cache that answers the WRONG question is how a mandatory update
 * silently stops being mandatory.
 */
describe('LegalConsentService', () => {
  const TERMS_V4 = {
    id: 'v-terms-4',
    documentType: 'TERMS_OF_SERVICE' as any,
    versionNumber: 4,
    title: 'Terms of Service',
    subtitle: null,
    content: '<p>Terms text.</p>',
    // The cache holds every published version and the gate filters it, so a
    // fixture has to say whether acceptance is mandatory.
    requiresAcknowledgement: true,
    changeSummary: 'Clarified the messaging rules.',
    effectiveAt: new Date('2026-09-01'),
    publishedAt: new Date('2026-09-01'),
  };
  const PRIVACY_V2 = {
    ...TERMS_V4,
    id: 'v-privacy-2',
    documentType: 'PRIVACY_POLICY' as any,
    versionNumber: 2,
  };

  let prisma: any;
  let service: LegalConsentService;
  /** What the database returns for `isCurrent: true` — required or not. */
  let required: any[];
  let acknowledgements: { userId: string; versionId: string }[];

  beforeEach(() => {
    required = [];
    acknowledgements = [];
    prisma = {
      legalDocumentVersion: {
        findMany: jest.fn(async () => required),
      },
      legalAcknowledgement: {
        findMany: jest.fn(async ({ where }: any) =>
          acknowledgements.filter(
            (a) =>
              a.userId === where.userId &&
              where.versionId.in.includes(a.versionId),
          ),
        ),
        count: jest.fn(
          async ({ where }: any) =>
            acknowledgements.filter(
              (a) =>
                a.userId === where.userId &&
                where.versionId.in.includes(a.versionId),
            ).length,
        ),
      },
    };
    service = new LegalConsentService(prisma);
  });

  describe('when nothing requires acknowledgement', () => {
    it('lets everyone through', async () => {
      await expect(service.isSatisfied('u1')).resolves.toBe(true);
    });

    it('costs no per-user query at all', async () => {
      await service.isSatisfied('u1');
      expect(prisma.legalAcknowledgement.count).not.toHaveBeenCalled();
    });
  });

  describe('when a version requires acknowledgement', () => {
    beforeEach(() => {
      required = [TERMS_V4];
    });

    it('refuses a user who has not accepted it', async () => {
      await expect(service.isSatisfied('u1')).resolves.toBe(false);
    });

    it('allows a user who has', async () => {
      acknowledgements.push({ userId: 'u1', versionId: TERMS_V4.id });
      await expect(service.isSatisfied('u1')).resolves.toBe(true);
    });

    it('lists exactly what is outstanding', async () => {
      const pending = await service.getPendingVersions('u1');
      expect(pending.map((v) => v.id)).toEqual([TERMS_V4.id]);
    });

    /**
     * The failure this prevents: caching a "no" would keep refusing the user
     * for the rest of the TTL after they accepted, bouncing them back into the
     * modal they just completed.
     */
    it('never caches a refusal', async () => {
      await service.isSatisfied('u1');
      acknowledgements.push({ userId: 'u1', versionId: TERMS_V4.id });
      await expect(service.isSatisfied('u1')).resolves.toBe(true);
    });

    it('serves a repeat check for the same user from cache', async () => {
      acknowledgements.push({ userId: 'u1', versionId: TERMS_V4.id });
      await service.isSatisfied('u1');
      await service.isSatisfied('u1');
      expect(prisma.legalAcknowledgement.count).toHaveBeenCalledTimes(1);
    });
  });

  describe('when a SECOND document starts requiring acknowledgement', () => {
    /**
     * The core reason the cache stores a signature of the required ids rather
     * than a bare boolean. A user who satisfied yesterday's list must not be
     * treated as satisfying today's longer one.
     */
    it('re-checks a user who was previously satisfied', async () => {
      required = [TERMS_V4];
      acknowledgements.push({ userId: 'u1', versionId: TERMS_V4.id });
      await expect(service.isSatisfied('u1')).resolves.toBe(true);

      required = [TERMS_V4, PRIVACY_V2];
      service.invalidatePublished();

      await expect(service.isSatisfied('u1')).resolves.toBe(false);
    });

    it('is satisfied only once every required document is accepted', async () => {
      required = [TERMS_V4, PRIVACY_V2];
      acknowledgements.push({ userId: 'u1', versionId: TERMS_V4.id });
      await expect(service.isSatisfied('u1')).resolves.toBe(false);

      acknowledgements.push({ userId: 'u1', versionId: PRIVACY_V2.id });
      await expect(service.isSatisfied('u1')).resolves.toBe(true);
    });

    it('returns both as pending in one list, so one modal can cover them', async () => {
      required = [TERMS_V4, PRIVACY_V2];
      const pending = await service.getPendingVersions('u1');
      expect(pending).toHaveLength(2);
    });
  });

  describe('when the database is unavailable', () => {
    /**
     * Fails OPEN, matching `resolveAccountStatus` in JwtGuard. This gate is a
     * restriction; a broken restriction must not be an outage that locks the
     * entire user base out of the product.
     */
    it('does not lock everyone out', async () => {
      required = [TERMS_V4];
      await service.getRequiredVersions();
      service.invalidatePublished();
      prisma.legalDocumentVersion.findMany.mockRejectedValue(
        new Error('connection reset'),
      );
      await expect(service.isSatisfied('u1')).resolves.toBe(true);
    });

    it('does not refuse a user because the acknowledgement lookup broke', async () => {
      required = [TERMS_V4];
      prisma.legalAcknowledgement.count.mockRejectedValue(
        new Error('connection reset'),
      );
      await expect(service.isSatisfied('u1')).resolves.toBe(true);
    });
  });

  it('lets the next request through immediately after an acknowledgement', async () => {
    required = [TERMS_V4];
    await service.isSatisfied('u1');
    service.markSatisfied('u1', [TERMS_V4.id]);
    prisma.legalAcknowledgement.count.mockClear();

    await expect(service.isSatisfied('u1')).resolves.toBe(true);
    expect(prisma.legalAcknowledgement.count).not.toHaveBeenCalled();
  });

  describe('signup consent', () => {
    /**
     * The signup form will not proceed until the user agrees to the Terms and
     * the Privacy Policy, so the account exists BECAUSE that agreement was
     * given. Before this, that left no trace at all: the versions in force at
     * signup usually do not require acknowledgement, so the user was never
     * asked again and nothing recorded what they had accepted.
     */
    beforeEach(() => {
      prisma.legalAcknowledgement.createMany = jest.fn(
        async ({ data }: any) => {
          for (const row of data) {
            const clash = acknowledgements.some(
              (a) => a.userId === row.userId && a.versionId === row.versionId,
            );
            if (!clash) acknowledgements.push(row);
          }
          return { count: data.length };
        },
      );
    });

    it('records the Terms and Privacy versions in force at signup', async () => {
      required = [TERMS_V4, PRIVACY_V2];
      await service.recordSignupConsent('new-user');
      expect(acknowledgements).toHaveLength(2);
      expect(acknowledgements.map((a: any) => a.versionNumber).sort()).toEqual([
        2, 4,
      ]);
    });

    it('records them even though neither requires acknowledgement', async () => {
      // `recordSignupConsent` reads `isCurrent`, not `requiresAcknowledgement`
      // — the point is the record, not the gate.
      required = [TERMS_V4];
      await service.recordSignupConsent('new-user');
      expect(acknowledgements).toHaveLength(1);
    });

    it('is idempotent, so a repeated sync adds nothing', async () => {
      required = [TERMS_V4];
      await service.recordSignupConsent('new-user');
      await service.recordSignupConsent('new-user');
      expect(acknowledgements).toHaveLength(1);
    });

    /**
     * A consent row that cannot be written must never be the reason an account
     * creation fails. The gate re-asks anyone whose record is missing the moment
     * a version requires it.
     */
    it('never throws into the account-creation path', async () => {
      required = [TERMS_V4];
      prisma.legalAcknowledgement.createMany = jest.fn(async () => {
        throw new Error('connection reset');
      });
      await expect(
        service.recordSignupConsent('new-user'),
      ).resolves.toBeUndefined();
    });

    it('does nothing when no document has been published', async () => {
      required = [];
      await service.recordSignupConsent('new-user');
      expect(acknowledgements).toHaveLength(0);
    });
  });

  describe('caching the published documents', () => {
    /**
     * The reason this cache exists: against Supabase, reading a legal document
     * measured ~80ms of cross-region round trip and roughly nothing else. These
     * four documents are identical for every reader and change only when an
     * admin publishes, so paying that per request was the entire cost of
     * serving a legal page.
     */
    beforeEach(() => {
      required = [TERMS_V4, PRIVACY_V2];
    });

    it('reads the database once and serves everyone else from memory', async () => {
      await service.getPublishedVersions();
      await service.getPublishedVersions();
      await service.getPublishedVersion('TERMS_OF_SERVICE');
      await service.getRequiredVersions();
      expect(prisma.legalDocumentVersion.findMany).toHaveBeenCalledTimes(1);
    });

    it('collapses a concurrent stampede on a cold cache into one query', async () => {
      await Promise.all([
        service.getPublishedVersions(),
        service.getPublishedVersions(),
        service.getPublishedVersions(),
      ]);
      expect(prisma.legalDocumentVersion.findMany).toHaveBeenCalledTimes(1);
    });

    it('re-reads after a publish invalidates it', async () => {
      await service.getPublishedVersions();
      service.invalidatePublished();
      await service.getPublishedVersions();
      expect(prisma.legalDocumentVersion.findMany).toHaveBeenCalledTimes(2);
    });

    /**
     * The gate is a filter over the same cached list rather than its own query,
     * so a publish cannot leave the two disagreeing about which version is live.
     */
    it('derives the required list from the same cache', async () => {
      required = [{ ...TERMS_V4, requiresAcknowledgement: false }, PRIVACY_V2];
      const all = await service.getPublishedVersions();
      const gated = await service.getRequiredVersions();
      expect(all).toHaveLength(2);
      expect(gated.map((v) => v.documentType)).toEqual(['PRIVACY_POLICY']);
      expect(prisma.legalDocumentVersion.findMany).toHaveBeenCalledTimes(1);
    });

    it('serves the body, so a reader needs no second query for the text', async () => {
      const terms = await service.getPublishedVersion('TERMS_OF_SERVICE');
      expect(terms?.content).toBe('<p>Terms text.</p>');
    });
  });
});
