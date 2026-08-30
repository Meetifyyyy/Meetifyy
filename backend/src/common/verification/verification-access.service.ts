import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { VerificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventService } from '../../events/domain-event.service';

/**
 * The single place that answers "is this account allowed to take part in a
 * gated action right now?".
 *
 * Both the `@VerifiedOnly()` guard (which only ever sees the *caller*) and the
 * messaging services (which must also judge the people on the other side of a
 * conversation) resolve the question through here, so there is exactly one
 * definition of eligibility and one feature flag controlling it.
 */
@Injectable()
export class VerificationAccessService {
  /**
   * Verification status, cached in process.
   *
   * Every `@VerifiedOnly()` request used to cost one `user.findUnique`, and the
   * status is not on the JWT — the guard has no request-scoped user row to
   * reuse, because JwtGuard verifies the token locally and never touches the
   * database. Left alone that put a round-trip in front of every gated action,
   * including per-keystroke ones like typing indicators.
   *
   * This is safe to cache only because invalidation is PUSH-based, not TTL-based:
   * `announceStatusChange` evicts the entry on the instance that made the change
   * and publishes a domain event that every other instance turns into an
   * eviction (RealtimeGateway.handleDomainEvent). The TTL below is a backstop
   * for a dropped pub/sub message, not the mechanism — so a revoked user is
   * refused on their very next request in the normal case, and within
   * STATUS_TTL_MS in the pathological one.
   */
  private static readonly statusCache = new Map<
    string,
    { status: VerificationStatus | null; expiresAt: number }
  >();
  private static readonly STATUS_TTL_MS = 30_000;
  private static readonly STATUS_CACHE_MAX = 20_000;

  /**
   * Refusals are logged so a run of them is visible in the normal log stream —
   * a client repeatedly hitting gated endpoints with an ineligible account is
   * either a stale tab or someone probing, and both are worth seeing. Ids only.
   */
  private readonly logger = new Logger(VerificationAccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly domainEventService: DomainEventService,
  ) {}

  /** Drops a user's cached status. Called on every status change, everywhere. */
  invalidate(userId: string): void {
    if (userId) VerificationAccessService.statusCache.delete(userId);
  }

  /** Test seam: clears the whole cache. */
  invalidateAll(): void {
    VerificationAccessService.statusCache.clear();
  }

  private readCache(userId: string): VerificationStatus | null | undefined {
    const hit = VerificationAccessService.statusCache.get(userId);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      VerificationAccessService.statusCache.delete(userId);
      return undefined;
    }
    return hit.status;
  }

  private writeCache(userId: string, status: VerificationStatus | null): void {
    const cache = VerificationAccessService.statusCache;
    if (cache.size >= VerificationAccessService.STATUS_CACHE_MAX) {
      const now = Date.now();
      for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
      if (cache.size >= VerificationAccessService.STATUS_CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
    }
    cache.set(userId, {
      status,
      expiresAt: Date.now() + VerificationAccessService.STATUS_TTL_MS,
    });
  }

  /**
   * The kill switch the guard has always honoured. Kept here so the guard and
   * the messaging checks can never disagree about whether gating is on: a
   * deployment with verification disabled must not still block DMs.
   */
  isEnforcementEnabled(): boolean {
    return process.env.FEATURE_VERIFICATION_ENABLED !== 'false';
  }

  /**
   * VERIFIED is the only eligible state. PENDING, UNVERIFIED, REJECTED and
   * RESUBMISSION_REQUIRED all restrict access — a submitted-but-unreviewed
   * account is not yet trusted.
   */
  isEligibleStatus(status: VerificationStatus | null | undefined): boolean {
    return status === VerificationStatus.VERIFIED;
  }

  /** Eligibility for one account. */
  async isUserEligible(userId: string): Promise<boolean> {
    if (!this.isEnforcementEnabled()) return true;
    if (!userId) return false;

    const cached = this.readCache(userId);
    if (cached !== undefined) return this.isEligibleStatus(cached);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { verificationStatus: true },
    });
    const status = user?.verificationStatus ?? null;
    this.writeCache(userId, status);
    return this.isEligibleStatus(status);
  }

  /**
   * Eligibility for many accounts in one query.
   *
   * A user id that does not resolve to a row is reported as ineligible rather
   * than omitted, so callers cannot mistake "unknown" for "allowed".
   */
  async getEligibilityMap(userIds: string[]): Promise<Map<string, boolean>> {
    const unique = Array.from(new Set((userIds || []).filter(Boolean)));
    const map = new Map<string, boolean>();
    if (unique.length === 0) return map;

    if (!this.isEnforcementEnabled()) {
      unique.forEach((id) => map.set(id, true));
      return map;
    }

    // Only the ids we do not already hold reach the database. In a DM send —
    // the hottest path — the sender is almost always cached from the guard
    // that ran moments earlier on the same request, so this usually queries
    // one row instead of two, and often none.
    const missing: string[] = [];
    for (const id of unique) {
      const cached = this.readCache(id);
      if (cached === undefined) missing.push(id);
      else map.set(id, this.isEligibleStatus(cached));
    }

    if (missing.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: missing } },
        select: { id: true, verificationStatus: true },
      });
      const byId = new Map(users.map((u) => [u.id, u.verificationStatus]));
      for (const id of missing) {
        const status = byId.get(id) ?? null;
        this.writeCache(id, status);
        map.set(id, this.isEligibleStatus(status));
      }
    }
    return map;
  }

  /** The subset of `userIds` that may not currently take part in messaging. */
  async getIneligibleUserIds(userIds: string[]): Promise<string[]> {
    const map = await this.getEligibilityMap(userIds);
    return Array.from(map.entries())
      .filter(([, eligible]) => !eligible)
      .map(([id]) => id);
  }

  /**
   * Throws unless every listed account is eligible.
   *
   * The message deliberately does not say *which* participant failed: to the
   * person being refused, "this user is not available for messaging" is the
   * whole truth they are entitled to, and naming the other side would leak
   * that account's verification state. The caller's own case gets the wording
   * the rest of the app already uses for `@VerifiedOnly()`.
   */
  async assertUsersEligible(
    userIds: string[],
    actorId?: string,
  ): Promise<void> {
    if (!this.isEnforcementEnabled()) return;
    const ineligible = await this.getIneligibleUserIds(userIds);
    if (ineligible.length === 0) return;

    if (actorId && ineligible.includes(actorId)) {
      this.logger.warn(`verification:refused actor=${actorId} reason=self`);
      throw new ForbiddenException(
        'Account verification is required to perform this action.',
      );
    }
    this.logger.warn(
      `verification:refused actor=${actorId ?? 'unknown'} reason=counterparty ` +
        `count=${ineligible.length}`,
    );
    throw new ForbiddenException('This user is not available for messaging.');
  }

  /**
   * The choke point for an existing conversation.
   *
   * A DM needs *both* sides eligible. A group needs the sender eligible — a
   * group must not go silent for everyone because one member's verification
   * lapsed, and members are separately gated when they are added.
   *
   * `conversationId` must already be resolved to the internal id; every
   * messaging service resolves it before reaching here.
   */
  async assertCanMessageInConversation(
    conversationId: string,
    senderId: string,
    participantUserIds: string[],
    isGroup: boolean,
  ): Promise<void> {
    if (!this.isEnforcementEnabled()) return;
    const required = isGroup
      ? [senderId]
      : Array.from(new Set([senderId, ...(participantUserIds || [])]));
    await this.assertUsersEligible(required, senderId);
  }

  /**
   * Tells the people who can see it that an account's eligibility changed.
   *
   * Verification is reviewed out-of-band (an admin approves or rejects, or the
   * user submits and drops to PENDING), so without this the other side of an
   * open conversation would keep a live composer pointed at someone the server
   * has already started refusing — and would only find out by having a message
   * bounce. The event goes to the user themselves (their own composer and
   * their cached profile) and to everyone they hold a DM with.
   *
   * Fire-and-forget: a failure to announce must never fail the review itself.
   * The next fetch is still correct, because the payloads are computed from
   * the database.
   */
  async announceStatusChange(
    userId: string,
    status: VerificationStatus,
  ): Promise<void> {
    if (!userId) return;
    // Evict before announcing: this instance must never serve the old status
    // to a request that arrives between the write and the fan-out.
    this.invalidate(userId);
    try {
      const dmPartners = await this.prisma.conversationParticipant.findMany({
        where: {
          userId: { not: userId },
          conversation: {
            type: 'DM',
            participants: { some: { userId } },
          },
        },
        select: { userId: true },
      });

      const targets = Array.from(
        new Set([userId, ...dmPartners.map((p) => p.userId)]),
      );

      await this.domainEventService.emit(
        'user:verification_changed',
        {
          userId,
          verificationStatus: status,
          // Precomputed so a client does not have to know the status rule.
          canMessage: this.isEligibleStatus(status),
        },
        targets,
      );
    } catch {
      // Announcement is best-effort; enforcement does not depend on it.
    }
  }
}
