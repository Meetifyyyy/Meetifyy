import { ConflictException, NotFoundException } from '@nestjs/common';

/**
 * `sanitize-html` pulls in an ESM sub-dependency ts-jest cannot parse, so the
 * repository's convention is to mock it rather than reconfigure Jest (see
 * `common/utils/sanitize-html.util.spec.ts`). Here we mock our own wrapper
 * instead of the library: the sanitizer's configuration is already covered by
 * its own spec, and what this file is about is the publish workflow. The stub
 * strips exactly the two tags the assertions below rely on.
 */
jest.mock('../../common/utils/sanitize-html.util', () => ({
  sanitizeArticleHtml: (html: string) =>
    (html ?? '').replace(
      /<(script|iframe)\b[^>]*>[\s\S]*?<\/\1>|<(script|iframe)\b[^>]*\/?>/gi,
      '',
    ),
  htmlToPlainText: (html: string) =>
    (html ?? '').replace(/<[^>]*>/g, '').trim(),
}));

import { AdminLegalService } from './admin-legal.service';

/**
 * The draft → publish → rollback workflow.
 *
 * The property every test here defends is the same one: a published version is
 * never rewritten. `LegalAcknowledgement.versionId` is the record of what a
 * user was actually shown, so the moment a published row can change, every
 * consent record in the system becomes a claim about text that may no longer
 * exist.
 */
describe('AdminLegalService', () => {
  const TYPE = 'TERMS_OF_SERVICE' as any;
  const ADMIN = 'admin-1';

  let rows: any[];
  let prisma: any;
  let consent: any;
  let service: AdminLegalService;

  const version = (over: any = {}) => ({
    id: `v-${over.versionNumber ?? 1}`,
    documentType: TYPE,
    versionNumber: 1,
    title: 'Terms of Service',
    subtitle: null,
    content: '<p>Original text.</p>',
    status: 'PUBLISHED',
    isCurrent: false,
    requiresAcknowledgement: false,
    changeSummary: null,
    effectiveAt: null,
    createdById: null,
    createdAt: new Date('2026-08-27'),
    updatedAt: new Date('2026-08-27'),
    publishedById: null,
    publishedAt: new Date('2026-08-27'),
    restoredFromVersionId: null,
    ...over,
  });

  /** A Prisma double backed by `rows`, so ordering and filtering are real. */
  const buildPrisma = () => {
    const matches = (row: any, where: any = {}): boolean => {
      for (const [key, value] of Object.entries(where)) {
        if (key === 'OR') {
          if (!(value as any[]).some((clause) => matches(row, clause)))
            return false;
          continue;
        }
        if (key === 'status' && value && typeof value === 'object') {
          if (row.status === (value as any).not) return false;
          continue;
        }
        if (key === 'documentType_versionNumber') {
          const v = value as any;
          if (
            row.documentType !== v.documentType ||
            row.versionNumber !== v.versionNumber
          )
            return false;
          continue;
        }
        if (row[key] !== value) return false;
      }
      return true;
    };

    const client = {
      $executeRaw: jest.fn(async () => 1),
      legalDocumentVersion: {
        findFirst: jest.fn(async ({ where, orderBy }: any = {}) => {
          let found = rows.filter((r) => matches(r, where));
          if (orderBy?.versionNumber === 'desc') {
            found = [...found].sort(
              (a, b) => b.versionNumber - a.versionNumber,
            );
          }
          return found[0] ?? null;
        }),
        findMany: jest.fn(async ({ where, orderBy }: any = {}) => {
          let found = rows.filter((r) => matches(r, where));
          if (orderBy?.versionNumber === 'desc') {
            found = [...found].sort(
              (a, b) => b.versionNumber - a.versionNumber,
            );
          }
          return found.map((r) => ({ ...r, _count: { acknowledgements: 0 } }));
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.id) return rows.find((r) => r.id === where.id) ?? null;
          return rows.find((r) => matches(r, where)) ?? null;
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = version({ ...data, id: `v-${data.versionNumber}` });
          rows.push(row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = rows.find((r) => r.id === where.id);
          Object.assign(row, data);
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const found = rows.filter((r) => matches(r, where));
          found.forEach((r) => Object.assign(r, data));
          return { count: found.length };
        }),
        delete: jest.fn(async ({ where }: any) => {
          const i = rows.findIndex((r) => r.id === where.id);
          return rows.splice(i, 1)[0];
        }),
        groupBy: jest.fn(async () => []),
      },
      legalAcknowledgement: { count: jest.fn(async () => 0) },
      user: { count: jest.fn(async () => 100) },
    };
    return {
      ...client,
      $transaction: jest.fn(async (fn: any) => fn(client)),
    };
  };

  beforeEach(() => {
    rows = [version({ versionNumber: 1, isCurrent: true })];
    prisma = buildPrisma();
    consent = {
      invalidatePublished: jest.fn(),
    };
    service = new AdminLegalService(prisma, consent);
  });

  const publish = (over: any = {}) =>
    service.publishDraft(TYPE, ADMIN, {
      changeSummary: 'Rewrote the messaging section.',
      ...over,
    });

  describe('drafting', () => {
    it('seeds a new draft from the published text, not a blank page', async () => {
      const draft = await service.startDraft(TYPE, ADMIN);
      expect(draft.status).toBe('DRAFT');
      expect(rows.find((r) => r.id === draft.id).content).toBe(
        '<p>Original text.</p>',
      );
    });

    it('reserves the next version number for the draft', async () => {
      const draft = await service.startDraft(TYPE, ADMIN);
      expect(draft.versionNumber).toBe(2);
    });

    it('returns the existing draft rather than resetting it', async () => {
      await service.saveDraft(TYPE, ADMIN, {
        title: 'Terms of Service',
        content: '<p>Work in progress.</p>',
      });
      const again = await service.startDraft(TYPE, ADMIN);
      expect(rows.find((r) => r.id === again.id).content).toBe(
        '<p>Work in progress.</p>',
      );
    });

    it('strips markup the sanitizer refuses, on save', async () => {
      const draft = await service.saveDraft(TYPE, ADMIN, {
        title: 'Terms of Service',
        content: '<p>Safe.</p><script>alert(1)</script>',
      });
      expect(rows.find((r) => r.id === draft.id).content).toBe('<p>Safe.</p>');
    });

    it('refuses a body that is empty once formatting is removed', async () => {
      await expect(
        service.saveDraft(TYPE, ADMIN, {
          title: 'Terms of Service',
          content: '<script>alert(1)</script>',
        }),
      ).rejects.toThrow(/empty/i);
    });

    it('leaves the published version untouched while a draft exists', async () => {
      await service.saveDraft(TYPE, ADMIN, {
        title: 'New title',
        content: '<p>New text.</p>',
      });
      const live = rows.find((r) => r.isCurrent);
      expect(live.versionNumber).toBe(1);
      expect(live.content).toBe('<p>Original text.</p>');
    });
  });

  describe('publishing', () => {
    beforeEach(async () => {
      await service.saveDraft(TYPE, ADMIN, {
        title: 'Terms of Service',
        content: '<p>Updated text.</p>',
      });
    });

    it('makes the draft the live version', async () => {
      const published = await publish();
      expect(published.status).toBe('PUBLISHED');
      expect(published.isCurrent).toBe(true);
      expect(published.versionNumber).toBe(2);
    });

    it('archives the previous version instead of deleting it', async () => {
      await publish();
      const previous = rows.find((r) => r.versionNumber === 1);
      expect(previous).toBeDefined();
      expect(previous.status).toBe('ARCHIVED');
      expect(previous.isCurrent).toBe(false);
      expect(previous.content).toBe('<p>Original text.</p>');
    });

    it('leaves exactly one live version', async () => {
      await publish();
      expect(rows.filter((r) => r.isCurrent)).toHaveLength(1);
    });

    it('records who published it and why', async () => {
      const published = await publish({
        changeSummary: 'Added a data clause.',
      });
      // `publishedById` is not in the select (the API returns the joined admin
      // instead), so the stored row is what proves attribution.
      expect(rows.find((r) => r.id === published.id).publishedById).toBe(ADMIN);
      expect(published.publishedAt).toBeInstanceOf(Date);
      expect(published.changeSummary).toBe('Added a data clause.');
    });

    it('carries the mandatory-acknowledgement switch onto the version', async () => {
      const published = await publish({ requiresAcknowledgement: true });
      expect(published.requiresAcknowledgement).toBe(true);
    });

    it('does not make acceptance mandatory unless asked', async () => {
      const published = await publish();
      expect(published.requiresAcknowledgement).toBe(false);
    });

    /**
     * The gate caches the requirement list. Publishing without dropping that
     * cache would leave a mandatory update inert for the TTL — including for
     * the admin who just published it and immediately went to check.
     */
    it('drops the published-document cache so the change applies at once', async () => {
      await publish({ requiresAcknowledgement: true });
      expect(consent.invalidatePublished).toHaveBeenCalled();
    });

    it('refuses when there is no draft', async () => {
      await publish();
      await expect(publish()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('serialises concurrent publishes on the document', async () => {
      await publish();
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });
  });

  describe('rolling back', () => {
    beforeEach(async () => {
      await service.saveDraft(TYPE, ADMIN, {
        title: 'Terms of Service',
        content: '<p>Updated text.</p>',
      });
      await publish();
    });

    const rollback = (over: any = {}) =>
      service.rollback(TYPE, ADMIN, {
        targetVersionNumber: 1,
        changeSummary: 'Reverting the messaging change.',
        ...over,
      });

    /**
     * The whole reason rollback is an insert. Flipping v1 back to current would
     * make "the version I accepted" ambiguous for everyone who accepted v2, and
     * would leave the history claiming one row was published twice.
     */
    it('publishes a NEW version rather than resurrecting the old row', async () => {
      const restored = await rollback();
      expect(restored.versionNumber).toBe(3);
      expect(restored.isCurrent).toBe(true);
      expect(rows.find((r) => r.versionNumber === 1).isCurrent).toBe(false);
    });

    it('carries the old text forward verbatim', async () => {
      const restored = await rollback();
      expect(rows.find((r) => r.id === restored.id).content).toBe(
        '<p>Original text.</p>',
      );
    });

    it('records which version it restored', async () => {
      const restored = await rollback();
      expect(restored.restoredFromVersionId).toBe('v-1');
    });

    it('destroys no history', async () => {
      await rollback();
      expect(rows.map((r) => r.versionNumber).sort()).toEqual([1, 2, 3]);
      expect(rows.find((r) => r.versionNumber === 2).content).toBe(
        '<p>Updated text.</p>',
      );
    });

    it('refuses to roll back to the version already live', async () => {
      await expect(rollback({ targetVersionNumber: 2 })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses a version that does not exist', async () => {
      await expect(
        rollback({ targetVersionNumber: 99 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('history', () => {
    it('excludes the draft — an unpublished draft is not history', async () => {
      await service.saveDraft(TYPE, ADMIN, {
        title: 'Terms of Service',
        content: '<p>Not published yet.</p>',
      });
      const doc = await service.getDocument(TYPE);
      expect(doc.draft).not.toBeNull();
      expect(doc.history.every((v: any) => v.status !== 'DRAFT')).toBe(true);
    });

    it('shows the published version and the draft side by side', async () => {
      await service.saveDraft(TYPE, ADMIN, {
        title: 'Terms of Service',
        content: '<p>Proposed text.</p>',
      });
      const { draft, published } = await service.compare(TYPE);
      expect(published?.content).toBe('<p>Original text.</p>');
      expect(draft.content).toBe('<p>Proposed text.</p>');
    });

    it('refuses to compare when there is no draft', async () => {
      await expect(service.compare(TYPE)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('preview', () => {
    it('reports what the sanitizer would remove, without storing anything', () => {
      const result = service.preview({
        content: '<p>Kept.</p><iframe src="x"></iframe>',
      });
      expect(result.html).toBe('<p>Kept.</p>');
      expect(result.wasModified).toBe(true);
      expect(prisma.legalDocumentVersion.create).not.toHaveBeenCalled();
    });
  });
});
