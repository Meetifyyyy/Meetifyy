import { LegalService } from './legal.service';
import { LegalConsentService } from '../common/legal/legal-consent.service';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';

/** An acknowledgement row as the fake stores it. */
type AckRow = {
  userId: string;
  versionId: string;
  versionNumber?: number;
  documentType?: string;
  userAgent?: string;
  acknowledgedAt?: Date;
};

/** The per-user acknowledgement lookup. */
type AckQuery = { where: { userId: string; versionId: { in: string[] } } };

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

  let consent: LegalConsentService;
  let service: LegalService;
  let required: (typeof TERMS_V4)[];
  let acks: AckRow[];

  beforeEach(() => {
    required = [TERMS_V4];
    acks = [];
    const prisma = stub<PrismaService>({
      legalDocumentVersion: {
        findMany: jest.fn(
          ({ where }: { where?: { id?: { in?: string[] } } }) => {
            const ids = where?.id?.in;
            if (ids) {
              return Promise.resolve(
                required.filter((v) => ids.includes(v.id)),
              );
            }
            return Promise.resolve(required);
          },
        ),
        findFirst: jest.fn(() => Promise.resolve(required[0] ?? null)),
      },
      legalAcknowledgement: {
        findMany: jest.fn(({ where }: AckQuery) =>
          Promise.resolve(
            acks.filter(
              (a) =>
                a.userId === where.userId &&
                where.versionId.in.includes(a.versionId),
            ),
          ),
        ),
        count: jest.fn(({ where }: AckQuery) =>
          Promise.resolve(
            acks.filter(
              (a) =>
                a.userId === where.userId &&
                where.versionId.in.includes(a.versionId),
            ).length,
          ),
        ),
        // Mirrors `skipDuplicates` on the (userId, versionId) unique index.
        createMany: jest.fn(({ data }: { data: AckRow[] }) => {
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
          return Promise.resolve({ count: created });
        }),
      },
    });
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

/**
 * The public "Previous versions" list and a single past version. The query
 * itself must exclude drafts — an unpublished draft reaching a public page is
 * the one failure here that matters.
 */
describe('LegalService — public version history', () => {
  type HistoryWhere = {
    documentType: string;
    versionNumber?: number;
    status?: { not?: string };
  };
  const row = (versionNumber: number, status: string, isCurrent = false) => ({
    id: `v-${versionNumber}`,
    documentType: 'TERMS_OF_SERVICE',
    versionNumber,
    title: 'Terms of Service',
    subtitle: null,
    content: `<p>Text ${versionNumber}.</p>`,
    status,
    isCurrent,
    effectiveAt: new Date('2026-09-01'),
    publishedAt: status === 'DRAFT' ? null : new Date('2026-09-01'),
    changeSummary: `Change ${versionNumber}`,
  });

  let rows: ReturnType<typeof row>[];
  let findMany: jest.Mock;
  let findFirst: jest.Mock;
  let consent: ReturnType<typeof makeConsent>;
  let service: LegalService;

  const filter = (where: HistoryWhere) =>
    rows.filter(
      (r) =>
        r.documentType === where.documentType &&
        (where.versionNumber === undefined ||
          r.versionNumber === where.versionNumber) &&
        (where.status?.not === undefined || r.status !== where.status.not),
    );

  const makeConsent = () => {
    let generation = 0;
    return {
      publishedCacheGeneration: jest.fn(() => generation),
      bump: () => {
        generation += 1;
      },
    };
  };

  beforeEach(() => {
    rows = [row(1, 'ARCHIVED'), row(2, 'PUBLISHED', true), row(3, 'DRAFT')];
    findMany = jest.fn(({ where }: { where: HistoryWhere }) =>
      Promise.resolve(
        [...filter(where)].sort((a, b) => b.versionNumber - a.versionNumber),
      ),
    );
    findFirst = jest.fn(({ where }: { where: HistoryWhere }) =>
      Promise.resolve(filter(where)[0] ?? null),
    );
    consent = makeConsent();
    service = new LegalService(
      stub<PrismaService>({ legalDocumentVersion: { findMany, findFirst } }),
      stub<LegalConsentService>({
        publishedCacheGeneration: consent.publishedCacheGeneration,
      }),
    );
  });

  it('lists published and archived versions newest first, never drafts', async () => {
    const list = await service.listVersions('TERMS_OF_SERVICE');
    expect(list.map((v) => [v.versionNumber, v.isCurrent])).toEqual([
      [2, true],
      [1, false],
    ]);
    const [args] = findMany.mock.calls[0] as [{ where: HistoryWhere }];
    expect(args.where.status).toEqual({ not: 'DRAFT' });
    expect(list[0]).not.toHaveProperty('content');
  });

  it('serves one archived version in full', async () => {
    const v = await service.getVersion('TERMS_OF_SERVICE', 1);
    expect(v).toMatchObject({ versionNumber: 1, content: '<p>Text 1.</p>' });
  });

  it('404s for a draft, as for a version that does not exist', async () => {
    await expect(service.getVersion('TERMS_OF_SERVICE', 3)).rejects.toThrow(
      'That version does not exist.',
    );
    await expect(service.getVersion('TERMS_OF_SERVICE', 99)).rejects.toThrow(
      'That version does not exist.',
    );
  });

  it('caches the list, and drops it when a publish bumps the generation', async () => {
    await service.listVersions('TERMS_OF_SERVICE');
    await service.listVersions('TERMS_OF_SERVICE');
    expect(findMany).toHaveBeenCalledTimes(1);
    consent.bump();
    await service.listVersions('TERMS_OF_SERVICE');
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
