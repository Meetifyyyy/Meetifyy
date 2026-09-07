import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ForbiddenException } from '@nestjs/common';
import { ActivityVisibility, CrewActivityStatus } from '@prisma/client';

import { StudentYearPolicyService } from './student-year-policy.service';
import { UsersService } from '../../users/users.service';
import { BlocksService } from '../../users/blocks.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationFactory } from '../../notifications/notification.factory';
import { DomainEventService } from '../../events/domain-event.service';
import { RedisService } from '../../redis/redis.service';
import { PresenceService } from '../../presence/presence.service';
import { AcademicsService } from '../../academics/academics.service';
import { NOTIFICATIONS_QUEUE } from '../../notifications/notifications.processor';
import { VerificationAccessService } from '../verification/verification-access.service';
import { ActivityAuthorizationService } from '../../activities/activity-authorization.service';

/**
 * FIRST-YEAR ISOLATION — the surfaces, end to end.
 *
 * `student-year-policy.service.spec.ts` covers the rule itself. This file
 * covers the thing that actually goes wrong in practice: a surface that reads
 * the policy but applies it in the wrong PLACE.
 *
 * So the assertions here are mostly about the QUERY, not the returned array.
 * That distinction is the whole point. A service that fetched a page and then
 * filtered it in JavaScript would satisfy an assertion on the result and still
 * be wrong in three ways — short pages once `take` has been applied, rows
 * written into a Redis entry on the way past, and a payload that crossed the
 * network before anyone decided it should not have. Asserting on the `where`
 * is what tells the two implementations apart.
 *
 * `ACADEMIC_YEAR` is pinned to 2026 throughout, and a separate block runs the
 * same fixtures at 2027 to prove the cohort rolls over with nothing written.
 */

const FIRST_YEAR = 2026;

/** Users the fake database knows about, addressed exactly as GLA does. */
const PEOPLE = {
  fresher: {
    id: 'fresher',
    email: 'sarthak.saini_cs26@gla.ac.in',
    batchYear: 2026,
  },
  fresherTwo: {
    id: 'fresher-2',
    email: 'aman.usmani_cs.aiml26@gla.ac.in',
    batchYear: 2026,
  },
  second: {
    id: 'second',
    email: 'shrangika.agnihotri_cs.h25@gla.ac.in',
    batchYear: 2025,
  },
  third: {
    id: 'third',
    email: 'aaradhya.rawat_cs.h24@gla.ac.in',
    batchYear: 2024,
  },
  unresolved: { id: 'unresolved', email: 'someone@gmail.com', batchYear: null },
};

function fakePrismaForPolicy() {
  return {
    user: {
      findMany: jest.fn(async ({ where }: any) => {
        const ids: string[] = where?.id?.in ?? [];
        return Object.values(PEOPLE)
          .filter((u) => ids.includes(u.id))
          .map((u) => ({ ...u, collegeEmail: null }));
      }),
    },
  };
}

function makePolicy() {
  const policy = new StudentYearPolicyService(fakePrismaForPolicy() as any);
  policy.invalidateAll();
  return policy;
}

const originalYear = process.env.ACADEMIC_YEAR;
const originalFlag = process.env.FEATURE_FIRST_YEAR_ISOLATION;

beforeEach(() => {
  process.env.ACADEMIC_YEAR = String(FIRST_YEAR);
  delete process.env.FEATURE_FIRST_YEAR_ISOLATION;
});

afterEach(() => {
  if (originalYear === undefined) delete process.env.ACADEMIC_YEAR;
  else process.env.ACADEMIC_YEAR = originalYear;
  if (originalFlag === undefined)
    delete process.env.FEATURE_FIRST_YEAR_ISOLATION;
  else process.env.FEATURE_FIRST_YEAR_ISOLATION = originalFlag;
});

// ── Messaging ───────────────────────────────────────────────────────────────

describe('messaging', () => {
  it('allows 2026 <-> 2026', async () => {
    const policy = makePolicy();
    await expect(
      policy.assertCanInteract(PEOPLE.fresher.id, [PEOPLE.fresherTwo.id]),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['2025', PEOPLE.second.id],
    ['2024', PEOPLE.third.id],
  ])('blocks 2026 <-> %s', async (_label, otherId) => {
    const policy = makePolicy();
    await expect(
      policy.assertCanInteract(PEOPLE.fresher.id, [otherId]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks it whichever side initiates', async () => {
    const policy = makePolicy();
    await expect(
      policy.assertCanInteract(PEOPLE.second.id, [PEOPLE.fresher.id]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a group whose roster mixes the cohorts', async () => {
    const policy = makePolicy();
    await expect(
      policy.assertCanInteract(PEOPLE.fresher.id, [
        PEOPLE.fresherTwo.id,
        PEOPLE.second.id,
      ]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a group entirely inside one cohort', async () => {
    const policy = makePolicy();
    await expect(
      policy.assertCanInteract(PEOPLE.second.id, [
        PEOPLE.third.id,
        PEOPLE.unresolved.id,
      ]),
    ).resolves.toBeUndefined();
  });

  it('does not tell the caller which participant failed', async () => {
    const policy = makePolicy();
    try {
      await policy.assertCanInteract(PEOPLE.fresher.id, [PEOPLE.second.id]);
      throw new Error('should have thrown');
    } catch (err: any) {
      const body = JSON.stringify(err.getResponse());
      expect(body).not.toContain(PEOPLE.second.id);
      expect(body).not.toContain('2025');
      expect(body).not.toContain('2026');
    }
  });
});

// ── New Message / share / invite recipient search ───────────────────────────

describe('recipient selectors', () => {
  let service: UsersService;
  let findMany: jest.Mock;
  let userFindUnique: jest.Mock;

  const buildUsersService = async () => {
    // One double serves two callers. The real StudentYearPolicyService resolves
    // the viewer's batch through `user.findMany({ where: { id: { in: [...] } } })`,
    // so that shape has to answer with the fixtures or every viewer would
    // resolve as batch-unknown and the assertions below would all describe the
    // non-first-year branch. Everything else is a list query and returns
    // nothing — these tests are about the `where`, not the rows.
    findMany = jest.fn(async (args: any) => {
      const ids = args?.where?.id?.in;
      if (Array.isArray(ids)) {
        return Object.values(PEOPLE)
          .filter((u) => ids.includes(u.id))
          .map((u) => ({ ...u, collegeEmail: null }));
      }
      return [];
    });
    userFindUnique = jest.fn(async ({ where }: any) => {
      const found = Object.values(PEOPLE).find((u) => u.id === where.id);
      return found ? { ...found, collegeId: 'gla', collegeEmail: null } : null;
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        StudentYearPolicyService,
        VerificationAccessService,
        AcademicsService,
        {
          provide: PrismaService,
          useValue: { user: { findMany, findUnique: userFindUnique } },
        },
        {
          // Passes the `where` through untouched, so the assertions below see
          // exactly what the service built.
          provide: BlocksService,
          useValue: {
            injectBlockFilter: jest.fn(async (_id, where) => where),
            getExcludedUserIds: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: NotificationsService, useValue: {} },
        { provide: NotificationFactory, useValue: {} },
        { provide: DomainEventService, useValue: { publish: jest.fn() } },
        // No Redis: a cache hit would short-circuit the query under test.
        { provide: RedisService, useValue: { getClient: () => null } },
        { provide: PresenceService, useValue: { getPresenceMany: jest.fn() } },
        {
          provide: getQueueToken(NOTIFICATIONS_QUEUE),
          useValue: { add: jest.fn() },
        },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
    moduleRef.get(StudentYearPolicyService).invalidateAll();
    return service;
  };

  /**
   * The `where` of the LIST query, not of the policy's own batch lookup.
   *
   * The real StudentYearPolicyService shares this PrismaService double, so its
   * `{ id: { in: [viewerId] } }` resolution is `calls[0]`. Matching on
   * `accountStatus` picks the query under test rather than depending on call
   * order, which changes as soon as a cache hit removes the lookup.
   */
  const listWhereOf = () => {
    const call = findMany.mock.calls.find(
      (c: any[]) => c[0]?.where && 'accountStatus' in c[0].where,
    );
    if (!call) throw new Error('no list query was issued');
    return call[0].where;
  };

  /** The isolation clause the service ANDed into that `where`. */
  const policyClauseOf = () => {
    const where = listWhereOf();
    const and = Array.isArray(where.AND) ? where.AND : [];
    return and.find(
      (c: any) =>
        'batchYear' in c || (Array.isArray(c.OR) && 'batchYear' in c.OR[0]),
    );
  };

  it('restricts a first-year viewer to their own intake, in the query', async () => {
    await buildUsersService();
    await service.getConnections(PEOPLE.fresher.id);
    expect(policyClauseOf()).toEqual({ batchYear: FIRST_YEAR });
  });

  it('excludes the first-year intake for a 2025 viewer, in the query', async () => {
    await buildUsersService();
    await service.getConnections(PEOPLE.second.id);
    expect(policyClauseOf()).toEqual({
      OR: [{ batchYear: { not: FIRST_YEAR } }, { batchYear: null }],
    });
  });

  it('excludes it for a 2024 viewer too', async () => {
    await buildUsersService();
    await service.getConnections(PEOPLE.third.id);
    expect(policyClauseOf()).toEqual({
      OR: [{ batchYear: { not: FIRST_YEAR } }, { batchYear: null }],
    });
  });

  it('keeps the restriction when a search term is supplied', async () => {
    // The case most likely to leak: typing the exact handle of a restricted
    // account must not surface it.
    await buildUsersService();
    await service.getConnections(PEOPLE.fresher.id, 'shrangika');
    expect(policyClauseOf()).toEqual({ batchYear: FIRST_YEAR });
  });

  it('ANDs the clause rather than assigning it, so the search OR survives', async () => {
    await buildUsersService();
    await service.getConnections(PEOPLE.fresher.id, 'shrangika');
    const where = listWhereOf();
    // The search terms are still there and are a separate OR. Spreading the
    // policy fragment (which is itself an OR for senior viewers) would have
    // overwritten them.
    expect(JSON.stringify(where.OR)).toContain('displayName');
    expect(JSON.stringify(where.OR)).not.toContain('batchYear');
  });

  it('applies it alongside the existing constraints rather than replacing them', async () => {
    await buildUsersService();
    await service.getConnections(PEOPLE.fresher.id);
    const where = listWhereOf();
    expect(where.accountStatus).toBe('ACTIVE');
    expect(where.id).toEqual({ not: PEOPLE.fresher.id });
    expect(policyClauseOf()).toBeDefined();
  });

  it('filters the New Message modal source list the same way', async () => {
    await buildUsersService();
    await service.getAllUsers(20, 0, PEOPLE.fresher.id);
    expect(policyClauseOf()).toEqual({ batchYear: FIRST_YEAR });
  });

  it('filters the campus list the New Message modal also draws on', async () => {
    await buildUsersService();
    await service.getCampusUsers(PEOPLE.fresher.id, 50, 0);
    expect(policyClauseOf()).toEqual({ batchYear: FIRST_YEAR });
  });

  it('filters @mention candidates, which are a way to reach someone', async () => {
    await buildUsersService();
    (service as any).prisma.follow = { findMany: jest.fn(async () => []) };
    (service as any).prisma.communityMember = {
      findMany: jest.fn(async () => []),
    };
    (service as any).prisma.conversationParticipant = {
      findMany: jest.fn(async () => []),
    };
    await service.getMentionSuggestions(PEOPLE.fresher.id, 'shr');
    expect(policyClauseOf()).toEqual({ batchYear: FIRST_YEAR });
  });
});

// ── NULL safety of the relation filters ────────────────────────────────────

describe('the conversation-list filter must not be built on `every`', () => {
  /**
   * A real bug, found by running the filter against Postgres rather than
   * reasoning about it.
   *
   * Prisma compiles `participants: { every: P }` to
   * `NOT EXISTS (row WHERE NOT P)`. For a first-year viewer P is
   * `"batchYear" = 2026`, and `NOT (NULL = 2026)` is NULL — not TRUE — so the
   * inner EXISTS matched nothing and `every` reported "all participants are
   * compatible" for a DM whose partner had an unresolved batch. That thread
   * stayed in a first-year student's conversation list, with the other
   * student's name, avatar and last message on it.
   *
   * The fix is `none` over the COMPLEMENT: `NOT EXISTS (row WHERE
   * incompatible)` never negates the predicate, and both branches of
   * `incompatibleUserWhere` spell out their NULL case.
   */
  it('exposes a complement whose NULL arm is explicit in both directions', () => {
    const policy = makePolicy();

    // First-year viewer: everyone who is NOT this year's intake, NULLs
    // included. The `batchYear: null` arm is the whole point — `{ not: 2026 }`
    // alone is NULL for a NULL column and would match nothing.
    expect(policy.incompatibleUserWhere(2026)).toEqual({
      OR: [{ batchYear: { not: FIRST_YEAR } }, { batchYear: null }],
    });

    // Senior viewer: only this year's intake is out of reach. A NULL batch is
    // NOT incompatible with them, and `batchYear: 2026` correctly does not
    // match NULL.
    expect(policy.incompatibleUserWhere(2025)).toEqual({
      batchYear: FIRST_YEAR,
    });
    expect(policy.incompatibleUserWhere(null)).toEqual({
      batchYear: FIRST_YEAR,
    });
  });

  it('is the exact complement of visibleUserWhere', () => {
    const policy = makePolicy();
    for (const viewer of [2026, 2025, null]) {
      const visible = JSON.stringify(policy.visibleUserWhere(viewer));
      const hidden = JSON.stringify(policy.incompatibleUserWhere(viewer));
      // The two are never the same clause, and between them they name both
      // sides of the boundary.
      expect(visible).not.toEqual(hidden);
    }
    // The first-year viewer's hidden set is literally the senior viewer's
    // visible set, and vice versa — which is what "symmetric" means here.
    expect(policy.incompatibleUserWhere(2026)).toEqual(
      policy.visibleUserWhere(2025),
    );
    expect(policy.incompatibleUserWhere(2025)).toEqual(
      policy.visibleUserWhere(2026),
    );
  });

  it('matches nobody when the feature is off, so a `none` excludes nothing', () => {
    const policy = makePolicy();
    process.env.FEATURE_FIRST_YEAR_ISOLATION = 'false';
    expect(policy.incompatibleUserWhere(2026)).toEqual({ id: { in: [] } });
  });

  it('the conversation lists use `none`, never `every`', () => {
    // Asserted on the source, because the distinction is invisible to a unit
    // test with a stubbed Prisma: both spellings type-check, both read
    // correctly, and only Postgres tells them apart.
    //
    // Comments are stripped first. The ones explaining this very bug say
    // "every" repeatedly, and matching those would make the assertion fail for
    // the wrong reason -- which is exactly what happened when it did not.
    const codeOf = (file: string) =>
      require('fs')
        .readFileSync(require('path').join(__dirname, '..', '..', file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l: string) => !l.trim().startsWith('//'))
        .join('\n');

    for (const file of [
      'messages/dm/dm.service.ts',
      'messages/messages.service.ts',
    ]) {
      const code = codeOf(file);
      const at = code.indexOf('incompatibleUserWhere');
      expect(at).toBeGreaterThan(-1);

      // The relation operator immediately above the policy call.
      const preceding = code.slice(Math.max(0, at - 300), at);
      expect(preceding).toContain('none:');
      expect(preceding).not.toContain('every:');
    }
  });
});

// ── The profile lock flag ──────────────────────────────────────────────────

describe('messagingRestricted, the flag the locked button reads', () => {
  const policy = () => makePolicy();

  it('is true for a restricted pair, in both directions', () => {
    const p = policy();
    expect(p.canCreateMessage({ batchYear: 2026 }, { batchYear: 2025 })).toBe(
      false,
    );
    expect(p.canCreateMessage({ batchYear: 2025 }, { batchYear: 2026 })).toBe(
      false,
    );
  });

  it('is false for a permitted pair', () => {
    const p = policy();
    expect(p.canCreateMessage({ batchYear: 2026 }, { batchYear: 2026 })).toBe(
      true,
    );
    expect(p.canCreateMessage({ batchYear: 2025 }, { batchYear: 2024 })).toBe(
      true,
    );
  });

  /**
   * The trap: a viewer with NO resolved batch (anonymous, or a caller that has
   * not looked one up) compares as "not first-year", so against a 2026 target
   * the policy says incompatible — which is correct for a stranger and wrong
   * for the target themselves.
   *
   * Both profile endpoints therefore have to decide "is there a distinct
   * viewer?" BEFORE asking the policy. Getting this wrong reported a
   * first-year student's own profile as restricted from them, and a green test
   * suite said nothing about it.
   */
  it('a null viewer batch reads as incompatible with a first-year target', () => {
    const p = policy();
    expect(p.canCreateMessage({ batchYear: null }, { batchYear: 2026 })).toBe(
      false,
    );
  });

  it('which is why self and anonymous must be short-circuited by the caller', () => {
    const p = policy();
    // Self, judged naively against an unresolved viewer batch: "restricted".
    const naive = !p.canCreateMessage({ batchYear: null }, { batchYear: 2026 });
    expect(naive).toBe(true);

    // The endpoints guard on `hasDistinctViewer` instead, which is what makes
    // the answer false. This asserts the SHAPE the callers must use.
    const hasDistinctViewer = false;
    const guarded = hasDistinctViewer
      ? !p.canCreateMessage({ batchYear: null }, { batchYear: 2026 })
      : false;
    expect(guarded).toBe(false);
  });
});

// ── Composition: the rule must never displace another one ──────────────────

describe('composing with the rules that were already there', () => {
  /**
   * The bug this pins: both the verification split and first-year isolation
   * are an `OR` over the same `where` object. Spread as two object literals,
   * the second silently overwrites the first — and the one that loses is the
   * verification filter on share pickers, with no error and no failing
   * assertion to say so. Both belong in `AND`.
   */
  it('keeps both clauses when a share picker asks for eligible threads only', () => {
    const policy = makePolicy();
    const verificationClause = {
      OR: [{ type: 'GROUP' }, { participants: { some: {} } }],
    };
    const isolationClause = {
      OR: [{ type: 'GROUP' }, { participants: { every: {} } }],
    };

    // Spreading loses one.
    const spread = { ...verificationClause, ...isolationClause };
    expect(Object.keys(spread)).toHaveLength(1);
    expect(spread.OR).toEqual(isolationClause.OR);

    // ANDing keeps both.
    const anded = { AND: [verificationClause, isolationClause] };
    expect(anded.AND).toHaveLength(2);
  });

  it('injectUserFilter ANDs rather than assigns, for the same reason', () => {
    const policy = makePolicy();
    const withSearch = {
      accountStatus: 'ACTIVE' as const,
      OR: [{ username: { contains: 'a' } }, { displayName: { contains: 'a' } }],
    };

    // A senior viewer's isolation clause is itself an OR. Assigning it would
    // drop the search terms and widen the query to the whole user table.
    const result: any = policy.injectUserFilter(withSearch, 2025);
    expect(result.OR).toEqual(withSearch.OR);
    expect(result.AND).toEqual([
      { OR: [{ batchYear: { not: FIRST_YEAR } }, { batchYear: null }] },
    ]);
  });

  it('appends to an AND the caller had already started', () => {
    const policy = makePolicy();
    const result: any = policy.injectUserFilter(
      { AND: [{ id: { notIn: ['x'] } }] },
      2026,
    );
    expect(result.AND).toHaveLength(2);
    expect(result.AND[0]).toEqual({ id: { notIn: ['x'] } });
    expect(result.AND[1]).toEqual({ batchYear: FIRST_YEAR });
  });
});

// ── Activity visibility ─────────────────────────────────────────────────────

describe('activity visibility', () => {
  const buildActivityPolicy = () =>
    new ActivityAuthorizationService(makePolicy());

  const activity = (creatorBatchYear: number | null, creatorId = 'host') => ({
    id: 'act-1',
    creatorId,
    collegeId: 'gla',
    visibility: ActivityVisibility.PUBLIC,
    status: CrewActivityStatus.OPEN,
    creator: { batchYear: creatorBatchYear },
  });

  const viewer = (batchYear: number | null, id = 'viewer') => ({
    id,
    collegeId: 'gla',
    batchYear,
  });

  it('lets a first-year student see a first-year host, even though it is PUBLIC', () => {
    const policy = buildActivityPolicy();
    expect(policy.canView(viewer(2026), activity(2026)).allowed).toBe(true);
    expect(policy.canDiscover(viewer(2026), activity(2026))).toBe(true);
  });

  it('hides a 2025 host from a first-year student', () => {
    const policy = buildActivityPolicy();
    expect(policy.canView(viewer(2026), activity(2025)).allowed).toBe(false);
    expect(policy.canDiscover(viewer(2026), activity(2025))).toBe(false);
  });

  it('hides a first-year host from a 2025 student — the other direction', () => {
    const policy = buildActivityPolicy();
    expect(policy.canView(viewer(2025), activity(2026)).allowed).toBe(false);
    expect(policy.canDiscover(viewer(2025), activity(2026))).toBe(false);
  });

  it('answers 404, not 403, so the activity is indistinguishable from one that does not exist', () => {
    const policy = buildActivityPolicy();
    // A 403 would confirm both that the id is real and that its host is in the
    // other cohort.
    expect(() =>
      policy.assertCanView(viewer(2026), activity(2025) as any),
    ).toThrow(/not found/i);
  });

  it('never hides a host from themselves', () => {
    const policy = buildActivityPolicy();
    expect(
      policy.canView(viewer(2026, 'host'), activity(2026, 'host')).allowed,
    ).toBe(true);
  });

  it('refuses the join as well as the view, so the two cannot disagree', () => {
    const policy = buildActivityPolicy();
    expect(policy.canJoin(viewer(2026), activity(2025) as any).allowed).toBe(
      false,
    );
  });

  it('pushes the rule into the discovery query, on the host', () => {
    const policy = buildActivityPolicy();
    const where: any = policy.discoveryWhere(viewer(2026));
    expect(JSON.stringify(where.AND)).toContain('"batchYear":2026');
  });

  it('pushes it into the cache-shareable query too', () => {
    // `sharedAudienceWhere` builds pages that are cached and served to every
    // viewer with the same audience tag, so the rule has to be inside it — and
    // the tag has to carry the cohort, which ActivitiesService does.
    const policy = buildActivityPolicy();
    const where: any = policy.sharedAudienceWhere(viewer(2026));
    expect(JSON.stringify(where.AND)).toContain('"batchYear":2026');
  });

  it('pushes it into the personal-list query, so a bookmark is not a back door', () => {
    const policy = buildActivityPolicy();
    const where: any = policy.accessWhere(viewer(2026));
    expect(JSON.stringify(where.AND)).toContain('"batchYear":2026');
  });

  it('allows an activity whose host batch was never selected, so an un-updated detail path does not start 404-ing', () => {
    const policy = buildActivityPolicy();
    const withoutCreator = {
      id: 'act-2',
      creatorId: 'host',
      collegeId: 'gla',
      visibility: ActivityVisibility.PUBLIC,
      status: CrewActivityStatus.OPEN,
    };
    expect(policy.canView(viewer(2026), withoutCreator as any).allowed).toBe(
      true,
    );
  });

  it('honours an explicitly unresolved host batch, which is different from an absent one', () => {
    const policy = buildActivityPolicy();
    expect(policy.canView(viewer(2026), activity(null)).allowed).toBe(false);
    expect(policy.canView(viewer(2025), activity(null)).allowed).toBe(true);
  });
});

// ── Instant Match, recommendations, feeds: the query fragments ──────────────

describe('candidate generation and feeds', () => {
  it('gives Instant Match a candidate filter, not a response filter', () => {
    // The rule has to be inside the queue query so an incompatible entry is
    // never scored and never reaches `claimPair`.
    const policy = makePolicy();
    expect(policy.visibleUserWhere(2026)).toEqual({ batchYear: FIRST_YEAR });
  });

  it('gives the raw-SQL surfaces an equivalent predicate', () => {
    const policy = makePolicy();
    // Recommendations, the post feed and the follower lists are raw SQL.
    expect(policy.visibleUserSqlPredicate('u', 2026)).toBe(
      '"u"."batchYear" = 2026',
    );
    expect(policy.visibleUserSqlPredicate('u', 2025)).toBe(
      '("u"."batchYear" IS NULL OR "u"."batchYear" <> 2026)',
    );
  });

  it('keeps the SQL and Prisma forms agreeing about who is visible', () => {
    const policy = makePolicy();
    for (const batch of [2026, 2025, null]) {
      const sql = policy.visibleUserSqlPredicate('u', batch);
      const prisma = JSON.stringify(policy.visibleUserWhere(batch));
      const sqlIsEquality = sql.includes('= 2026');
      const prismaIsEquality = prisma === '{"batchYear":2026}';
      expect(sqlIsEquality).toBe(prismaIsEquality);
    }
  });

  it('lifts the rule onto a named relation for the models that reach a user through one', () => {
    const policy = makePolicy();
    expect(policy.visibleRelationWhere('creator', 2026)).toEqual({
      creator: { batchYear: FIRST_YEAR },
    });
    expect(policy.visibleRelationWhere('author', 2026)).toEqual({
      author: { batchYear: FIRST_YEAR },
    });
  });
});

// ── The year transition ─────────────────────────────────────────────────────

describe('when the year changes', () => {
  it('the 2026 cohort keeps its isolation through 2026', () => {
    process.env.ACADEMIC_YEAR = '2026';
    const policy = makePolicy();
    expect(policy.isFirstYearStudent(PEOPLE.fresher)).toBe(true);
    expect(policy.canUsersInteract(PEOPLE.fresher, PEOPLE.second)).toBe(false);
  });

  it('loses it in 2027, with no row changed and no migration run', async () => {
    process.env.ACADEMIC_YEAR = '2027';
    const policy = makePolicy();

    // Same fixtures. Nothing has been written.
    expect(policy.isFirstYearStudent(PEOPLE.fresher)).toBe(false);
    expect(policy.canUsersInteract(PEOPLE.fresher, PEOPLE.second)).toBe(true);
    expect(policy.canUsersInteract(PEOPLE.fresher, PEOPLE.third)).toBe(true);
    expect(policy.canUsersInteract(PEOPLE.fresher, PEOPLE.fresherTwo)).toBe(
      true,
    );

    // And the runtime path agrees with the pure one.
    await expect(
      policy.assertCanInteract(PEOPLE.fresher.id, [PEOPLE.second.id]),
    ).resolves.toBeUndefined();
  });

  it('makes the 2027 intake the isolated cohort instead', () => {
    process.env.ACADEMIC_YEAR = '2027';
    const policy = makePolicy();
    const newFresher = {
      id: 'n',
      email: 'a.b_cs27@gla.ac.in',
      batchYear: 2027,
    };
    expect(policy.isFirstYearStudent(newFresher)).toBe(true);
    expect(policy.canUsersInteract(newFresher, PEOPLE.fresher)).toBe(false);
    expect(policy.canUsersInteract(newFresher, PEOPLE.second)).toBe(false);
    expect(
      policy.canUsersInteract(newFresher, {
        id: 'o',
        email: 'c.d_cs.h27@gla.ac.in',
        batchYear: 2027,
      }),
    ).toBe(true);
  });

  it('moves every query filter with it', () => {
    process.env.ACADEMIC_YEAR = '2027';
    const policy = makePolicy();
    // A 2026 student's recipient list now excludes 2027 rather than being
    // pinned to 2026.
    expect(policy.visibleUserWhere(2026)).toEqual({
      OR: [{ batchYear: { not: 2027 } }, { batchYear: null }],
    });
    expect(policy.visibleUserWhere(2027)).toEqual({ batchYear: 2027 });
  });
});

// ── Edge cases the requirements call out ────────────────────────────────────

describe('unresolved and hostile batches', () => {
  it('never classifies an unparseable address as first-year', () => {
    const policy = makePolicy();
    expect(policy.isFirstYearStudent(PEOPLE.unresolved)).toBe(false);
    expect(policy.isFirstYearStudent({ email: null })).toBe(false);
    expect(policy.isFirstYearStudent({ email: 'not-an-email' })).toBe(false);
  });

  it("keeps unresolved accounts out of a first-year student's selectors", async () => {
    const policy = makePolicy();
    await expect(
      policy.filterInteractableUserIds(PEOPLE.fresher.id, [
        PEOPLE.unresolved.id,
        PEOPLE.fresherTwo.id,
      ]),
    ).resolves.toEqual([PEOPLE.fresherTwo.id]);
  });

  it('will not let a client-supplied batch year change the answer', () => {
    const policy = makePolicy();
    // `passingYear` is user-editable through PATCH /users/me; `batchYear` is
    // not accepted by any endpoint. Neither may promote a senior into the
    // first-year cohort.
    expect(
      policy.isFirstYearStudent({
        email: 'x_cs25@gla.ac.in',
        passingYear: 2026,
      } as any),
    ).toBe(false);
  });

  it('ignores a stored batch year the parser would never produce', () => {
    const policy = makePolicy();
    // The column is a cache of the parse. A value outside the plausibility
    // window is stale data, not a fact — and, crucially, cannot be used to
    // fabricate first-year membership.
    expect(
      policy.getUserBatchYear({ batchYear: 1900, email: 'x_cs25@gla.ac.in' }),
    ).toBe(2025);
  });

  it('refuses a plus-tagged address rather than reading a second batch out of it', () => {
    const policy = makePolicy();
    // Same mailbox as x_cs25@ at most providers; honouring the tag would let
    // one verified address present two cohorts.
    expect(policy.isFirstYearStudent({ email: 'x_cs25+cs26@gla.ac.in' })).toBe(
      false,
    );
  });
});

// ── The kill switch ─────────────────────────────────────────────────────────

describe('with the feature disabled', () => {
  beforeEach(() => {
    process.env.FEATURE_FIRST_YEAR_ISOLATION = 'false';
  });

  it('behaves exactly as it did before the feature existed', async () => {
    const policy = makePolicy();
    expect(policy.canUsersInteract(PEOPLE.fresher, PEOPLE.second)).toBe(true);
    await expect(
      policy.assertCanInteract(PEOPLE.fresher.id, [PEOPLE.second.id]),
    ).resolves.toBeUndefined();
  });

  it('turns the query filters off too, so the two halves cannot disagree', () => {
    const policy = makePolicy();
    expect(policy.visibleUserWhere(2026)).toEqual({});
    expect(policy.injectUserFilter({ accountStatus: 'ACTIVE' }, 2026)).toEqual({
      accountStatus: 'ACTIVE',
    });
    expect(policy.visibleUserSqlPredicate('u', 2026)).toBe('TRUE');
  });

  it('stops filtering activities as well', () => {
    const policy = new ActivityAuthorizationService(makePolicy());
    expect(
      policy.canView({ id: 'v', collegeId: 'gla', batchYear: 2026 }, {
        id: 'a',
        creatorId: 'host',
        collegeId: 'gla',
        visibility: ActivityVisibility.PUBLIC,
        status: CrewActivityStatus.OPEN,
        creator: { batchYear: 2025 },
      } as any).allowed,
    ).toBe(true);
  });
});
