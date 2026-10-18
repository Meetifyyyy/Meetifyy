import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LegalDocumentStatus, LegalDocumentType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  LegalConsentService,
  type PublishedLegalVersion,
} from '../common/legal/legal-consent.service';
import {
  LEGAL_DOCUMENT_LABELS,
  LEGAL_DOCUMENT_PATHS,
} from '../common/legal/legal.constants';

/** What a public legal page renders. */
export interface PublicLegalDocument {
  documentType: LegalDocumentType;
  label: string;
  path: string;
  versionId: string;
  versionNumber: number;
  title: string;
  subtitle: string | null;
  content: string;
  effectiveAt: Date | null;
  publishedAt: Date | null;
  lastUpdatedAt: Date | null;
  requiresAcknowledgement: boolean;
}

/** One entry in a document's public version history. Never a draft. */
export interface PublicLegalVersionSummary {
  versionId: string;
  versionNumber: number;
  title: string;
  effectiveAt: Date | null;
  publishedAt: Date | null;
  changeSummary: string | null;
  isCurrent: boolean;
}

/** One past (or the current) published version, with its text. */
export interface PublicLegalVersion extends PublicLegalVersionSummary {
  documentType: LegalDocumentType;
  label: string;
  path: string;
  subtitle: string | null;
  content: string;
}

/** Cached derived reads: valid while the consent cache generation matches. */
interface CacheEntry<T> {
  value: T;
  generation: number;
  expiresAt: number;
}

/**
 * The read side of the legal-document system: what is published, its public
 * history, and what the signed-in user still has to accept.
 *
 * Writes live in `AdminLegalService`, behind `AdminJwtGuard`. Nothing here can
 * change a document. The frontend's `legalDocuments.js` is only a fallback the
 * website shows if this API cannot be reached.
 *
 * Every read here is served from `LegalConsentService`'s in-process cache of the
 * currently published versions rather than from the database. These four
 * documents change when an admin publishes and are otherwise identical for
 * every reader, so querying per request meant the public Terms page paid an
 * ~80ms cross-region round trip for text that had not changed in weeks. The
 * cache is invalidated by publish and rollback, so a reader never sees stale
 * text after a change.
 */
@Injectable()
export class LegalService {
  private readonly logger = new Logger(LegalService.name);

  /** Bounded: four documents, a handful of versions each. */
  private static readonly HISTORY_TTL_MS = 5 * 60 * 1000;
  private static readonly MAX_VERSION_ENTRIES = 64;
  private readonly historyCache = new Map<
    LegalDocumentType,
    CacheEntry<PublicLegalVersionSummary[]>
  >();
  private readonly versionCache = new Map<
    string,
    CacheEntry<PublicLegalVersion | null>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: LegalConsentService,
  ) {}

  private fresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
    return (
      !!entry &&
      entry.expiresAt > Date.now() &&
      entry.generation === this.consent.publishedCacheGeneration()
    );
  }

  private entry<T>(value: T, generation: number): CacheEntry<T> {
    return {
      value,
      generation,
      expiresAt: Date.now() + LegalService.HISTORY_TTL_MS,
    };
  }

  /**
   * Every published or archived version of one document, newest first,
   * without bodies. Drafts are excluded by the query, never filtered later.
   *
   * Cached per document and dropped whenever a publish invalidates the
   * consent cache (on any instance), so a new version appears at once.
   */
  async listVersions(
    documentType: LegalDocumentType,
  ): Promise<PublicLegalVersionSummary[]> {
    const cached = this.historyCache.get(documentType);
    if (this.fresh(cached)) return cached.value;

    const generation = this.consent.publishedCacheGeneration();
    const rows = await this.prisma.legalDocumentVersion.findMany({
      where: { documentType, status: { not: LegalDocumentStatus.DRAFT } },
      orderBy: { versionNumber: 'desc' },
      select: {
        id: true,
        versionNumber: true,
        title: true,
        effectiveAt: true,
        publishedAt: true,
        changeSummary: true,
        isCurrent: true,
      },
    });
    const value = rows.map((r) => ({
      versionId: r.id,
      versionNumber: r.versionNumber,
      title: r.title,
      effectiveAt: r.effectiveAt,
      publishedAt: r.publishedAt,
      changeSummary: r.changeSummary,
      isCurrent: r.isCurrent,
    }));
    this.historyCache.set(documentType, this.entry(value, generation));
    return value;
  }

  /** One published or archived version in full. 404 for a draft or unknown. */
  async getVersion(
    documentType: LegalDocumentType,
    versionNumber: number,
  ): Promise<PublicLegalVersion> {
    const key = `${documentType}:${versionNumber}`;
    const cached = this.versionCache.get(key);
    let value: PublicLegalVersion | null;
    if (this.fresh(cached)) {
      value = cached.value;
    } else {
      const generation = this.consent.publishedCacheGeneration();
      const row = await this.prisma.legalDocumentVersion.findFirst({
        where: {
          documentType,
          versionNumber,
          status: { not: LegalDocumentStatus.DRAFT },
        },
        select: {
          id: true,
          versionNumber: true,
          title: true,
          subtitle: true,
          content: true,
          effectiveAt: true,
          publishedAt: true,
          changeSummary: true,
          isCurrent: true,
        },
      });
      value = row
        ? {
            documentType,
            label: LEGAL_DOCUMENT_LABELS[documentType],
            path: LEGAL_DOCUMENT_PATHS[documentType],
            versionId: row.id,
            versionNumber: row.versionNumber,
            title: row.title,
            subtitle: row.subtitle,
            content: row.content,
            effectiveAt: row.effectiveAt,
            publishedAt: row.publishedAt,
            changeSummary: row.changeSummary,
            isCurrent: row.isCurrent,
          }
        : null;
      if (this.versionCache.size >= LegalService.MAX_VERSION_ENTRIES) {
        const oldest = this.versionCache.keys().next().value;
        if (oldest !== undefined) this.versionCache.delete(oldest);
      }
      this.versionCache.set(key, this.entry(value, generation));
    }
    if (!value) throw new NotFoundException('That version does not exist.');
    return value;
  }

  private toPublic(row: PublishedLegalVersion): PublicLegalDocument {
    return {
      documentType: row.documentType,
      label: LEGAL_DOCUMENT_LABELS[row.documentType],
      path: LEGAL_DOCUMENT_PATHS[row.documentType],
      versionId: row.id,
      versionNumber: row.versionNumber,
      title: row.title,
      subtitle: row.subtitle,
      content: row.content,
      effectiveAt: row.effectiveAt,
      publishedAt: row.publishedAt,
      // "Last updated" is when this text became the live one, which is what a
      // reader means by the phrase. `updatedAt` would be wrong: it moves when a
      // row is touched for any reason and a published row is never edited.
      lastUpdatedAt: row.publishedAt,
      requiresAcknowledgement: row.requiresAcknowledgement,
    };
  }

  /** The currently published version of one document. */
  async getPublished(
    documentType: LegalDocumentType,
  ): Promise<PublicLegalDocument> {
    const row = await this.consent.getPublishedVersion(documentType);
    if (!row) {
      // Only reachable if a document has never been published at all. The four
      // shipped documents are seeded by migration, so this means someone added
      // a new enum member and has not published its first version yet.
      throw new NotFoundException('That document has not been published yet.');
    }
    return this.toPublic(row);
  }

  /** Every published document, without the bodies — an index for footers/menus. */
  async listPublished(): Promise<Omit<PublicLegalDocument, 'content'>[]> {
    const rows = await this.consent.getPublishedVersions();
    return rows.map((row) => {
      // The bodies are dropped rather than not fetched: this is an index for
      // footers and menus, and the cache holds one copy for every consumer.
      const { content, ...rest } = this.toPublic(row);
      return rest;
    });
  }

  /**
   * Everything the client needs to decide whether to show the consent flow.
   *
   * Returns the full documents, not just their ids: the modal has to let the
   * user read what they are accepting without leaving the flow, and a second
   * round trip per document would mean a modal that renders before it can show
   * anything.
   */
  async getConsentState(userId: string): Promise<{
    satisfied: boolean;
    pending: PublicLegalDocument[];
  }> {
    const pending = await this.consent.getPendingVersions(userId);
    if (pending.length === 0) return { satisfied: true, pending: [] };

    // The pending rows already carry their bodies — they come from the same
    // cache the public pages read — so the consent modal renders without a
    // second query, and without a second round trip per document.
    return {
      satisfied: false,
      pending: pending.map((row) => ({
        ...this.toPublic(row),
        changeSummary: row.changeSummary,
      })),
    };
  }

  /**
   * Records that `userId` accepted the given versions.
   *
   * Three properties this deliberately has:
   *
   *   - It ignores whatever the client sent and re-derives the pending list
   *     server-side. A client that posted an old version id, or a version that
   *     was never required, must not be able to clear the gate with it.
   *   - `createMany({ skipDuplicates })` makes it idempotent: a double-clicked
   *     button, a retry after a network failure, or two tabs accepting at the
   *     same moment all converge on one row per (user, version), and the second
   *     caller still gets a success rather than a confusing error.
   *   - It never updates an existing row. A user who accepted v3 keeps their v3
   *     record forever; accepting v4 adds a row.
   */
  async acknowledge(
    userId: string,
    versionIds: string[],
    context: { ip?: string | null; userAgent?: string | null } = {},
  ): Promise<{ satisfied: boolean; acknowledged: string[] }> {
    const required = await this.consent.getRequiredVersions();
    const requiredIds = new Set(required.map((v) => v.id));

    // Accept only ids that are actually required right now. Anything else is
    // either stale (the version was superseded between render and click) or
    // forged, and neither should create a record.
    const targets = required.filter((v) => versionIds.includes(v.id));

    if (targets.length > 0) {
      await this.prisma.legalAcknowledgement.createMany({
        data: targets.map((v) => ({
          userId,
          documentType: v.documentType,
          versionId: v.id,
          versionNumber: v.versionNumber,
          ip: context.ip ?? null,
          // Truncated to the column width rather than rejected: a long UA must
          // never be the reason an acceptance fails to record.
          userAgent: context.userAgent ? context.userAgent.slice(0, 300) : null,
        })),
        skipDuplicates: true,
      });
    }

    // Re-read rather than assume. The client's next request is refused or
    // allowed on what the database says, so that is what the response must
    // report — including the case where the user accepted only some of the
    // required documents and is still gated.
    const stillPending = await this.consent.getPendingVersions(userId);
    const satisfied = stillPending.length === 0;

    if (satisfied) {
      // Lets the very next request through without waiting for the cache TTL,
      // which is what makes "I Agree" feel instant instead of intermittently
      // bouncing the user back into the modal.
      this.consent.markSatisfied(userId, [...requiredIds]);
    } else {
      this.consent.invalidateUser(userId);
    }

    return { satisfied, acknowledged: targets.map((v) => v.id) };
  }

  /**
   * The user's own consent history — every version they have ever accepted.
   *
   * Reading it is deliberately available to the user themselves: it is their
   * record of what they agreed to and when, and a consent regime the subject
   * cannot inspect is not much of one.
   */
  async getHistory(userId: string) {
    const rows = await this.prisma.legalAcknowledgement.findMany({
      where: { userId },
      orderBy: { acknowledgedAt: 'desc' },
      select: {
        documentType: true,
        versionNumber: true,
        acknowledgedAt: true,
        version: { select: { title: true, effectiveAt: true } },
      },
    });
    return rows.map((row) => ({
      documentType: row.documentType,
      label: LEGAL_DOCUMENT_LABELS[row.documentType],
      versionNumber: row.versionNumber,
      title: row.version.title,
      effectiveAt: row.version.effectiveAt,
      acknowledgedAt: row.acknowledgedAt,
    }));
  }
}
