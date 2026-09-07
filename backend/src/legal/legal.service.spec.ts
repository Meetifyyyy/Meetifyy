import { LegalService } from './legal.service';
import { LegalConsentService } from '../common/legal/legal-consent.service';

/**
 * Recording consent.
 *
 * The single property that matters: a user who accepted Terms v3 must still
 * read as having accepted v3 after v4 ships. Nothing here may ever update an
 * existing row, and nothing the client sends may decide what gets recorded.
 */
describe('LegalService — acknowledgement', () => {
  const TERMS_V4 = {
    id: 'v-terms-4',
    documentType: 'TERMS_OF_SERVICE',
    versionNumber: 4,
    title: 'Terms of Service',
    subtitle: null,
    content: '<p>Terms text.</p>',
    requiresAcknowledgement: true,
    changeSummary: 'Clarified messaging rules.',
    effectiveAt: new Date('2026-09-01'),
    publishedAt: new Date('2026-09-01'),
  };
  const PRIVACY_V2 = {
    ...TERMS_V4,
    id: 'v-privacy-2',
    documentType: 'PRIVACY_POLICY',
    versionNumber: 2,
  };

  let prisma: any;
  let consent: LegalConsentService;
  let service: LegalService;
  let required: any[];
  let acks: any[];

  beforeEach(() => {
    required = [TERMS_V4];
    acks = [];
    prisma = {
      legalDocumentVersion: {
        findMany: jest.fn(async ({ where }: any) => {
          if (where?.id?.in) {
            return required.filter((v) => where.id.in.includes(v.id));
          }
          return required;
        }),
        findFirst: jest.fn(async () => required[0] ?? null),
      },
      legalAcknowledgement: {
        findMany: jest.fn(async ({ where }: any) =>
          acks.filter(
            (a) =>
              a.userId === where.userId &&
              where.versionId.in.includes(a.versionId),
          ),
        ),
        count: jest.fn(
          async ({ where }: any) =>
            acks.filter(
              (a) =>
                a.userId === where.userId &&
                where.versionId.in.includes(a.versionId),
            ).length,
        ),
        // Mirrors `skipDuplicates` on the (userId, versionId) unique index.
        createMany: jest.fn(async ({ data }: any) => {
          let created = 0;
          for (const row of data) {
            const clash = acks.some(
              (a) => a.userId === row.userId && a.versionId === row.versionId,
            );
            if (!clash) {
              acks.push({ ...row, acknowledgedAt: new Date() });
              created += 1;
            }
          }
          return { count: created };
        }),
      },
    };
    consent = new LegalConsentService(prisma);
    service = new LegalService(prisma, consent);
  });

  it('records the exact version accepted', async () => {
    await service.acknowledge('u1', [TERMS_V4.id]);
    expect(acks).toEqual([
      expect.objectContaining({
        userId: 'u1',
        documentType: 'TERMS_OF_SERVICE',
        versionId: 'v-terms-4',
        versionNumber: 4,
      }),
    ]);
  });

  it('clears the gate once everything required is accepted', async () => {
    const res = await service.acknowledge('u1', [TERMS_V4.id]);
    expect(res.satisfied).toBe(true);
    await expect(consent.isSatisfied('u1')).resolves.toBe(true);
  });

  it('stores the consent metadata alongside the record', async () => {
    await service.acknowledge('u1', [TERMS_V4.id], {
      ip: '203.0.113.9',
      userAgent: 'Mozilla/5.0',
    });
    expect(acks[0]).toMatchObject({
      ip: '203.0.113.9',
      userAgent: 'Mozilla/5.0',
    });
  });

  it('truncates an oversized user agent rather than failing the acceptance', async () => {
    await service.acknowledge('u1', [TERMS_V4.id], {
      userAgent: 'x'.repeat(1000),
    });
    expect(acks[0].userAgent).toHaveLength(300);
  });

  describe('what the client sends is not trusted', () => {
    it('ignores a version that is not currently required', async () => {
      const res = await service.acknowledge('u1', ['v-terms-3']);
      expect(acks).toHaveLength(0);
      expect(res.satisfied).toBe(false);
    });

    it('records only the required subset of a mixed list', async () => {
      const res = await service.acknowledge('u1', [TERMS_V4.id, 'v-forged']);
      expect(acks.map((a) => a.versionId)).toEqual([TERMS_V4.id]);
      expect(res.satisfied).toBe(true);
    });
  });

  describe('two documents required at once', () => {
    beforeEach(() => {
      required = [TERMS_V4, PRIVACY_V2];
    });

    it('stays gated until BOTH are accepted', async () => {
      const first = await service.acknowledge('u1', [TERMS_V4.id]);
      expect(first.satisfied).toBe(false);

      const second = await service.acknowledge('u1', [PRIVACY_V2.id]);
      expect(second.satisfied).toBe(true);
    });

    it('accepts both in one call, so one modal can cover them', async () => {
      const res = await service.acknowledge('u1', [TERMS_V4.id, PRIVACY_V2.id]);
      expect(res.satisfied).toBe(true);
      expect(acks).toHaveLength(2);
    });

    it('offers both as pending in a single response', async () => {
      const state = await service.getConsentState('u1');
      expect(state.satisfied).toBe(false);
      expect(state.pending).toHaveLength(2);
    });
  });

  describe('idempotence', () => {
    /**
     * Covers the double-clicked button, the retry after a network failure, and
     * two tabs accepting at the same moment. All three must converge on one
     * row and all three must report success.
     */
    it('is safe to submit twice', async () => {
      await service.acknowledge('u1', [TERMS_V4.id]);
      const second = await service.acknowledge('u1', [TERMS_V4.id]);
      expect(acks).toHaveLength(1);
      expect(second.satisfied).toBe(true);
    });
  });

  describe('after a newer version is published', () => {
    /**
     * The requirement that gives the whole feature its point: the v3 record is
     * still a v3 record, and the user is correctly detected as needing v4.
     */
    it('keeps the older record intact and gates on the new one', async () => {
      const TERMS_V3 = { ...TERMS_V4, id: 'v-terms-3', versionNumber: 3 };
      required = [TERMS_V3];
      await service.acknowledge('u1', [TERMS_V3.id]);
      expect(acks[0].versionNumber).toBe(3);

      required = [TERMS_V4];
      consent.invalidatePublished();

      await expect(consent.isSatisfied('u1')).resolves.toBe(false);
      expect(acks).toHaveLength(1);
      expect(acks[0].versionNumber).toBe(3);
    });
  });

  it('reports a clear state when nothing is required', async () => {
    required = [];
    consent.invalidatePublished();
    await expect(service.getConsentState('u1')).resolves.toEqual({
      satisfied: true,
      pending: [],
    });
  });
});
