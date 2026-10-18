import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

/**
 * `sanitize-html` pulls in an ESM sub-dependency ts-jest cannot parse, so the
 * repository mocks our wrapper (see `common/utils/sanitize-html.util.spec.ts`
 * for the real configuration). The stub strips <script>/<iframe> and inline
 * handlers, which is all the assertions below rely on.
 */
jest.mock('../../common/utils/sanitize-html.util', () => ({
  sanitizeArticleHtml: (html: string) =>
    (html ?? '')
      .replace(
        /<(script|iframe)\b[^>]*>[\s\S]*?<\/\1>|<(script|iframe)\b[^>]*\/?>/gi,
        '',
      )
      .replace(/\son\w+="[^"]*"/gi, ''),
  htmlToPlainText: (html: string) =>
    (html ?? '').replace(/<[^>]*>/g, '').trim(),
}));

import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  LegalDocumentType,
  type LegalDocumentVersion,
  type Prisma,
} from '@prisma/client';
import { AdminLegalService } from './admin-legal.service';
import {
  NotifyLegalUpdateDto,
  PublishLegalDraftDto,
} from './dto/admin-legal.dto';
import { stub } from '../../common/testing/stub';
import type { PrismaService } from '../../prisma/prisma.service';
import { createLegalConsentMock } from '../../common/legal/testing/legal-consent.mock';

type Where = Record<string, unknown>;
type Order = { versionNumber?: 'asc' | 'desc' };
type FindArgs = { where?: Where; orderBy?: Order };
type CreateArgs = { data: Prisma.LegalDocumentVersionUncheckedCreateInput };
type UpdateArgs = {
  where: { id: string };
  data: Partial<LegalDocumentVersion>;
};
type UpdateManyArgs = { where: Where; data: Partial<LegalDocumentVersion> };
type GroupArgs = { where?: { versionId?: { in: string[] } } };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !(v instanceof Date);

/** Field-level matcher for the handful of operators the service uses. */
function fieldMatches(actual: unknown, expected: unknown): boolean {
  if (!isObject(expected)) return actual === expected;
  if ('not' in expected) return actual !== expected.not;
  if ('in' in expected && Array.isArray(expected.in)) {
    return expected.in.includes(actual);
  }
  if ('gt' in expected && expected.gt instanceof Date) {
    return actual instanceof Date && actual > expected.gt;
  }
  return false;
}

function matches(row: LegalDocumentVersion, where: Where = {}): boolean {
  const fields: Record<string, unknown> = { ...row };
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') {
      return (
        Array.isArray(value) &&
        value.some((clause) => isObject(clause) && matches(row, clause))
      );
    }
    return fieldMatches(fields[key], value);
  });
}

/**
 * Drafts, publishing (with and without the update screen), restore-as-draft
 * and the quick notify.
 *
 * The property every test defends: a published version is never rewritten.
 * Only `isCurrent`/`status` change on an old row; everything else is an
 * insert or a draft edit.
 */
describe('AdminLegalService', () => {
  const TYPE = LegalDocumentType.TERMS_OF_SERVICE;
  const ADMIN = 'admin-1';

  let rows: LegalDocumentVersion[];
  let acknowledgements: { versionId: string }[];
  let activeUsers: number;
  let consent: ReturnType<typeof createLegalConsentMock>;
  let prisma: ReturnType<typeof buildPrisma>;
  let service: AdminLegalService;
  let nextId: number;

  const version = (
    over: Partial<LegalDocumentVersion> = {},
  ): LegalDocumentVersion => ({
    id: `v-${over.documentType ?? TYPE}-${over.versionNumber ?? 1}`,
    documentType: TYPE,
    versionNumber: 1,
    title: 'Terms of Service',
    subtitle: 'The rules.',
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

  const sorted = (found: LegalDocumentVersion[], orderBy?: Order) =>
    orderBy?.versionNumber === 'desc'
      ? [...found].sort((a, b) => b.versionNumber - a.versionNumber)
      : found;

  const withAdmins = (r: LegalDocumentVersion) => ({
    ...r,
    createdBy: null,
    publishedBy: null,
  });

  const buildPrisma = () => {
    const legalDocumentVersion = {
      findFirst: jest.fn(({ where, orderBy }: FindArgs = {}) =>
        Promise.resolve(
          sorted(
            rows.filter((r) => matches(r, where)),
            orderBy,
          ).map(withAdmins)[0] ?? null,
        ),
      ),
      findMany: jest.fn(({ where, orderBy }: FindArgs = {}) =>
        Promise.resolve(
          sorted(
            rows.filter((r) => matches(r, where)),
            orderBy,
          ).map(withAdmins),
        ),
      ),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          rows.filter((r) => r.id === where.id).map(withAdmins)[0] ?? null,
        ),
      ),
      groupBy: jest.fn(() => Promise.resolve([])),
      create: jest.fn(({ data }: CreateArgs) => {
        const row = version({
          id: `new-${nextId++}`,
          documentType: data.documentType,
          versionNumber: data.versionNumber,
          title: data.title,
          subtitle: data.subtitle ?? null,
          content: data.content,
          status: data.status ?? 'DRAFT',
          isCurrent: data.isCurrent ?? false,
          requiresAcknowledgement: data.requiresAcknowledgement ?? false,
          changeSummary: data.changeSummary ?? null,
          effectiveAt: data.effectiveAt ? new Date(data.effectiveAt) : null,
          createdById: data.createdById ?? null,
          publishedById: data.publishedById ?? null,
          publishedAt: data.publishedAt ? new Date(data.publishedAt) : null,
          restoredFromVersionId: data.restoredFromVersionId ?? null,
        });
        if (
          rows.some(
            (r) =>
              r.documentType === row.documentType &&
              r.versionNumber === row.versionNumber,
          )
        ) {
          return Promise.reject(new Error('unique violation'));
        }
        rows.push(row);
        return Promise.resolve(withAdmins(row));
      }),
      update: jest.fn(({ where, data }: UpdateArgs) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) return Promise.reject(new Error('not found'));
        Object.assign(row, data);
        return Promise.resolve(withAdmins(row));
      }),
      updateMany: jest.fn(({ where, data }: UpdateManyArgs) => {
        const hit = rows.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return Promise.resolve({ count: hit.length });
      }),
      deleteMany: jest.fn(({ where }: { where: Where }) => {
        const before = rows.length;
        rows = rows.filter((r) => !matches(r, where));
        return Promise.resolve({ count: before - rows.length });
      }),
    };
    const tx = {
      $executeRaw: jest.fn(() => Promise.resolve(1)),
      legalDocumentVersion,
    };
    return {
      ...tx,
      $transaction: jest.fn(<T>(fn: (client: typeof tx) => Promise<T>) =>
        fn(tx),
      ),
      user: { count: jest.fn(() => Promise.resolve(activeUsers)) },
      legalAcknowledgement: {
        groupBy: jest.fn(({ where }: GroupArgs) => {
          const ids = where?.versionId?.in ?? [];
          return Promise.resolve(
            ids.map((versionId) => ({
              versionId,
              _count: {
                _all: acknowledgements.filter((a) => a.versionId === versionId)
                  .length,
              },
            })),
          );
        }),
      },
    };
  };

  beforeEach(() => {
    nextId = 1;
    activeUsers = 1030;
    acknowledgements = [];
    rows = [
      version({ versionNumber: 1, status: 'ARCHIVED' }),
      version({
        versionNumber: 2,
        isCurrent: true,
        content: '<p>Current text.</p>',
      }),
    ];
    prisma = buildPrisma();
    consent = createLegalConsentMock();
    service = new AdminLegalService(stub<PrismaService>(prisma), consent);
  });

  const current = (type: LegalDocumentType = TYPE) =>
    rows.filter((r) => r.documentType === type && r.isCurrent);
  const draft = () =>
    rows.find((r) => r.documentType === TYPE && r.status === 'DRAFT');

  // ── Draft lifecycle ──────────────────────────────────────────────────────

  describe('drafts', () => {
    it('opens a draft seeded from the live text, reserving the next number', async () => {
      const d = await service.startDraft(TYPE, ADMIN);
      expect(d).toMatchObject({
        status: 'DRAFT',
        versionNumber: 3,
        content: '<p>Current text.</p>',
        restoredFromVersionId: null,
      });
      expect(current()[0].versionNumber).toBe(2);
    });

    it('returns the existing draft instead of resetting it', async () => {
      await service.startDraft(TYPE, ADMIN);
      await service.saveDraft(TYPE, ADMIN, {
        title: 'Terms',
        content: '<p>Edited.</p>',
      });
      const again = await service.startDraft(TYPE, ADMIN);
      expect(again.content).toBe('<p>Edited.</p>');
      expect(rows.filter((r) => r.status === 'DRAFT')).toHaveLength(1);
    });

    it('sanitizes the body on save', async () => {
      const saved = await service.saveDraft(TYPE, ADMIN, {
        title: 'Terms',
        content: '<p onclick="steal()">Hi</p><script>alert(1)</script>',
      });
      expect(saved.content).toBe('<p>Hi</p>');
    });

    it('refuses a body that is empty once sanitized', async () => {
      await expect(
        service.saveDraft(TYPE, ADMIN, {
          title: 'Terms',
          content: '<script>x</script>',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('never edits a published row while saving', async () => {
      await service.startDraft(TYPE, ADMIN);
      await service.saveDraft(TYPE, ADMIN, {
        title: 'Terms',
        content: '<p>Edited.</p>',
      });
      expect(current()[0].content).toBe('<p>Current text.</p>');
    });

    it('discards only the draft', async () => {
      await service.startDraft(TYPE, ADMIN);
      await service.deleteDraft(TYPE);
      expect(draft()).toBeUndefined();
      expect(rows).toHaveLength(2);
    });

    it('404s when there is no draft to discard', async () => {
      await expect(service.deleteDraft(TYPE)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('restore as draft', () => {
    it('seeds a new draft from an older version and records where from', async () => {
      const d = await service.startDraft(TYPE, ADMIN, `v-${TYPE}-1`);
      expect(d).toMatchObject({
        status: 'DRAFT',
        versionNumber: 3,
        content: '<p>Original text.</p>',
        restoredFromVersionId: `v-${TYPE}-1`,
      });
      // Restoring is a draft, not a publish: the live version is untouched.
      expect(current()[0].versionNumber).toBe(2);
      expect(consent.invalidatePublishedEverywhere).not.toHaveBeenCalled();
    });

    it('refuses while a draft already exists rather than overwrite it', async () => {
      await service.startDraft(TYPE, ADMIN);
      await expect(
        service.startDraft(TYPE, ADMIN, `v-${TYPE}-1`),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('404s for a version of another document', async () => {
      rows.push(
        version({
          documentType: 'PRIVACY_POLICY',
          versionNumber: 1,
          isCurrent: true,
        }),
      );
      await expect(
        service.startDraft(TYPE, ADMIN, 'v-PRIVACY_POLICY-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── Publishing ───────────────────────────────────────────────────────────

  describe('publishing a draft', () => {
    beforeEach(async () => {
      await service.startDraft(TYPE, ADMIN);
      await service.saveDraft(TYPE, ADMIN, {
        title: 'Terms of Service',
        content: '<p>New text.</p>',
      });
    });

    it('without notifying: goes live silently, summary optional', async () => {
      const published = await service.publishDraft(TYPE, ADMIN, {
        notifyUsers: false,
      });
      expect(published).toMatchObject({
        versionNumber: 3,
        status: 'PUBLISHED',
        isCurrent: true,
        requiresAcknowledgement: false,
        changeSummary: null,
        publishedById: ADMIN,
      });
      expect(current()).toHaveLength(1);
      expect(rows.find((r) => r.versionNumber === 2)?.status).toBe('ARCHIVED');
      expect(consent.invalidatePublishedEverywhere).toHaveBeenCalledTimes(1);
    });

    it('with notifying: requires acknowledgement and a summary', async () => {
      const published = await service.publishDraft(TYPE, ADMIN, {
        notifyUsers: true,
        changeSummary: '  We clarified the messaging rules.  ',
      });
      expect(published).toMatchObject({
        requiresAcknowledgement: true,
        changeSummary: 'We clarified the messaging rules.',
      });
      expect(consent.invalidatePublishedEverywhere).toHaveBeenCalledTimes(1);
    });

    it('refuses to notify without saying what changed', async () => {
      await expect(
        service.publishDraft(TYPE, ADMIN, { notifyUsers: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(draft()).toBeDefined();
      expect(consent.invalidatePublishedEverywhere).not.toHaveBeenCalled();
    });

    it('takes the advisory lock inside the transaction', async () => {
      await service.publishDraft(TYPE, ADMIN, { notifyUsers: false });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('refuses an effective date more than 90 days ahead', async () => {
      const far = new Date(Date.now() + 91 * 24 * 3600 * 1000).toISOString();
      await expect(
        service.publishDraft(TYPE, ADMIN, {
          notifyUsers: false,
          effectiveAt: far,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('renumbers the draft above a version a notify published meanwhile', async () => {
      await service.notify(ADMIN, {
        documentTypes: [TYPE],
        changeSummary: 'Please review the terms again.',
      });
      const published = await service.publishDraft(TYPE, ADMIN, {
        notifyUsers: false,
      });
      expect(published.versionNumber).toBe(5);
      expect(current()).toHaveLength(1);
    });

    it('404s when there is no draft', async () => {
      await service.deleteDraft(TYPE);
      await expect(
        service.publishDraft(TYPE, ADMIN, { notifyUsers: false }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── Quick notify ─────────────────────────────────────────────────────────

  describe('notify', () => {
    beforeEach(() => {
      rows.push(
        version({
          documentType: 'PRIVACY_POLICY',
          versionNumber: 4,
          isCurrent: true,
          title: 'Privacy Policy',
          content: '<p>Privacy text.</p>',
        }),
      );
    });

    it('archives each current row and inserts a notified copy of its text', async () => {
      const { versions } = await service.notify(ADMIN, {
        documentTypes: ['PRIVACY_POLICY', TYPE],
        changeSummary: 'We now describe college email verification.',
      });
      expect(versions.map((v) => [v.documentType, v.versionNumber])).toEqual([
        [TYPE, 3],
        ['PRIVACY_POLICY', 5],
      ]);
      expect(current(TYPE)[0]).toMatchObject({
        content: '<p>Current text.</p>',
        subtitle: 'The rules.',
        requiresAcknowledgement: true,
        status: 'PUBLISHED',
        publishedById: ADMIN,
      });
      expect(current('PRIVACY_POLICY')[0].content).toBe('<p>Privacy text.</p>');
      expect(rows.find((r) => r.id === `v-${TYPE}-2`)?.status).toBe('ARCHIVED');
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
      expect(consent.invalidatePublishedEverywhere).toHaveBeenCalledTimes(1);
    });

    it('400s for a document with no current version, writing nothing', async () => {
      const before = rows.length;
      await expect(
        service.notify(ADMIN, {
          documentTypes: [TYPE, 'COOKIE_POLICY'],
          changeSummary: 'We changed the cookie policy.',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(rows).toHaveLength(before);
      expect(consent.invalidatePublishedEverywhere).not.toHaveBeenCalled();
    });

    it('409s a second notify for the same document within 60 seconds', async () => {
      await service.notify(ADMIN, {
        documentTypes: [TYPE],
        changeSummary: 'First notice to users.',
      });
      await expect(
        service.notify(ADMIN, {
          documentTypes: [TYPE],
          changeSummary: 'Second notice to users.',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(rows.filter((r) => r.requiresAcknowledgement)).toHaveLength(1);
    });

    it('allows a notice once the cooldown has passed', async () => {
      rows.push(
        version({
          id: 'old-notice',
          versionNumber: 9,
          documentType: 'COMMUNITY_GUIDELINES',
          isCurrent: true,
          requiresAcknowledgement: true,
          publishedAt: new Date(Date.now() - 61_000),
        }),
      );
      await expect(
        service.notify(ADMIN, {
          documentTypes: ['COMMUNITY_GUIDELINES'],
          changeSummary: 'Second notice, later.',
        }),
      ).resolves.toBeDefined();
    });
  });

  // ── Reads ────────────────────────────────────────────────────────────────

  describe('reads', () => {
    it('lists the four documents with acceptance for a notified current version', async () => {
      rows = [
        version({
          versionNumber: 3,
          isCurrent: true,
          requiresAcknowledgement: true,
        }),
      ];
      acknowledgements = Array.from({ length: 412 }, () => ({
        versionId: `v-${TYPE}-3`,
      }));
      const docs = await service.listDocuments();
      expect(docs.map((d) => d.documentType)).toEqual([
        'TERMS_OF_SERVICE',
        'PRIVACY_POLICY',
        'COOKIE_POLICY',
        'COMMUNITY_GUIDELINES',
      ]);
      expect(docs[0].stats).toEqual({
        acknowledged: 412,
        totalActiveUsers: 1030,
      });
      expect(docs[1]).toMatchObject({ published: null, stats: null });
    });

    it('skips the COUNT queries entirely when nothing is notified', async () => {
      await service.listDocuments();
      expect(prisma.user.count).not.toHaveBeenCalled();
      expect(prisma.legalAcknowledgement.groupBy).not.toHaveBeenCalled();
    });

    it('marks notified versions in the history, with acceptance', async () => {
      rows.push(
        version({
          versionNumber: 3,
          requiresAcknowledgement: true,
          status: 'ARCHIVED',
        }),
      );
      acknowledgements = [{ versionId: `v-${TYPE}-3` }];
      const doc = await service.getDocument(TYPE);
      const v3 = doc.history.find((h) => h.versionNumber === 3);
      expect(v3).toMatchObject({
        notified: true,
        stats: { acknowledged: 1, totalActiveUsers: 1030 },
      });
      expect(doc.history.find((h) => h.versionNumber === 2)?.notified).toBe(
        false,
      );
    });

    it('keeps the draft out of the history', async () => {
      await service.startDraft(TYPE, ADMIN);
      const doc = await service.getDocument(TYPE);
      expect(doc.draft?.status).toBe('DRAFT');
      expect(doc.history.every((h) => h.status !== 'DRAFT')).toBe(true);
    });
  });

  // ── Validation ───────────────────────────────────────────────────────────

  describe('DTO validation', () => {
    const errorsFor = async <T extends object>(
      cls: new () => T,
      body: object,
    ) => (await validate(plainToInstance(cls, body))).map((e) => e.property);

    it('requires an explicit notify choice on publish', async () => {
      expect(await errorsFor(PublishLegalDraftDto, {})).toContain(
        'notifyUsers',
      );
      expect(
        await errorsFor(PublishLegalDraftDto, { notifyUsers: false }),
      ).toEqual([]);
    });

    it('bounds notify: 1–4 unique known types, 10–500 char summary', async () => {
      const ok = { documentTypes: [TYPE], changeSummary: 'Ten chars!!' };
      expect(await errorsFor(NotifyLegalUpdateDto, ok)).toEqual([]);
      expect(
        await errorsFor(NotifyLegalUpdateDto, { ...ok, documentTypes: [] }),
      ).toContain('documentTypes');
      expect(
        await errorsFor(NotifyLegalUpdateDto, {
          ...ok,
          documentTypes: [TYPE, TYPE],
        }),
      ).toContain('documentTypes');
      expect(
        await errorsFor(NotifyLegalUpdateDto, {
          ...ok,
          documentTypes: ['NOT_A_DOC'],
        }),
      ).toContain('documentTypes');
      expect(
        await errorsFor(NotifyLegalUpdateDto, {
          ...ok,
          changeSummary: 'short',
        }),
      ).toContain('changeSummary');
      expect(
        await errorsFor(NotifyLegalUpdateDto, {
          ...ok,
          changeSummary: 'x'.repeat(501),
        }),
      ).toContain('changeSummary');
      expect(
        await errorsFor(NotifyLegalUpdateDto, { ...ok, effectiveAt: 'soon' }),
      ).toContain('effectiveAt');
    });
  });
});
