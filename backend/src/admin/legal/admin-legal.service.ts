import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { LegalDocumentStatus, LegalDocumentType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LegalConsentService } from '../../common/legal/legal-consent.service';
import {
  LEGAL_DOCUMENT_LABELS,
  LEGAL_DOCUMENT_TYPES,
} from '../../common/legal/legal.constants';
import {
  htmlToPlainText,
  sanitizeArticleHtml,
} from '../../common/utils/sanitize-html.util';
import {
  PreviewLegalContentDto,
  PublishLegalVersionDto,
  RollbackLegalVersionDto,
  SaveLegalDraftDto,
} from './dto/admin-legal.dto';

/** Author/publisher fields, shared by every read. */
const ADMIN_SELECT = { id: true, name: true, email: true } as const;

const VERSION_SELECT = {
  id: true,
  documentType: true,
  versionNumber: true,
  title: true,
  subtitle: true,
  status: true,
  isCurrent: true,
  requiresAcknowledgement: true,
  changeSummary: true,
  effectiveAt: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  restoredFromVersionId: true,
  createdBy: { select: ADMIN_SELECT },
  publishedBy: { select: ADMIN_SELECT },
} satisfies Prisma.LegalDocumentVersionSelect;

/**
 * The write side of the legal-document system.
 *
 * ── The one rule everything else follows from ─────────────────────────────
 * A row that has left DRAFT is never updated in place. Publishing inserts
 * nothing and edits nothing about the old version except the two columns that
 * say it is no longer the live one (`isCurrent`, `status`); rolling back
 * inserts a NEW version carrying the old text. That is what makes
 * `LegalAcknowledgement.versionId` mean something: it points at the exact words
 * the user was shown, forever.
 *
 * ── Why the advisory lock ─────────────────────────────────────────────────
 * "At most one `isCurrent` per document type" cannot be a partial unique index
 * (Prisma cannot express one, and a hand-written one drifts from the schema),
 * so it is maintained by the publish transaction instead. Two publishes racing
 * on the same document would both clear the old current and both set their own,
 * leaving two live versions. `pg_advisory_xact_lock`, keyed on the document
 * type, serialises them; the unique index on (documentType, versionNumber) is
 * the second, structural backstop.
 */
@Injectable()
export class AdminLegalService {
  private readonly logger = new Logger(AdminLegalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: LegalConsentService,
  ) {}

  /**
   * A stable 32-bit lock key per document type.
   *
   * The enum's index, offset into a namespace of its own so it cannot collide
   * with an advisory lock taken by some unrelated feature that also counts from
   * zero.
   */
  private lockKey(documentType: LegalDocumentType): number {
    const index = LEGAL_DOCUMENT_TYPES.indexOf(documentType);
    return 0x1e6a1_00 + (index < 0 ? 99 : index);
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /**
   * The portal's landing view: every document type with its published version,
   * its draft if there is one, and its history count.
   *
   * Enumerates `LEGAL_DOCUMENT_TYPES` rather than the rows, so a document that
   * has never been published still appears — with an empty state to act on
   * instead of being invisible.
   */
  async listDocuments() {
    // Issued together rather than one after the other. Each is a round trip to
    // the database region, and running them in sequence made this page — the
    // section's landing view — cost two of them for no reason.
    const [rows, counts] = await Promise.all([
      this.prisma.legalDocumentVersion.findMany({
        where: {
          OR: [{ isCurrent: true }, { status: LegalDocumentStatus.DRAFT }],
        },
        select: VERSION_SELECT,
      }),
      this.prisma.legalDocumentVersion.groupBy({
        by: ['documentType'],
        where: { status: { not: LegalDocumentStatus.DRAFT } },
        _count: { _all: true },
      }),
    ]);

    return LEGAL_DOCUMENT_TYPES.map((documentType) => {
      const published =
        rows.find((r) => r.documentType === documentType && r.isCurrent) ??
        null;
      const draft =
        rows.find(
          (r) =>
            r.documentType === documentType &&
            r.status === LegalDocumentStatus.DRAFT,
        ) ?? null;
      return {
        documentType,
        label: LEGAL_DOCUMENT_LABELS[documentType],
        published,
        draft,
        publishedVersionCount:
          counts.find((c) => c.documentType === documentType)?._count._all ?? 0,
      };
    });
  }

  /**
   * One document: published version, draft, and the full version history.
   *
   * The DRAFT is returned with its body; the history entries are not. That
   * asymmetry is deliberate — the editor opens on the draft and needs its text
   * immediately, and fetching it separately made opening the editor a
   * two-round-trip waterfall (list the document, then ask for the body). The
   * historical bodies are large, rarely read, and fetched on demand by
   * `getVersion` when an admin actually opens one.
   */
  async getDocument(documentType: LegalDocumentType) {
    const versions = await this.prisma.legalDocumentVersion.findMany({
      where: { documentType },
      select: {
        ...VERSION_SELECT,
        // Prisma returns this per row; the map below keeps it only on the draft.
        content: true,
        _count: { select: { acknowledgements: true } },
      },
      orderBy: { versionNumber: 'desc' },
    });

    const draftRow =
      versions.find((v) => v.status === LegalDocumentStatus.DRAFT) ?? null;
    const stripBody = <T extends { content?: string }>(row: T) => {
      const { content, ...rest } = row;
      return rest;
    };

    return {
      documentType,
      label: LEGAL_DOCUMENT_LABELS[documentType],
      published:
        versions.find((v) => v.isCurrent) !== undefined
          ? stripBody(versions.find((v) => v.isCurrent)!)
          : null,
      draft: draftRow,
      // Drafts are excluded: an unpublished draft is not part of the history,
      // it is the thing that has not happened yet.
      history: versions
        .filter((v) => v.status !== LegalDocumentStatus.DRAFT)
        .map(stripBody),
    };
  }

  /** One version in full, including its body. Used by preview and compare. */
  async getVersion(id: string) {
    const version = await this.prisma.legalDocumentVersion.findUnique({
      where: { id },
      select: {
        ...VERSION_SELECT,
        content: true,
        _count: { select: { acknowledgements: true } },
      },
    });
    if (!version) throw new NotFoundException('That version does not exist.');
    return version;
  }

  /**
   * The draft and the live version side by side, for the compare view.
   *
   * Both bodies come from the server rather than being reassembled in the
   * browser from two separate calls, so the comparison is guaranteed to be
   * between the draft as stored and the version as published — not between the
   * editor's unsaved buffer and a cached copy.
   */
  async compare(documentType: LegalDocumentType) {
    const [draft, published] = await Promise.all([
      this.prisma.legalDocumentVersion.findFirst({
        where: { documentType, status: LegalDocumentStatus.DRAFT },
        select: { ...VERSION_SELECT, content: true },
      }),
      this.prisma.legalDocumentVersion.findFirst({
        where: { documentType, isCurrent: true },
        select: { ...VERSION_SELECT, content: true },
      }),
    ]);
    if (!draft) {
      throw new NotFoundException('There is no draft to compare.');
    }
    return { draft, published };
  }

  /**
   * Runs content through the save path's sanitizer without storing it.
   *
   * Same idea as the help centre's article preview: the admin sees exactly what
   * would be published, including anything the sanitizer strips, rather than
   * discovering the difference after it is live.
   */
  preview(dto: PreviewLegalContentDto) {
    const sanitized = sanitizeArticleHtml(dto.content ?? '');
    return {
      html: sanitized,
      plainText: htmlToPlainText(sanitized),
      wasModified: sanitized !== dto.content,
    };
  }

  // ── Draft lifecycle ──────────────────────────────────────────────────────

  /**
   * Creates or updates the draft for a document type.
   *
   * One draft per document, by construction rather than by convention: the
   * draft reserves the next version number, and the unique index on
   * (documentType, versionNumber) means two admins creating one concurrently
   * cannot both succeed.
   *
   * A new draft starts as a copy of the published text. Starting from a blank
   * editor would make every edit a rewrite of the whole document, which is how
   * a clause quietly disappears.
   */
  async saveDraft(
    documentType: LegalDocumentType,
    adminId: string,
    dto: SaveLegalDraftDto,
  ) {
    const content = sanitizeArticleHtml(dto.content);
    if (htmlToPlainText(content).length === 0) {
      throw new BadRequestException(
        'The document body is empty once formatting is removed.',
      );
    }

    const existing = await this.prisma.legalDocumentVersion.findFirst({
      where: { documentType, status: LegalDocumentStatus.DRAFT },
      select: { id: true },
    });

    if (existing) {
      return this.prisma.legalDocumentVersion.update({
        where: { id: existing.id },
        data: {
          title: dto.title.trim(),
          subtitle: dto.subtitle?.trim() || null,
          content,
        },
        select: VERSION_SELECT,
      });
    }

    const nextVersionNumber = await this.nextVersionNumber(documentType);
    try {
      return await this.prisma.legalDocumentVersion.create({
        data: {
          documentType,
          versionNumber: nextVersionNumber,
          title: dto.title.trim(),
          subtitle: dto.subtitle?.trim() || null,
          content,
          status: LegalDocumentStatus.DRAFT,
          createdById: adminId,
        },
        select: VERSION_SELECT,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Another administrator just created a draft for this document. Reload to see it.',
        );
      }
      throw error;
    }
  }

  /**
   * Seeds a draft from the published text so editing starts from what is live.
   * Returns the existing draft untouched if there already is one — this is a
   * "give me something to edit" call, not a reset.
   */
  async startDraft(documentType: LegalDocumentType, adminId: string) {
    const existing = await this.prisma.legalDocumentVersion.findFirst({
      where: { documentType, status: LegalDocumentStatus.DRAFT },
      select: VERSION_SELECT,
    });
    if (existing) return existing;

    const published = await this.prisma.legalDocumentVersion.findFirst({
      where: { documentType, isCurrent: true },
      select: { title: true, subtitle: true, content: true },
    });

    return this.saveDraft(documentType, adminId, {
      title: published?.title ?? LEGAL_DOCUMENT_LABELS[documentType],
      subtitle: published?.subtitle ?? undefined,
      content: published?.content ?? '<p></p>',
    });
  }

  /** Discards a draft. Only ever a draft — see the status guard. */
  async deleteDraft(documentType: LegalDocumentType) {
    const draft = await this.prisma.legalDocumentVersion.findFirst({
      where: { documentType, status: LegalDocumentStatus.DRAFT },
      select: { id: true },
    });
    if (!draft) throw new NotFoundException('There is no draft to discard.');

    await this.prisma.legalDocumentVersion.delete({ where: { id: draft.id } });
    return { success: true, deletedVersionId: draft.id };
  }

  // ── Publishing ───────────────────────────────────────────────────────────

  /**
   * Publishes the draft.
   *
   * Everything that makes a version live happens inside one transaction under
   * the document's advisory lock: the previous current row is archived, the
   * draft is stamped with its publication metadata, and nothing in between is
   * observable to a reader.
   */
  async publishDraft(
    documentType: LegalDocumentType,
    adminId: string,
    dto: PublishLegalVersionDto,
  ) {
    const effectiveAt = this.resolveEffectiveAt(dto.effectiveAt);

    const published = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${this.lockKey(documentType)})`;

      const draft = await tx.legalDocumentVersion.findFirst({
        where: { documentType, status: LegalDocumentStatus.DRAFT },
        select: { id: true, content: true },
      });
      if (!draft) {
        throw new NotFoundException(
          'There is no draft to publish for this document.',
        );
      }

      await this.archiveCurrent(tx, documentType);

      return tx.legalDocumentVersion.update({
        where: { id: draft.id },
        data: {
          status: LegalDocumentStatus.PUBLISHED,
          isCurrent: true,
          requiresAcknowledgement: dto.requiresAcknowledgement ?? false,
          changeSummary: dto.changeSummary.trim(),
          effectiveAt,
          publishedById: adminId,
          publishedAt: new Date(),
        },
        select: VERSION_SELECT,
      });
    });

    // The new text and any new requirement have to take effect now, not at the
    // end of the cache window — an admin who publishes and then looks at the
    // public page, or at the app, must see what they just shipped.
    this.consent.invalidatePublished();
    this.logger.log(
      `legal.published type=${documentType} version=${published.versionNumber} ` +
        `admin=${adminId} requiresAck=${published.requiresAcknowledgement}`,
    );
    return published;
  }

  /**
   * Restores an earlier version by publishing a NEW one carrying its text.
   *
   * Never resurrects the old row. Flipping a historical version back to current
   * would silently change what "the version I accepted" means for everyone who
   * acknowledged something in between, and would leave the history claiming a
   * version was published twice with one timestamp.
   */
  async rollback(
    documentType: LegalDocumentType,
    adminId: string,
    dto: RollbackLegalVersionDto,
  ) {
    const effectiveAt = this.resolveEffectiveAt(dto.effectiveAt);

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${this.lockKey(documentType)})`;

      const target = await tx.legalDocumentVersion.findUnique({
        where: {
          documentType_versionNumber: {
            documentType,
            versionNumber: dto.targetVersionNumber,
          },
        },
        select: {
          id: true,
          title: true,
          subtitle: true,
          content: true,
          status: true,
          isCurrent: true,
          versionNumber: true,
        },
      });
      if (!target || target.status === LegalDocumentStatus.DRAFT) {
        throw new NotFoundException(
          'That version does not exist, or was never published.',
        );
      }
      if (target.isCurrent) {
        throw new ConflictException(
          'That version is already the published one.',
        );
      }

      await this.archiveCurrent(tx, documentType);

      const nextVersionNumber = await this.nextVersionNumber(documentType, tx);

      return tx.legalDocumentVersion.create({
        data: {
          documentType,
          versionNumber: nextVersionNumber,
          title: target.title,
          subtitle: target.subtitle,
          content: target.content,
          status: LegalDocumentStatus.PUBLISHED,
          isCurrent: true,
          requiresAcknowledgement: dto.requiresAcknowledgement ?? false,
          changeSummary: dto.changeSummary.trim(),
          effectiveAt,
          createdById: adminId,
          publishedById: adminId,
          publishedAt: new Date(),
          restoredFromVersionId: target.id,
        },
        select: VERSION_SELECT,
      });
    });

    this.consent.invalidatePublished();
    this.logger.log(
      `legal.rolled_back type=${documentType} newVersion=${created.versionNumber} ` +
        `restoredFrom=v${dto.targetVersionNumber} admin=${adminId}`,
    );
    return created;
  }

  // ── Acknowledgement reporting ────────────────────────────────────────────

  /**
   * How many users have accepted a required version, so an admin can see
   * whether a mandatory update is landing rather than guessing.
   */
  async getAcknowledgementStats(versionId: string) {
    const version = await this.prisma.legalDocumentVersion.findUnique({
      where: { id: versionId },
      select: {
        id: true,
        documentType: true,
        versionNumber: true,
        requiresAcknowledgement: true,
        isCurrent: true,
        publishedAt: true,
      },
    });
    if (!version) throw new NotFoundException('That version does not exist.');

    const [acknowledged, eligible] = await Promise.all([
      this.prisma.legalAcknowledgement.count({
        where: { versionId },
      }),
      // "Eligible" is every account that could be shown the modal: active,
      // not deleted. Suspended and pending-deletion accounts are excluded
      // because they see their own gate instead, so counting them would make a
      // fully-accepted rollout look permanently incomplete.
      this.prisma.user.count({
        where: { accountStatus: 'ACTIVE', deletedAt: null },
      }),
    ]);

    return {
      ...version,
      acknowledged,
      eligible,
      pending: Math.max(eligible - acknowledged, 0),
    };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /**
   * Retires whatever is currently live for this document type.
   *
   * `updateMany` rather than a targeted update: if a past bug ever left two
   * rows current, this clears both instead of leaving one behind.
   */
  private async archiveCurrent(
    tx: Prisma.TransactionClient,
    documentType: LegalDocumentType,
  ): Promise<void> {
    await tx.legalDocumentVersion.updateMany({
      where: { documentType, isCurrent: true },
      data: { isCurrent: false, status: LegalDocumentStatus.ARCHIVED },
    });
  }

  /**
   * The next version number for a document type.
   *
   * Counts across every status, drafts included, so a draft's reserved number
   * cannot be handed out a second time to a rollback publishing beside it.
   */
  private async nextVersionNumber(
    documentType: LegalDocumentType,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<number> {
    const highest = await client.legalDocumentVersion.findFirst({
      where: { documentType },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    return (highest?.versionNumber ?? 0) + 1;
  }

  /** Defaults to now, and refuses a date the server cannot make sense of. */
  private resolveEffectiveAt(value?: string): Date {
    if (!value) return new Date();
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('The effective date is not a valid date.');
    }
    return parsed;
  }
}
