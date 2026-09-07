import { Injectable, Logger } from '@nestjs/common';
import { LegalDocumentType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * A currently published version, exactly as the public pages and the consent
 * flow serve it. The body is included: there are four of these and they total
 * a few tens of kilobytes, so holding them costs nothing next to paying a
 * cross-region database round trip for every reader.
 */
export interface PublishedLegalVersion {
  id: string;
  documentType: LegalDocumentType;
  versionNumber: number;
  title: string;
  subtitle: string | null;
  content: string;
  requiresAcknowledgement: boolean;
  changeSummary: string | null;
  effectiveAt: Date | null;
  publishedAt: Date | null;
}

/** One published version a user must accept before continuing. */
export type RequiredLegalVersion = PublishedLegalVersion;

/**
 * The single source of truth for "is this user allowed to continue using
 * Meetifyy".
 *
 * Every surface that asks the question — `JwtGuard`, the realtime gateway, the
 * profile sync, the consent API — asks this service, for the same reason the
 * first-year policy has exactly one owner: two implementations of "has this
 * user accepted the current Terms" will eventually disagree, and the one that
 * says yes is the one that lets someone past.
 *
 * ── Why it caches ─────────────────────────────────────────────────────────
 * `JwtGuard` runs on every authenticated request and the public Terms page is
 * linked from the landing footer, so a naive implementation pays a database
 * round trip for both. Against Supabase that round trip measured ~80ms — the
 * entire cost of serving a legal page, with the application code contributing
 * essentially nothing. Two caches remove it:
 *
 *   1. Every currently published version, bodies included. Identical for every
 *      reader, changes only when an admin publishes, and totals a few tens of
 *      kilobytes. `getRequiredVersions()` is a filter over this same list, so
 *      the gate and the public pages share one read. Invalidated outright by
 *      `invalidatePublished()` on publish/rollback. In the overwhelmingly
 *      common case nothing requires acknowledgement, and the guard then does no
 *      per-user work at all.
 *   2. Per user, whether they have satisfied a specific list. Keyed by a
 *      signature of the required version ids, so publishing a new required
 *      version invalidates every user's entry implicitly — no cache stampede to
 *      coordinate, and no way for a stale "satisfied" to survive a new
 *      requirement.
 *
 * Both are in-process. Multiple instances therefore converge within the TTL
 * rather than instantly, which is the correct trade for a gate that is checked
 * on every request: the failure mode of a few seconds' lag is that a user is
 * asked to accept a moment later than they might have been, never that an
 * acknowledgement is lost or a requirement skipped.
 */
@Injectable()
export class LegalConsentService {
  private readonly logger = new Logger(LegalConsentService.name);

  private published: PublishedLegalVersion[] | null = null;
  private publishedExpireAt = 0;
  private publishedInFlight: Promise<PublishedLegalVersion[]> | null = null;
  /**
   * A backstop only — publish and rollback invalidate explicitly. It exists so
   * a second instance that did not handle the publish still converges, and so a
   * cache can never be wrong indefinitely because an invalidation was missed.
   */
  private static readonly PUBLISHED_TTL_MS = 60 * 1000;

  private readonly satisfied = new Map<
    string,
    { signature: string; expiresAt: number }
  >();
  private static readonly SATISFIED_TTL_MS = 5 * 60 * 1000;
  private static readonly MAX_SATISFIED_ENTRIES = 20000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every currently published version whose acceptance is mandatory.
   *
   * `isCurrent` is part of the predicate, not just `requiresAcknowledgement`:
   * a superseded version stops being required the moment a new one replaces it,
   * so a user cannot be trapped behind a document nobody is served any more.
   */
  async getPublishedVersions(): Promise<PublishedLegalVersion[]> {
    const now = Date.now();
    if (this.published && this.publishedExpireAt > now) {
      return this.published;
    }
    // Single-flight: a cold cache under load must produce one query, not one
    // per concurrent reader.
    if (this.publishedInFlight) return this.publishedInFlight;

    this.publishedInFlight = this.prisma.legalDocumentVersion
      .findMany({
        where: { isCurrent: true },
        select: {
          id: true,
          documentType: true,
          versionNumber: true,
          title: true,
          subtitle: true,
          content: true,
          requiresAcknowledgement: true,
          changeSummary: true,
          effectiveAt: true,
          publishedAt: true,
        },
        orderBy: { documentType: 'asc' },
      })
      .then((rows) => {
        this.published = rows;
        this.publishedExpireAt =
          Date.now() + LegalConsentService.PUBLISHED_TTL_MS;
        return rows;
      })
      .catch((error) => {
        // A database blip must not lock the whole user base out of the product.
        // Failing open here matches `resolveAccountStatus` in JwtGuard: the gate
        // is a restriction, and an unavailable restriction is not an outage.
        this.logger.warn(
          `legal published lookup failed: ${(error as Error).message}`,
        );
        return this.published ?? [];
      })
      .finally(() => {
        this.publishedInFlight = null;
      });

    return this.publishedInFlight;
  }

  /** The published version of one document, or null. Served from cache. */
  async getPublishedVersion(
    documentType: LegalDocumentType,
  ): Promise<PublishedLegalVersion | null> {
    const all = await this.getPublishedVersions();
    return all.find((v) => v.documentType === documentType) ?? null;
  }

  async getRequiredVersions(): Promise<RequiredLegalVersion[]> {
    const all = await this.getPublishedVersions();
    return all.filter((v) => v.requiresAcknowledgement);
  }

  /**
   * The versions `userId` still has to accept, in presentation order.
   *
   * Empty means the user is clear. One call answers the whole question for
   * every document at once, which is what keeps the client to a single modal
   * covering all of them rather than one per document.
   */
  async getPendingVersions(userId: string): Promise<RequiredLegalVersion[]> {
    const required = await this.getRequiredVersions();
    if (required.length === 0) return [];

    const accepted = await this.prisma.legalAcknowledgement.findMany({
      where: { userId, versionId: { in: required.map((v) => v.id) } },
      select: { versionId: true },
    });
    const acceptedIds = new Set(accepted.map((a) => a.versionId));
    return required.filter((v) => !acceptedIds.has(v.id));
  }

  /**
   * Whether the user may use Meetifyy, answered from cache where possible.
   *
   * The cached entry records WHICH requirement list was satisfied. A user who
   * cleared yesterday's list is not treated as clearing today's, so publishing
   * a new required version takes effect for everyone without touching the cache.
   */
  async isSatisfied(userId: string): Promise<boolean> {
    const required = await this.getRequiredVersions();
    if (required.length === 0) return true;

    const signature = required
      .map((v) => v.id)
      .sort()
      .join('|');

    const now = Date.now();
    const cached = this.satisfied.get(userId);
    if (cached && cached.signature === signature && cached.expiresAt > now) {
      return true;
    }

    let acceptedCount: number;
    try {
      acceptedCount = await this.prisma.legalAcknowledgement.count({
        where: { userId, versionId: { in: required.map((v) => v.id) } },
      });
    } catch (error) {
      this.logger.warn(
        `legal acknowledgement lookup failed user=${userId} error=${(error as Error).message}`,
      );
      // Fails open, for the same reason getRequiredVersions does.
      return true;
    }

    if (acceptedCount >= required.length) {
      this.rememberSatisfied(userId, signature, now);
      return true;
    }

    // Never cache a negative: the user is about to accept, and a cached "no"
    // would keep refusing them for the rest of the TTL after they had.
    this.satisfied.delete(userId);
    return false;
  }

  /**
   * Records a new account's agreement to the documents it accepted at signup.
   *
   * The signup form asks the user to agree to the Terms and the Privacy Policy
   * before it will proceed. Without this, that agreement left no trace: the
   * versions in force at signup usually do not require acknowledgement, so the
   * user is never asked again and the platform holds no record of what they
   * accepted — which is the exact gap the acknowledgement table exists to close.
   *
   * Insert-only and idempotent, like every other write to this table. Failures
   * are swallowed deliberately: a consent row that could not be written must
   * not be the reason an account creation fails, and the gate re-asks anyone
   * whose record is missing the moment a version requires it.
   */
  async recordSignupConsent(
    userId: string,
    context: { ip?: string | null; userAgent?: string | null } = {},
  ): Promise<void> {
    try {
      const published = (await this.getPublishedVersions()).filter(
        (v) =>
          v.documentType === LegalDocumentType.TERMS_OF_SERVICE ||
          v.documentType === LegalDocumentType.PRIVACY_POLICY,
      );
      if (published.length === 0) return;

      await this.prisma.legalAcknowledgement.createMany({
        data: published.map((v) => ({
          userId,
          documentType: v.documentType,
          versionId: v.id,
          versionNumber: v.versionNumber,
          ip: context.ip ?? null,
          userAgent: context.userAgent ? context.userAgent.slice(0, 300) : null,
        })),
        skipDuplicates: true,
      });
    } catch (error) {
      this.logger.warn(
        `signup consent not recorded user=${userId} error=${(error as Error).message}`,
      );
    }
  }

  /** Called after an acknowledgement lands, so the next request is not refused. */
  markSatisfied(userId: string, requiredVersionIds: string[]): void {
    this.rememberSatisfied(
      userId,
      [...requiredVersionIds].sort().join('|'),
      Date.now(),
    );
  }

  /**
   * Drops the published-document cache. Called by every publish and rollback,
   * so both the new text and any new requirement apply at once rather than at
   * the end of the TTL.
   */
  invalidatePublished(): void {
    this.published = null;
    this.publishedExpireAt = 0;
    // The per-user entries carry the OLD signature and can never match the new
    // list, so they do not need clearing — they expire on their own.
  }

  /** Drops one user's cached answer. Used when their acknowledgements change. */
  invalidateUser(userId: string): void {
    this.satisfied.delete(userId);
  }

  private rememberSatisfied(
    userId: string,
    signature: string,
    now: number,
  ): void {
    if (this.satisfied.size >= LegalConsentService.MAX_SATISFIED_ENTRIES) {
      for (const [key, value] of this.satisfied.entries()) {
        if (value.expiresAt <= now) this.satisfied.delete(key);
      }
      if (this.satisfied.size >= LegalConsentService.MAX_SATISFIED_ENTRIES) {
        const oldest = this.satisfied.keys().next().value;
        if (oldest) this.satisfied.delete(oldest);
      }
    }
    this.satisfied.set(userId, {
      signature,
      expiresAt: now + LegalConsentService.SATISFIED_TTL_MS,
    });
  }
}
