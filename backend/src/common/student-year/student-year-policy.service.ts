import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  extractBatchYearFromEmail,
  extractProgrammeFromEmail,
  isPlausibleBatchYear,
} from './batch-year.util';

/**
 * FIRST-YEAR ISOLATION — the single policy every surface asks.
 * ============================================================================
 *
 * First-year students may interact only with other first-year students. The
 * rule is SYMMETRIC: a first-year and a non-first-year are invisible to each
 * other, whichever one initiates. Everyone who is not first-year keeps the
 * application's ordinary rules, unchanged.
 *
 *     canUsersInteract(a, b)  ==  isFirstYear(a) === isFirstYear(b)
 *
 * -- Where "first year" comes from -------------------------------------------
 *
 * From the VERIFIED INSTITUTIONAL EMAIL, never from a profile field the user
 * can type. `User.batchYear` is a server-derived cache of
 * `extractBatchYearFromEmail(email)`; it is written at sign-in and by the
 * backfill in the migration, and no `/api/*` endpoint accepts it as input.
 *
 * First-year status is then DERIVED, per request, from the academic year:
 *
 *     isFirstYear(user) === (user.batchYear === currentAcademicYear())
 *
 * There is deliberately no `is_first_year` column. On 1 January 2027 the 2026
 * intake stops being first-year and the 2027 intake starts, everywhere, with
 * no migration, no backfill and no scheduled job — because nothing was ever
 * written down that has to be corrected.
 *
 * -- Unresolved batches ------------------------------------------------------
 *
 * An address we cannot parse yields `null`, and `null` is NOT first-year. That
 * direction matters: the opposite default would give every malformed account a
 * first-year student's audience. An unresolved user therefore sits with the
 * non-first-year population, subject to the ordinary rules, and is invisible
 * to first-years.
 *
 * -- How to use it -----------------------------------------------------------
 *
 * Prefer the QUERY-LAYER helpers over the runtime ones wherever a list is
 * being built. `visibleUserWhere` / `visibleUserSqlPredicate` push the rule
 * into Postgres, so a restricted row is never fetched, never cached, never
 * serialized, and never shrinks a page after `take` has been applied. The
 * runtime helpers (`canUsersInteract`, `assertCanInteract`) are for guarding
 * an ACTION on ids that are already in hand.
 *
 * -- Removing the feature ----------------------------------------------------
 *
 * `FEATURE_FIRST_YEAR_ISOLATION=false` disables every check in one move: the
 * `where` fragments become `{}`, the SQL predicates become `TRUE`, and the
 * asserts return. Deleting the feature outright means deleting this directory
 * and the call sites listed in `docs/first-year-isolation.md`, which are all
 * one-line delegations for exactly that reason.
 */

/** The surfaces this policy is enforced on, as used in structured logs. */
export type PolicyFeature =
  | 'messaging'
  | 'new_message_modal'
  | 'share_modal'
  | 'invite_modal'
  | 'instant_match'
  | 'recommendations'
  | 'activity_visibility'
  | 'notifications'
  | 'search';

/** Minimum a caller must know about a user for the policy to judge them. */
export interface StudentYearSubject {
  id?: string | null;
  email?: string | null;
  collegeEmail?: string | null;
  batchYear?: number | null;
}

/** Resolved, trusted view of one participant. */
export interface StudentYearContext {
  id: string;
  batchYear: number | null;
  isFirstYear: boolean;
}

interface CachedBatch {
  batchYear: number | null;
  expiresAt: number;
}

@Injectable()
export class StudentYearPolicyService {
  private readonly logger = new Logger('StudentYearPolicy');

  /**
   * Batch year, cached in process.
   *
   * Static so every injected copy shares one map — this service is imported by
   * a dozen modules and Nest builds one instance per module, exactly as it
   * does for BlocksService.
   *
   * The TTL is generous (10 minutes) because the cached value is *immutable in
   * practice*: it is derived from the verified institutional address, and no
   * endpoint lets a user change that address. Compare
   * VerificationAccessService, whose 30s TTL exists because an admin can
   * revoke a status at any moment. The only thing that moves here is the
   * academic YEAR, which is not cached — `isFirstYearBatch` recomputes it on
   * every call, so the year rollover needs no invalidation at all.
   */
  private static readonly batchCache = new Map<string, CachedBatch>();
  private static readonly BATCH_TTL_MS = 600_000;
  private static readonly BATCH_CACHE_MAX = 20_000;

  constructor(private readonly prisma: PrismaService) {}

  // ── Feature flag & academic year ──────────────────────────────────────────

  /**
   * The kill switch. Every check in this file honours it, so a deployment with
   * the feature off behaves exactly as it did before the feature existed —
   * including inside database queries, which is the half that would otherwise
   * be missed.
   */
  isEnforcementEnabled(): boolean {
    return process.env.FEATURE_FIRST_YEAR_ISOLATION !== 'false';
  }

  /**
   * The academic year the policy is being evaluated in.
   *
   * Read from the clock, so the cohort rolls over on its own. `ACADEMIC_YEAR`
   * overrides it — that exists for tests and for a deliberate operational
   * correction (an intake labelled by a year that is not the calendar one),
   * and NOT as a place to hardcode 2026.
   */
  getCurrentAcademicYear(): number {
    const override = Number(process.env.ACADEMIC_YEAR);
    if (Number.isInteger(override) && override > 1900) return override;
    return new Date().getFullYear();
  }

  // ── Batch resolution ──────────────────────────────────────────────────────

  /**
   * The batch year for a user row already in hand.
   *
   * Order of trust: the server-derived `batchYear` column first, then a fresh
   * parse of the institutional address. The fallback is what makes the policy
   * correct for a row written before the backfill ran, and for any code path
   * that selected the email but not the column.
   *
   * A stored value that fails the plausibility bound is discarded rather than
   * trusted — the column is only ever a cache of the parse, so a value the
   * parse would not produce today is stale data, not a fact.
   */
  getUserBatchYear(
    user: StudentYearSubject | null | undefined,
    currentYear = this.getCurrentAcademicYear(),
  ): number | null {
    if (!user) return null;

    if (
      typeof user.batchYear === 'number' &&
      isPlausibleBatchYear(user.batchYear, currentYear)
    ) {
      return user.batchYear;
    }

    // `collegeEmail` is checked as well as `email` because the two are written
    // together at signup and only `collegeEmail` survives some admin flows.
    for (const address of [user.email, user.collegeEmail]) {
      const parsed = extractBatchYearFromEmail(address);
      if (parsed !== null && isPlausibleBatchYear(parsed, currentYear)) {
        return parsed;
      }
    }

    return null;
  }

  /**
   * The batch year an account should have, computed from its address alone.
   * This is what the sign-in path stamps onto `User.batchYear`; it ignores any
   * existing stored value, so a wrong one self-heals on the user's next login.
   */
  deriveBatchYearForStorage(
    email: string | null | undefined,
    currentYear = this.getCurrentAcademicYear(),
  ): number | null {
    const parsed = extractBatchYearFromEmail(email);
    if (parsed === null) {
      if (email) {
        // Ids only, and only the shape of the address — never the address
        // itself, which is personal data and would put a student's mailbox in
        // the log stream on every login.
        this.logger.debug(
          `batch:unresolved programme=${extractProgrammeFromEmail(email) ?? 'none'}`,
        );
      }
      return null;
    }
    if (!isPlausibleBatchYear(parsed, currentYear)) {
      this.logger.warn(
        `batch:implausible year=${parsed} current=${currentYear}`,
      );
      return null;
    }
    return parsed;
  }

  // ── First-year detection ──────────────────────────────────────────────────

  /**
   * The whole definition, in one line: this year's intake is first year.
   *
   * `null` — unresolved — is never first year. See the header.
   */
  isFirstYearBatch(
    batchYear: number | null | undefined,
    currentYear = this.getCurrentAcademicYear(),
  ): boolean {
    if (typeof batchYear !== 'number') return false;
    return batchYear === currentYear;
  }

  isFirstYearStudent(
    user: StudentYearSubject | null | undefined,
    currentYear = this.getCurrentAcademicYear(),
  ): boolean {
    return this.isFirstYearBatch(
      this.getUserBatchYear(user, currentYear),
      currentYear,
    );
  }

  // ── The interaction rule ──────────────────────────────────────────────────

  /**
   * Symmetric compatibility for two batch years.
   *
   * Not "a first-year may not talk to an older student" but "the first-year
   * cohort and everyone else are separate populations": the two sides are
   * compatible exactly when they agree about being first-year.
   */
  areBatchYearsCompatible(
    batchA: number | null | undefined,
    batchB: number | null | undefined,
    currentYear = this.getCurrentAcademicYear(),
  ): boolean {
    if (!this.isEnforcementEnabled()) return true;
    return (
      this.isFirstYearBatch(batchA, currentYear) ===
      this.isFirstYearBatch(batchB, currentYear)
    );
  }

  /** The same rule for two user rows. Order of the arguments is irrelevant. */
  canUsersInteract(
    userA: StudentYearSubject | null | undefined,
    userB: StudentYearSubject | null | undefined,
    currentYear = this.getCurrentAcademicYear(),
  ): boolean {
    if (!this.isEnforcementEnabled()) return true;
    return this.areBatchYearsCompatible(
      this.getUserBatchYear(userA, currentYear),
      this.getUserBatchYear(userB, currentYear),
      currentYear,
    );
  }

  /**
   * Named checks, one per surface.
   *
   * They all delegate to `canUsersInteract` and are intentionally identical:
   * the isolation rule is the same everywhere. Having a name per feature means
   * a call site reads as what it is guarding, a refusal can say which surface
   * refused, and a future change to one surface has an obvious place to go
   * without anyone re-deriving the rule.
   */
  canUserSeeUser(
    viewer: StudentYearSubject | null | undefined,
    target: StudentYearSubject | null | undefined,
    currentYear = this.getCurrentAcademicYear(),
  ): boolean {
    return this.checkFor('recommendations', viewer, target, currentYear);
  }

  canUserAppearInNewMessageModal(
    viewer: StudentYearSubject | null | undefined,
    target: StudentYearSubject | null | undefined,
    currentYear = this.getCurrentAcademicYear(),
  ): boolean {
    return this.checkFor('new_message_modal', viewer, target, currentYear);
  }

  canUserAppearInShareModal(
    viewer: StudentYearSubject | null | undefined,
    target: StudentYearSubject | null | undefined,
    currentYear = this.getCurrentAcademicYear(),
  ): boolean {
    return this.checkFor('share_modal', viewer, target, currentYear);
  }

  canUserAppearInInviteModal(
    viewer: StudentYearSubject | null | undefined,
    target: StudentYearSubject | null | undefined,
    currentYear = this.getCurrentAcademicYear(),
  ): boolean {
    return this.checkFor('invite_modal', viewer, target, currentYear);
  }

  canCreateMessage(
    viewer: StudentYearSubject | null | undefined,
    target: StudentYearSubject | null | undefined,
    currentYear = this.getCurrentAcademicYear(),
  ): boolean {
    return this.checkFor('messaging', viewer, target, currentYear);
  }

  canUsersMatch(
    viewer: StudentYearSubject | null | undefined,
    target: StudentYearSubject | null | undefined,
    currentYear = this.getCurrentAcademicYear(),
  ): boolean {
    return this.checkFor('instant_match', viewer, target, currentYear);
  }

  /** Activity visibility: judged on the activity's OWNER, like every other row. */
  canUserSeeActivity(
    viewer: StudentYearSubject | null | undefined,
    activityOwner: StudentYearSubject | null | undefined,
    currentYear = this.getCurrentAcademicYear(),
  ): boolean {
    return this.checkFor(
      'activity_visibility',
      viewer,
      activityOwner,
      currentYear,
    );
  }

  private checkFor(
    feature: PolicyFeature,
    viewer: StudentYearSubject | null | undefined,
    target: StudentYearSubject | null | undefined,
    currentYear: number,
  ): boolean {
    const allowed = this.canUsersInteract(viewer, target, currentYear);
    if (!allowed) {
      this.logBlocked(
        this.getUserBatchYear(viewer, currentYear),
        this.getUserBatchYear(target, currentYear),
        feature,
      );
    }
    return allowed;
  }

  // ── Query-layer filters ───────────────────────────────────────────────────

  /**
   * The rule as a Prisma `where` fragment on the User model, from the point of
   * view of one viewer. Spread (or AND) into any query that produces users a
   * viewer could discover, select or contact:
   *
   *     where: { ...base, ...policy.visibleUserWhere(viewerBatchYear) }
   *
   * The two branches are exact complements, which is what makes the rule
   * bidirectional without a second definition:
   *
   *   viewer IS first year      -> batchYear = <this year>
   *   viewer is NOT first year  -> batchYear <> <this year> OR IS NULL
   *
   * `null` has to be spelled out because SQL's `<>` is NULL for a NULL column,
   * and a NULL predicate is not true — an unresolved account would silently
   * vanish from every non-first-year list, which is a different (and wrong)
   * policy from the one above.
   */
  visibleUserWhere(
    viewerBatchYear: number | null | undefined,
    currentYear = this.getCurrentAcademicYear(),
  ): Prisma.UserWhereInput {
    if (!this.isEnforcementEnabled()) return {};
    if (this.isFirstYearBatch(viewerBatchYear, currentYear)) {
      return { batchYear: currentYear };
    }
    return {
      OR: [{ batchYear: { not: currentYear } }, { batchYear: null }],
    };
  }

  /**
   * The exact COMPLEMENT of {@link visibleUserWhere} — the users this viewer
   * may NOT interact with.
   *
   * Exists because of one specific trap. Prisma compiles a relation `every`
   * to `NOT EXISTS (row WHERE NOT <predicate>)`, and SQL's `NOT` of a NULL
   * comparison is NULL, not TRUE: for a first-year viewer,
   * `NOT ("batchYear" = 2026)` is NULL on a row whose batch is unresolved, the
   * inner EXISTS therefore finds nothing, and `every` wrongly reports that
   * every participant is compatible. A DM with an unresolved-batch partner
   * stayed in a first-year student's conversation list because of it.
   *
   * `none` over this complement compiles to `NOT EXISTS (row WHERE
   * <predicate>)` — the predicate is never negated, and both branches below
   * spell out their NULL case — so the answer is correct for a NULL batch in
   * both directions.
   *
   *     participants: { none: { userId: { not: me }, user: incompatible } }
   *
   * Use it wherever the question is "does this collection contain anyone I may
   * not reach", and `visibleUserWhere` wherever it is "is this row one I may
   * reach".
   */
  incompatibleUserWhere(
    viewerBatchYear: number | null | undefined,
    currentYear = this.getCurrentAcademicYear(),
  ): Prisma.UserWhereInput {
    if (!this.isEnforcementEnabled()) {
      // Matches nobody, so a `none` built on it excludes nothing.
      return { id: { in: [] } };
    }
    if (this.isFirstYearBatch(viewerBatchYear, currentYear)) {
      return {
        OR: [{ batchYear: { not: currentYear } }, { batchYear: null }],
      };
    }
    return { batchYear: currentYear };
  }

  /**
   * ANDs {@link visibleUserWhere} into a `where` the caller is already
   * building. PREFER THIS over spreading the fragment.
   *
   * The non-first-year branch is an `OR`, and a `where` under construction
   * very often already has one — a search clause, a keyset cursor. Spreading
   * would silently overwrite whichever came first and quietly widen or break
   * the query; appending to `AND` composes with it. This is the same reasoning,
   * and the same shape, as `BlocksService.injectBlockFilter`.
   *
   * `field` names the column holding the user id when the query is NOT on the
   * User model itself — pass nothing when it is.
   */
  injectUserFilter(
    where: Prisma.UserWhereInput,
    viewerBatchYear: number | null | undefined,
    currentYear = this.getCurrentAcademicYear(),
  ): Prisma.UserWhereInput {
    if (!this.isEnforcementEnabled()) return where;
    const clause = this.visibleUserWhere(viewerBatchYear, currentYear);
    if (Object.keys(clause).length === 0) return where;

    const existing = where.AND;
    const and = Array.isArray(existing)
      ? [...existing]
      : existing
        ? [existing]
        : [];
    and.push(clause);
    return { ...where, AND: and };
  }

  /**
   * {@link visibleUserWhere} lifted onto a relation, for models that reach a
   * user through a named field — `creator` on an activity, `author` on a post,
   * `user` on a queue entry.
   */
  visibleRelationWhere<K extends string>(
    relation: K,
    viewerBatchYear: number | null | undefined,
    currentYear = this.getCurrentAcademicYear(),
  ): Record<K, Prisma.UserWhereInput> | Record<string, never> {
    if (!this.isEnforcementEnabled()) return {};
    return {
      [relation]: this.visibleUserWhere(viewerBatchYear, currentYear),
    } as Record<K, Prisma.UserWhereInput>;
  }

  /**
   * The same rule as a raw-SQL predicate, for the handful of ranking and feed
   * queries written in SQL.
   *
   * Carries no user input: `alias` is supplied by the call site as a literal
   * and the only interpolated value is an integer this service computed, so
   * the fragment cannot carry an injection. `TRUE` when the feature is off
   * keeps it composable with an unconditional AND.
   *
   * The column is quoted because Prisma maps `batchYear` to a camelCase column
   * and Postgres folds unquoted identifiers to lowercase.
   */
  visibleUserSqlPredicate(
    alias: string,
    viewerBatchYear: number | null | undefined,
    currentYear = this.getCurrentAcademicYear(),
  ): string {
    if (!this.isEnforcementEnabled()) return 'TRUE';
    const safeAlias = /^[a-z_][a-z0-9_]*$/i.test(alias) ? alias : 'u';
    const year = Math.trunc(currentYear);
    if (this.isFirstYearBatch(viewerBatchYear, currentYear)) {
      return `"${safeAlias}"."batchYear" = ${year}`;
    }
    return `("${safeAlias}"."batchYear" IS NULL OR "${safeAlias}"."batchYear" <> ${year})`;
  }

  // ── Runtime resolution for ids ────────────────────────────────────────────

  invalidate(userId: string): void {
    if (userId) StudentYearPolicyService.batchCache.delete(userId);
  }

  /** Test seam. */
  invalidateAll(): void {
    StudentYearPolicyService.batchCache.clear();
  }

  private readCache(userId: string): number | null | undefined {
    const hit = StudentYearPolicyService.batchCache.get(userId);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      StudentYearPolicyService.batchCache.delete(userId);
      return undefined;
    }
    return hit.batchYear;
  }

  private writeCache(userId: string, batchYear: number | null): void {
    const cache = StudentYearPolicyService.batchCache;
    if (cache.size >= StudentYearPolicyService.BATCH_CACHE_MAX) {
      const now = Date.now();
      for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
      if (cache.size >= StudentYearPolicyService.BATCH_CACHE_MAX) {
        const oldest: string | undefined = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
    }
    cache.set(userId, {
      batchYear,
      expiresAt: Date.now() + StudentYearPolicyService.BATCH_TTL_MS,
    });
  }

  /**
   * Batch years for many ids in ONE query.
   *
   * Every runtime helper goes through here so no call site can turn a list
   * into a query per row. An id with no row maps to `null`, which is the
   * unresolved (non-first-year) bucket — never omitted, so a caller cannot
   * mistake "unknown" for "compatible".
   */
  async getBatchYearMap(
    userIds: Array<string | null | undefined>,
  ): Promise<Map<string, number | null>> {
    const unique = Array.from(
      new Set((userIds || []).filter((id): id is string => Boolean(id))),
    );
    const map = new Map<string, number | null>();
    if (unique.length === 0) return map;

    const currentYear = this.getCurrentAcademicYear();
    const missing: string[] = [];
    for (const id of unique) {
      const cached = this.readCache(id);
      if (cached === undefined) missing.push(id);
      else map.set(id, cached);
    }

    if (missing.length > 0) {
      const rows = await this.prisma.user.findMany({
        where: { id: { in: missing } },
        select: { id: true, batchYear: true, email: true, collegeEmail: true },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const id of missing) {
        const row = byId.get(id);
        const batchYear = row ? this.getUserBatchYear(row, currentYear) : null;
        this.writeCache(id, batchYear);
        map.set(id, batchYear);
      }
    }
    return map;
  }

  /** The viewer's own resolved context — id, batch, first-year status. */
  async resolveContext(
    userId: string | null | undefined,
  ): Promise<StudentYearContext | null> {
    if (!userId) return null;
    const map = await this.getBatchYearMap([userId]);
    const batchYear = map.get(userId) ?? null;
    return {
      id: userId,
      batchYear,
      isFirstYear: this.isFirstYearBatch(batchYear),
    };
  }

  /** Just the batch year for one id. */
  async getBatchYearFor(
    userId: string | null | undefined,
  ): Promise<number | null> {
    if (!userId) return null;
    const map = await this.getBatchYearMap([userId]);
    return map.get(userId) ?? null;
  }

  /** Whether two ids may interact, resolved from the database. */
  async canIdsInteract(
    userAId: string,
    userBId: string,
    feature: PolicyFeature = 'messaging',
  ): Promise<boolean> {
    if (!this.isEnforcementEnabled()) return true;
    if (!userAId || !userBId || userAId === userBId) return true;
    const map = await this.getBatchYearMap([userAId, userBId]);
    const a = map.get(userAId) ?? null;
    const b = map.get(userBId) ?? null;
    const allowed = this.areBatchYearsCompatible(a, b);
    if (!allowed) this.logBlocked(a, b, feature);
    return allowed;
  }

  /**
   * The subset of `targetIds` the actor may not interact with.
   * Used to filter a list already in memory (participants, recipient ids).
   */
  async getIncompatibleUserIds(
    actorId: string,
    targetIds: string[],
  ): Promise<string[]> {
    if (!this.isEnforcementEnabled() || !actorId) return [];
    const targets = (targetIds || []).filter((id) => id && id !== actorId);
    if (targets.length === 0) return [];
    const map = await this.getBatchYearMap([actorId, ...targets]);
    const actorBatch = map.get(actorId) ?? null;
    return targets.filter(
      (id) => !this.areBatchYearsCompatible(actorBatch, map.get(id) ?? null),
    );
  }

  /** Keeps only the ids the actor may interact with, preserving order. */
  async filterInteractableUserIds(
    actorId: string | null | undefined,
    targetIds: string[],
  ): Promise<string[]> {
    if (!this.isEnforcementEnabled() || !actorId) return targetIds;
    const blocked = new Set(
      await this.getIncompatibleUserIds(actorId, targetIds),
    );
    if (blocked.size === 0) return targetIds;
    return targetIds.filter((id) => !blocked.has(id));
  }

  // ── Enforcement ───────────────────────────────────────────────────────────

  /**
   * Throws unless the actor may interact with every listed id.
   *
   * The refusal message is deliberately the same in both directions and names
   * nobody: telling a caller "that account is a first-year student" would
   * disclose the very attribute the policy exists to keep out of their view.
   * It also matches the copy the Messaging Restricted modal shows, so a client
   * that has fallen back to the raw error still says something coherent.
   */
  async assertCanInteract(
    actorId: string,
    targetIds: string[],
    feature: PolicyFeature = 'messaging',
  ): Promise<void> {
    if (!this.isEnforcementEnabled()) return;
    const incompatible = await this.getIncompatibleUserIds(actorId, targetIds);
    if (incompatible.length === 0) return;

    const map = await this.getBatchYearMap([actorId, ...incompatible]);
    this.logBlocked(
      map.get(actorId) ?? null,
      map.get(incompatible[0]) ?? null,
      feature,
      incompatible.length,
    );

    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      code: FIRST_YEAR_RESTRICTED_CODE,
      message: FIRST_YEAR_RESTRICTED_MESSAGE,
    });
  }

  // ── Logging ───────────────────────────────────────────────────────────────

  /**
   * One line per refusal, in the format the runbook greps for:
   *
   *     FIRST_YEAR_POLICY_BLOCKED viewerBatch=2026 targetBatch=2025 feature=messaging
   *
   * Batch years and a feature name only — no ids, no addresses, no message
   * content. That is enough to answer "which surface refused, and between
   * which two cohorts" while carrying nothing that identifies a student.
   *
   * `debug` rather than `warn`: unlike a verification refusal, a blocked
   * cross-year interaction is the policy working normally and happens on every
   * ordinary browse, so at `warn` it would drown the production log. Raise the
   * level to `debug` in an environment that is being audited.
   */
  private logBlocked(
    viewerBatch: number | null,
    targetBatch: number | null,
    feature: PolicyFeature,
    count?: number,
  ): void {
    this.logger.debug(
      `FIRST_YEAR_POLICY_BLOCKED viewerBatch=${viewerBatch ?? 'unresolved'} ` +
        `targetBatch=${targetBatch ?? 'unresolved'} feature=${feature}` +
        (count && count > 1 ? ` count=${count}` : ''),
    );
  }
}

/** Machine-readable code clients switch on to raise the restriction modal. */
export const FIRST_YEAR_RESTRICTED_CODE = 'FIRST_YEAR_RESTRICTED';

/**
 * The user-facing copy, defined once. The Messaging Restricted modal renders
 * this string; keeping it here means the API response and the dialog cannot
 * drift apart.
 */
export const FIRST_YEAR_RESTRICTED_MESSAGE =
  'Direct messaging between first-year students and students from other years ' +
  'is temporarily restricted to help keep first-year students safe.';
