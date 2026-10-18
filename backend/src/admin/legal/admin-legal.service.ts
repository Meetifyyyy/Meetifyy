import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountStatus,
  LegalDocumentStatus,
  LegalDocumentType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LegalConsentService } from '../../common/legal/legal-consent.service';
import {
  LEGAL_DOCUMENT_LABELS,
  LEGAL_DOCUMENT_PATHS,
  LEGAL_DOCUMENT_TYPES,
} from '../../common/legal/legal.constants';
import {
  htmlToPlainText,
  sanitizeArticleHtml,
} from '../../common/utils/sanitize-html.util';
import {
  NotifyLegalUpdateDto,
  PreviewLegalContentDto,
  PublishLegalDraftDto,
  SaveLegalDraftDto,
} from './dto/admin-legal.dto';

/** A second notify for the same document inside this window is a double click. */
export const LEGAL_NOTIFY_COOLDOWN_MS = 60 * 1000;
/** How far ahead an effective date may be set. */
export const LEGAL_MAX_EFFECTIVE_AHEAD_MS = 90 * 24 * 60 * 60 * 1000;
/** Bounds for the summary shown on the update screen. */
const SUMMARY_MIN = 10;
const SUMMARY_MAX = 500;

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

const VERSION_WITH_CONTENT_SELECT = {
  ...VERSION_SELECT,
  content: true,
} satisfies Prisma.LegalDocumentVersionSelect;

export type AdminLegalVersion = Prisma.LegalDocumentVersionGetPayload<{
  select: typeof VERSION_SELECT;
}>;
export type AdminLegalVersionWithContent =
  Prisma.LegalDocumentVersionGetPayload<{
    select: typeof VERSION_WITH_CONTENT_SELECT;
  }>;

/** Acceptance progress for a version that required acknowledgement. */
export interface AcceptanceStats {
  acknowledged: number;
  totalActiveUsers: number;
}

export interface AdminLegalDocumentSummary {
  documentType: LegalDocumentType;
  label: string;
  path: string;
  published: AdminLegalVersion | null;
  draft: AdminLegalVersion | null;
  publishedVersionCount: number;
  /** Publication time of the latest version that required acknowledgement. */
  lastNotifiedAt: Date | null;
  /** Only when the current version requires acknowledgement. */
  stats: AcceptanceStats | null;
}

export type AdminLegalHistoryEntry = AdminLegalVersion & {
  /** Whether users were put behind the update screen for this version. */
  notified: boolean;
  stats: AcceptanceStats | null;
};

export interface AdminLegalDocumentDetail {
  documentType: LegalDocumentType;
  label: string;
  path: string;
  published: AdminLegalVersion | null;
  draft: AdminLegalVersionWithContent | null;
  history: AdminLegalHistoryEntry[];
  totalActiveUsers: number;
}

/**
 * "Active" for every acceptance figure: an account that could be shown the
 * update screen. Banned, suspended and pending-deletion accounts see their own
 * gate instead, so counting them would make a finished rollout look stuck.
 */
const ACTIVE_USER_WHERE = {
  accountStatus: AccountStatus.ACTIVE,
  deletedAt: null,
} satisfies Prisma.UserWhereInput;

/**
 * The write side of the legal-document system: drafts, publishing, and asking
 * users to review an update.
 *
 * ── The one rule everything else follows from ─────────────────────────────
 * A row that has left DRAFT is never edited. Publishing archives the previous
 * current row (only `isCurrent`/`status` change) and turns the draft into the
 * live row; "restore" seeds a NEW draft from an old version's text. That is
 * what keeps `LegalAcknowledgement.versionId` meaningful: it points at the
 * exact words the user was shown, forever.
 *
 * ── Why the advisory lock ─────────────────────────────────────────────────
 * "At most one `isCurrent` per document type" cannot be a partial unique index
 * (Prisma cannot express one), so the publish transaction maintains it under
 * `pg_advisory_xact_lock` keyed on the document type. The unique index on
 * (documentType, versionNumber) is the structural backstop.
 *
 * Every publish ends with `invalidatePublishedEverywhere()`, so the public
 * pages and the consent gate on every replica see the new version on their
 * next read.
 */
@Injectable()
export class AdminLegalService {
  private readonly logger = new Logger(AdminLegalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: LegalConsentService,
  ) {}

  /**
   * A stable 32-bit advisory-lock key per document type, offset into its own
   * namespace so it cannot collide with an unrelated lock counting from zero.
   */
  private lockKey(documentType: LegalDocumentType): number {
    const index = LEGAL_DOCUMENT_TYPES.indexOf(documentType);
    return 0x1e6a1_00 + (index < 0 ? 99 : index);
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /** Accounts that could be shown the update screen right now. */
  async countActiveUsers(): Promise<number> {
    return this.prisma.user.count({ where: ACTIVE_USER_WHERE });
  }

  /**
   * The portal's landing view. Enumerates `LEGAL_DOCUMENT_TYPES` rather than
   * the rows, so a never-published document still appears with an empty state.
   */
  async listDocuments(): Promise<AdminLegalDocumentSummary[]> {
    const [rows, counts, lastNotified] = await Promise.all([
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
      this.prisma.legalDocumentVersion.groupBy({
        by: ['documentType'],
        where: {
          requiresAcknowledgement: true,
          status: { not: LegalDocumentStatus.DRAFT },
        },
        _max: { publishedAt: true },
      }),
    ]);

    const gatedIds = rows
      .filter((r) => r.isCurrent && r.requiresAcknowledgement)
      .map((r) => r.id);
    const [acknowledged, totalActiveUsers] =
      gatedIds.length === 0
        ? [new Map<string, number>(), 0]
        : await Promise.all([
            this.countAcknowledged(gatedIds),
            this.countActiveUsers(),
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
        path: LEGAL_DOCUMENT_PATHS[documentType],
        published,
        draft,
        publishedVersionCount:
          counts.find((c) => c.documentType === documentType)?._count._all ?? 0,
        lastNotifiedAt:
          lastNotified.find((g) => g.documentType === documentType)?._max
            .publishedAt ?? null,
        stats:
          published && published.requiresAcknowledgement
            ? this.statsFor(published.id, acknowledged, totalActiveUsers)
            : null,
      };
    });
  }

  /**
   * One document: live version, draft (with its body, which the editor needs
   * immediately) and every non-draft version without bodies. Acceptance is
   * counted for each version that notified users, in one grouped COUNT.
   */
  async getDocument(
    documentType: LegalDocumentType,
  ): Promise<AdminLegalDocumentDetail> {
    const [versions, draft] = await Promise.all([
      this.prisma.legalDocumentVersion.findMany({
        where: { documentType, status: { not: LegalDocumentStatus.DRAFT } },
        select: VERSION_SELECT,
        orderBy: { versionNumber: 'desc' },
      }),
      this.prisma.legalDocumentVersion.findFirst({
        where: { documentType, status: LegalDocumentStatus.DRAFT },
        select: VERSION_WITH_CONTENT_SELECT,
      }),
    ]);

    const notifiedIds = versions
      .filter((v) => v.requiresAcknowledgement)
      .map((v) => v.id);
    const [acknowledged, totalActiveUsers] = await Promise.all([
      notifiedIds.length === 0
        ? Promise.resolve(new Map<string, number>())
        : this.countAcknowledged(notifiedIds),
      this.countActiveUsers(),
    ]);

    return {
      documentType,
      label: LEGAL_DOCUMENT_LABELS[documentType],
      path: LEGAL_DOCUMENT_PATHS[documentType],
      published: versions.find((v) => v.isCurrent) ?? null,
      draft,
      history: versions.map((v) => ({
        ...v,
        notified: v.requiresAcknowledgement,
        stats: v.requiresAcknowledgement
          ? this.statsFor(v.id, acknowledged, totalActiveUsers)
          : null,
      })),
      totalActiveUsers,
    };
  }

  /** One version in full, including its body. */
  async getVersion(id: string): Promise<AdminLegalVersionWithContent> {
    const version = await this.prisma.legalDocumentVersion.findUnique({
      where: { id },
      select: VERSION_WITH_CONTENT_SELECT,
    });
    if (!version) throw new NotFoundException('That version does not exist.');
    return version;
  }

  /**
   * Runs content through the save path's sanitizer without storing it, so the
   * editor's live preview is exactly what would be published.
   */
  preview(dto: PreviewLegalContentDto): {
    html: string;
    plainText: string;
    wasModified: boolean;
  } {
    const html = sanitizeArticleHtml(dto.content ?? '');
    return {
      html,
      plainText: htmlToPlainText(html),
      wasModified: html !== dto.content,
    };
  }

  // ── Draft lifecycle ──────────────────────────────────────────────────────

  /**
   * Creates or updates the one draft for a document type. The draft reserves
   * the next version number, so the unique index stops two admins from both
   * creating one.
   */
  async saveDraft(
    documentType: LegalDocumentType,
    adminId: string,
    dto: SaveLegalDraftDto,
    restoredFromVersionId: string | null = null,
  ): Promise<AdminLegalVersionWithContent> {
    const content = sanitizeArticleHtml(dto.content);
    if (htmlToPlainText(content).length === 0) {
      throw new BadRequestException(
        'The document body is empty once formatting is removed.',
      );
    }
    const title = dto.title.trim();
    const subtitle = dto.subtitle?.trim() || null;

    const existing = await this.prisma.legalDocumentVersion.findFirst({
      where: { documentType, status: LegalDocumentStatus.DRAFT },
      select: { id: true },
    });
    if (existing) {
      return this.prisma.legalDocumentVersion.update({
        where: { id: existing.id },
        data: { title, subtitle, content },
        select: VERSION_WITH_CONTENT_SELECT,
      });
    }

    const versionNumber = await this.nextVersionNumber(documentType);
    try {
      return await this.prisma.legalDocumentVersion.create({
        data: {
          documentType,
          versionNumber,
          title,
          subtitle,
          content,
          status: LegalDocumentStatus.DRAFT,
          createdById: adminId,
          restoredFromVersionId,
        },
        select: VERSION_WITH_CONTENT_SELECT,
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
   * "Give me something to edit": returns the existing draft untouched, or
   * seeds one from the live text — or, with `fromVersionId`, from an older
   * version ("Restore as draft"). Restoring while a draft exists is refused
   * rather than silently overwriting someone's unpublished edits.
   */
  async startDraft(
    documentType: LegalDocumentType,
    adminId: string,
    fromVersionId?: string,
  ): Promise<AdminLegalVersionWithContent> {
    const existing = await this.prisma.legalDocumentVersion.findFirst({
      where: { documentType, status: LegalDocumentStatus.DRAFT },
      select: VERSION_WITH_CONTENT_SELECT,
    });
    if (existing) {
      if (fromVersionId) {
        throw new ConflictException(
          'This document already has a draft. Discard it before restoring an older version.',
        );
      }
      return existing;
    }

    const source = await this.prisma.legalDocumentVersion.findFirst({
      where: fromVersionId
        ? { id: fromVersionId, documentType }
        : { documentType, isCurrent: true },
      select: {
        id: true,
        title: true,
        subtitle: true,
        content: true,
        status: true,
        isCurrent: true,
      },
    });
    if (
      fromVersionId &&
      (!source || source.status === LegalDocumentStatus.DRAFT)
    ) {
      throw new NotFoundException(
        'That version does not exist, or was never published.',
      );
    }

    return this.saveDraft(
      documentType,
      adminId,
      {
        title: source?.title ?? LEGAL_DOCUMENT_LABELS[documentType],
        subtitle: source?.subtitle ?? undefined,
        content:
          source?.content ?? `<p>${LEGAL_DOCUMENT_LABELS[documentType]}</p>`,
      },
      fromVersionId && source && !source.isCurrent ? source.id : null,
    );
  }

  /** Discards a draft. Only ever a draft. */
  async deleteDraft(
    documentType: LegalDocumentType,
  ): Promise<{ success: true; deletedVersionId: string }> {
    const draft = await this.prisma.legalDocumentVersion.findFirst({
      where: { documentType, status: LegalDocumentStatus.DRAFT },
      select: { id: true },
    });
    if (!draft) throw new NotFoundException('There is no draft to discard.');
    await this.prisma.legalDocumentVersion.deleteMany({
      where: { id: draft.id, status: LegalDocumentStatus.DRAFT },
    });
    return { success: true, deletedVersionId: draft.id };
  }

  // ── Publishing ───────────────────────────────────────────────────────────

  /**
   * Makes the draft the live version, notifying users or not.
   *
   * One transaction under the document's advisory lock: archive the current
   * row, stamp the draft. If a quick notify published a version after this
   * draft reserved its number, the draft is renumbered above it so version
   * numbers stay in publication order.
   */
  async publishDraft(
    documentType: LegalDocumentType,
    adminId: string,
    dto: PublishLegalDraftDto,
  ): Promise<AdminLegalVersion> {
    const changeSummary = this.resolveSummary(
      dto.changeSummary,
      dto.notifyUsers,
    );
    const now = new Date();
    const effectiveAt = this.resolveEffectiveAt(dto.effectiveAt, now);

    const published = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${this.lockKey(documentType)})`;

      const draft = await tx.legalDocumentVersion.findFirst({
        where: { documentType, status: LegalDocumentStatus.DRAFT },
        select: { id: true, versionNumber: true },
      });
      if (!draft) {
        throw new NotFoundException(
          'There is no draft to publish for this document.',
        );
      }

      const highestOther = await tx.legalDocumentVersion.findFirst({
        where: { documentType, id: { not: draft.id } },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const versionNumber =
        highestOther && highestOther.versionNumber >= draft.versionNumber
          ? highestOther.versionNumber + 1
          : draft.versionNumber;

      await this.archiveCurrent(tx, documentType);

      return tx.legalDocumentVersion.update({
        where: { id: draft.id },
        data: {
          versionNumber,
          status: LegalDocumentStatus.PUBLISHED,
          isCurrent: true,
          requiresAcknowledgement: dto.notifyUsers,
          changeSummary,
          effectiveAt,
          publishedById: adminId,
          publishedAt: now,
        },
        select: VERSION_SELECT,
      });
    });

    await this.consent.invalidatePublishedEverywhere();
    this.logger.log(
      `legal.published type=${documentType} version=${published.versionNumber} ` +
        `admin=${adminId} notify=${published.requiresAcknowledgement}`,
    );
    return published;
  }

  /**
   * Puts the update screen in front of users for documents whose live text is
   * unchanged here: publishes a notified copy of each current version.
   *
   * Locks are taken in a fixed order, so overlapping notifies cannot deadlock;
   * the cooldown is checked under them, so a double click's second request
   * waits for the first to commit, sees its row, and gets a 409.
   */
  async notify(
    adminId: string,
    dto: NotifyLegalUpdateDto,
  ): Promise<{ versions: AdminLegalVersion[] }> {
    const types = LEGAL_DOCUMENT_TYPES.filter((t) =>
      dto.documentTypes.includes(t),
    );
    if (types.length === 0 || types.length !== dto.documentTypes.length) {
      throw new BadRequestException('Choose at least one valid document.');
    }
    const changeSummary = this.resolveSummary(dto.changeSummary, true);
    const now = new Date();
    const effectiveAt = this.resolveEffectiveAt(dto.effectiveAt, now);

    const versions = await this.prisma.$transaction(async (tx) => {
      for (const type of types) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${this.lockKey(type)})`;
      }

      // Every check before any write, so a refusal leaves nothing half-done.
      const sources = await tx.legalDocumentVersion.findMany({
        where: { documentType: { in: types }, isCurrent: true },
        select: {
          id: true,
          documentType: true,
          title: true,
          subtitle: true,
          content: true,
        },
      });
      const missing = types.filter(
        (t) => !sources.some((s) => s.documentType === t),
      );
      if (missing.length > 0) {
        throw new BadRequestException(
          `There is no published version of ${missing
            .map((t) => LEGAL_DOCUMENT_LABELS[t])
            .join(', ')} to notify users about.`,
        );
      }

      const recent = await tx.legalDocumentVersion.findMany({
        where: {
          documentType: { in: types },
          requiresAcknowledgement: true,
          publishedAt: {
            gt: new Date(now.getTime() - LEGAL_NOTIFY_COOLDOWN_MS),
          },
        },
        select: { documentType: true },
      });
      if (recent.length > 0) {
        const labels = [...new Set(recent.map((r) => r.documentType))].map(
          (t) => LEGAL_DOCUMENT_LABELS[t],
        );
        throw new ConflictException(
          `Users were just notified about ${labels.join(', ')}. Wait a minute before sending another notice.`,
        );
      }

      const created: AdminLegalVersion[] = [];
      for (const source of types.flatMap(
        (t) => sources.find((s) => s.documentType === t) ?? [],
      )) {
        const type = source.documentType;
        const versionNumber = await this.nextVersionNumber(type, tx);
        await this.archiveCurrent(tx, type);
        created.push(
          await tx.legalDocumentVersion.create({
            data: {
              documentType: type,
              versionNumber,
              title: source.title,
              subtitle: source.subtitle,
              content: source.content,
              status: LegalDocumentStatus.PUBLISHED,
              isCurrent: true,
              requiresAcknowledgement: true,
              changeSummary,
              effectiveAt,
              createdById: adminId,
              publishedById: adminId,
              publishedAt: now,
              restoredFromVersionId: source.id,
            },
            select: VERSION_SELECT,
          }),
        );
      }
      return created;
    });

    await this.consent.invalidatePublishedEverywhere();
    this.logger.log(
      `legal.notified admin=${adminId} ` +
        versions.map((v) => `${v.documentType}=v${v.versionNumber}`).join(' '),
    );
    return { versions };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private statsFor(
    versionId: string,
    acknowledged: Map<string, number>,
    totalActiveUsers: number,
  ): AcceptanceStats {
    return {
      acknowledged: Math.min(
        acknowledged.get(versionId) ?? 0,
        totalActiveUsers,
      ),
      totalActiveUsers,
    };
  }

  /**
   * Acceptances per version, over the same population as the denominator, so
   * a banned or deleted account's acceptance cannot push a bar past 100%.
   */
  private async countAcknowledged(
    versionIds: string[],
  ): Promise<Map<string, number>> {
    const groups = await this.prisma.legalAcknowledgement.groupBy({
      by: ['versionId'],
      where: { versionId: { in: versionIds }, user: ACTIVE_USER_WHERE },
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.versionId, g._count._all]));
  }

  /**
   * Retires whatever is live. `updateMany`: if a past bug ever left two rows
   * current, this clears both.
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

  /** Counts across every status, so a draft's reserved number is never reused. */
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

  /** Required (10–500) when users are notified; optional otherwise. */
  private resolveSummary(
    value: string | undefined,
    required: boolean,
  ): string | null {
    const summary = value?.trim() ?? '';
    if (!summary) {
      if (required) {
        throw new BadRequestException(
          'Describe what changed — it is shown to users on the update screen.',
        );
      }
      return null;
    }
    if (summary.length < SUMMARY_MIN || summary.length > SUMMARY_MAX) {
      throw new BadRequestException(
        `Describe what changed in ${SUMMARY_MIN} to ${SUMMARY_MAX} characters.`,
      );
    }
    return summary;
  }

  /** Defaults to now; refuses an unparseable date or one > 90 days ahead. */
  private resolveEffectiveAt(value: string | undefined, now: Date): Date {
    if (!value) return now;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('The effective date is not a valid date.');
    }
    if (parsed.getTime() - now.getTime() > LEGAL_MAX_EFFECTIVE_AHEAD_MS) {
      throw new BadRequestException(
        'The effective date can be at most 90 days from today.',
      );
    }
    return parsed;
  }
}
