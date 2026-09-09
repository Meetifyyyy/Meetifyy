import { ForbiddenException } from '@nestjs/common';
import {
  FIRST_YEAR_RESTRICTED_CODE,
  FIRST_YEAR_RESTRICTED_MESSAGE,
  StudentYearPolicyService,
} from './student-year-policy.service';

/**
 * The policy is exercised against a fake Prisma so these tests stay fast and
 * hermetic. Everything that matters here is a decision, not a query.
 */
function makeService(
  users: Array<{
    id: string;
    email?: string | null;
    batchYear?: number | null;
  }> = [],
) {
  const prisma: any = {
    user: {
      findMany: jest.fn(async ({ where }: any) => {
        const ids: string[] = where?.id?.in ?? [];
        return users
          .filter((u) => ids.includes(u.id))
          .map((u) => ({
            id: u.id,
            batchYear: u.batchYear ?? null,
            email: u.email ?? null,
            collegeEmail: null,
          }));
      }),
    },
  };
  const service = new StudentYearPolicyService(prisma);
  service.invalidateAll();
  return { service, prisma };
}

/**
 * The baseline for this file is "policy ON", declared here instead of inherited.
 *
 * Jest loads `.env`, so the suite used to restore whatever the developer had
 * set. Someone working with `FEATURE_FIRST_YEAR_ISOLATION=false` — a reasonable
 * thing to want locally, and exactly what a populated dev feed needs — turned
 * every rule below into a no-op, and the suite failed for a reason that had
 * nothing to do with the code under test. A test for what a policy does when
 * enabled has to enable it.
 *
 * Tests that exercise the disabled path still set the flag themselves; the
 * afterEach returns to the enforced baseline rather than to the environment.
 */
const ENFORCED = 'true';
process.env.FEATURE_FIRST_YEAR_ISOLATION = ENFORCED;
const originalYear = process.env.ACADEMIC_YEAR;

afterEach(() => {
  process.env.FEATURE_FIRST_YEAR_ISOLATION = ENFORCED;
  if (originalYear === undefined) delete process.env.ACADEMIC_YEAR;
  else process.env.ACADEMIC_YEAR = originalYear;
});

describe('first-year detection', () => {
  it('for current year 2026, only the 2026 intake is first year', () => {
    const { service } = makeService();
    expect(service.isFirstYearBatch(2026, 2026)).toBe(true);
    expect(service.isFirstYearBatch(2025, 2026)).toBe(false);
    expect(service.isFirstYearBatch(2024, 2026)).toBe(false);
  });

  it('for current year 2027, the cohort has moved on', () => {
    const { service } = makeService();
    expect(service.isFirstYearBatch(2027, 2027)).toBe(true);
    expect(service.isFirstYearBatch(2026, 2027)).toBe(false);
    expect(service.isFirstYearBatch(2025, 2027)).toBe(false);
  });

  it('an unresolved batch is never first year', () => {
    const { service } = makeService();
    expect(service.isFirstYearBatch(null, 2026)).toBe(false);
    expect(service.isFirstYearBatch(undefined, 2026)).toBe(false);
  });

  it('reads the batch from the verified address when no column is stored', () => {
    const { service } = makeService();
    expect(
      service.isFirstYearStudent({ email: 'a.b_cs26@gla.ac.in' }, 2026),
    ).toBe(true);
    expect(
      service.isFirstYearStudent({ email: 'a.b_cs25@gla.ac.in' }, 2026),
    ).toBe(false);
  });

  it('prefers the stored column but falls back to the address', () => {
    const { service } = makeService();
    expect(
      service.getUserBatchYear({ batchYear: 2026, email: null }, 2026),
    ).toBe(2026);
    expect(
      service.getUserBatchYear(
        { batchYear: null, email: 'x_cs24@gla.ac.in' },
        2026,
      ),
    ).toBe(2024);
  });

  it('discards a stored value the parser would never produce today', () => {
    const { service } = makeService();
    // 1990 is outside the plausibility window; the column is only a cache of
    // the parse, so a value the parse would reject is stale, not a fact.
    expect(
      service.getUserBatchYear({ batchYear: 1990, email: null }, 2026),
    ).toBeNull();
  });

  it('never derives a batch from a profile field the user can type', () => {
    const { service } = makeService();
    // `passingYear`, `course` and friends are user-editable. Handing one in
    // must change nothing.
    expect(
      service.getUserBatchYear(
        { passingYear: 2026, course: 'B.Tech 2026' } as any,
        2026,
      ),
    ).toBeNull();
  });
});

describe('the interaction rule', () => {
  const y = 2026;

  it('allows 2026 <-> 2026', () => {
    const { service } = makeService();
    expect(service.areBatchYearsCompatible(2026, 2026, y)).toBe(true);
  });

  it.each([2025, 2024, 2023])('blocks 2026 <-> %i', (other) => {
    const { service } = makeService();
    expect(service.areBatchYearsCompatible(2026, other, y)).toBe(false);
  });

  it('is symmetric — the initiator does not matter', () => {
    const { service } = makeService();
    expect(service.areBatchYearsCompatible(2026, 2025, y)).toBe(
      service.areBatchYearsCompatible(2025, 2026, y),
    );
    expect(service.areBatchYearsCompatible(2025, 2026, y)).toBe(false);
  });

  it('leaves non-first-year batches free to interact with each other', () => {
    const { service } = makeService();
    expect(service.areBatchYearsCompatible(2025, 2024, y)).toBe(true);
    expect(service.areBatchYearsCompatible(2023, 2025, y)).toBe(true);
  });

  it('groups unresolved batches with the non-first-year population', () => {
    const { service } = makeService();
    expect(service.areBatchYearsCompatible(null, 2025, y)).toBe(true);
    expect(service.areBatchYearsCompatible(null, null, y)).toBe(true);
    // and, crucially, an unresolved account is NOT admitted to first year
    expect(service.areBatchYearsCompatible(null, 2026, y)).toBe(false);
  });

  it('exposes the same decision under every surface-specific name', () => {
    const { service } = makeService();
    const first = { email: 'a_cs26@gla.ac.in' };
    const senior = { email: 'b_cs25@gla.ac.in' };
    for (const check of [
      service.canUserSeeUser,
      service.canUserAppearInNewMessageModal,
      service.canUserAppearInShareModal,
      service.canUserAppearInInviteModal,
      service.canCreateMessage,
      service.canUsersMatch,
      service.canUserSeeActivity,
    ]) {
      expect(check.call(service, first, senior, y)).toBe(false);
      expect(check.call(service, first, { email: 'c_cs26@gla.ac.in' }, y)).toBe(
        true,
      );
    }
  });
});

describe('the year transition', () => {
  it('the same account stops being first-year without anything being written', () => {
    const { service } = makeService();
    const user = { id: 'u', email: 'a.b_cs26@gla.ac.in' };

    // 2026: first year, isolated to its own cohort.
    expect(service.isFirstYearStudent(user, 2026)).toBe(true);
    expect(
      service.canUsersInteract(user, { email: 'x_cs25@gla.ac.in' }, 2026),
    ).toBe(false);

    // 2027: the same row, no migration, no flag flipped.
    expect(service.isFirstYearStudent(user, 2027)).toBe(false);
    expect(
      service.canUsersInteract(user, { email: 'x_cs25@gla.ac.in' }, 2027),
    ).toBe(true);
    expect(
      service.canUsersInteract(user, { email: 'x_cs26@gla.ac.in' }, 2027),
    ).toBe(true);
    // and is now isolated FROM the new intake instead
    expect(
      service.canUsersInteract(user, { email: 'x_cs27@gla.ac.in' }, 2027),
    ).toBe(false);
  });

  it('2027 <-> 2027 is allowed once 2027 is the first-year batch', () => {
    const { service } = makeService();
    expect(
      service.canUsersInteract(
        { email: 'a_cs27@gla.ac.in' },
        { email: 'b_cs27@gla.ac.in' },
        2027,
      ),
    ).toBe(true);
  });

  it('reads the year from the clock, so no code path hardcodes 2026', () => {
    const { service } = makeService();
    delete process.env.ACADEMIC_YEAR;
    expect(service.getCurrentAcademicYear()).toBe(new Date().getFullYear());
  });

  it('honours an explicit ACADEMIC_YEAR override', () => {
    const { service } = makeService();
    process.env.ACADEMIC_YEAR = '2031';
    expect(service.getCurrentAcademicYear()).toBe(2031);
  });
});

describe('query-layer filters', () => {
  const y = 2026;

  it('restricts a first-year viewer to their own intake', () => {
    const { service } = makeService();
    expect(service.visibleUserWhere(2026, y)).toEqual({ batchYear: 2026 });
  });

  it('excludes the first-year intake for everyone else, NULLs included', () => {
    const { service } = makeService();
    // The explicit `batchYear: null` arm matters: `<>` is NULL for a NULL
    // column, and a NULL predicate is not true, so without it every
    // unresolved account would silently vanish from senior lists.
    expect(service.visibleUserWhere(2025, y)).toEqual({
      OR: [{ batchYear: { not: 2026 } }, { batchYear: null }],
    });
    expect(service.visibleUserWhere(null, y)).toEqual({
      OR: [{ batchYear: { not: 2026 } }, { batchYear: null }],
    });
  });

  it('lifts the same fragment onto a named relation', () => {
    const { service } = makeService();
    expect(service.visibleRelationWhere('creator', 2026, y)).toEqual({
      creator: { batchYear: 2026 },
    });
  });

  it('produces an equivalent SQL predicate', () => {
    const { service } = makeService();
    expect(service.visibleUserSqlPredicate('u', 2026, y)).toBe(
      '"u"."batchYear" = 2026',
    );
    expect(service.visibleUserSqlPredicate('u', 2025, y)).toBe(
      '("u"."batchYear" IS NULL OR "u"."batchYear" <> 2026)',
    );
  });

  it('refuses an alias that is not a bare identifier', () => {
    const { service } = makeService();
    expect(service.visibleUserSqlPredicate('u"; DROP TABLE', 2026, y)).toBe(
      '"u"."batchYear" = 2026',
    );
  });

  it('the SQL and Prisma forms agree about who is visible', () => {
    const { service } = makeService();
    // First-year viewer: an equality on both sides.
    expect(service.visibleUserSqlPredicate('u', 2026, y)).toContain('= 2026');
    expect(service.visibleUserWhere(2026, y)).toHaveProperty('batchYear', 2026);
  });
});

describe('runtime enforcement', () => {
  const users = [
    { id: 'first-a', email: 'a_cs26@gla.ac.in' },
    { id: 'first-b', email: 'b_cs26@gla.ac.in' },
    { id: 'senior', email: 'c_cs25@gla.ac.in' },
    { id: 'older', email: 'd_cs24@gla.ac.in' },
    { id: 'unresolved', email: 'nobody@example.com' },
  ];

  beforeEach(() => {
    process.env.ACADEMIC_YEAR = '2026';
  });

  it('resolves a batch map in ONE query for any number of ids', async () => {
    const { service, prisma } = makeService(users);
    const map = await service.getBatchYearMap([
      'first-a',
      'senior',
      'older',
      'unresolved',
    ]);
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(map.get('first-a')).toBe(2026);
    expect(map.get('senior')).toBe(2025);
    expect(map.get('unresolved')).toBeNull();
  });

  it('reports an id with no row as unresolved rather than omitting it', async () => {
    const { service } = makeService(users);
    const map = await service.getBatchYearMap(['ghost']);
    expect(map.has('ghost')).toBe(true);
    expect(map.get('ghost')).toBeNull();
  });

  it('serves repeat lookups from cache instead of re-querying', async () => {
    const { service, prisma } = makeService(users);
    await service.getBatchYearMap(['first-a']);
    await service.getBatchYearMap(['first-a']);
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
  });

  it('allows a first-year pair and blocks a mixed one', async () => {
    const { service } = makeService(users);
    await expect(service.canIdsInteract('first-a', 'first-b')).resolves.toBe(
      true,
    );
    await expect(service.canIdsInteract('first-a', 'senior')).resolves.toBe(
      false,
    );
    await expect(service.canIdsInteract('senior', 'first-a')).resolves.toBe(
      false,
    );
    await expect(service.canIdsInteract('senior', 'older')).resolves.toBe(true);
  });

  it('filters a recipient list down to compatible ids, preserving order', async () => {
    const { service } = makeService(users);
    await expect(
      service.filterInteractableUserIds('first-a', [
        'senior',
        'first-b',
        'older',
        'unresolved',
      ]),
    ).resolves.toEqual(['first-b']);

    await expect(
      service.filterInteractableUserIds('senior', [
        'first-a',
        'older',
        'unresolved',
      ]),
    ).resolves.toEqual(['older', 'unresolved']);
  });

  it('throws a typed 403 when any recipient is restricted', async () => {
    const { service } = makeService(users);
    await expect(
      service.assertCanInteract('first-a', ['first-b', 'senior']),
    ).rejects.toBeInstanceOf(ForbiddenException);

    try {
      await service.assertCanInteract('first-a', ['senior'], 'share_modal');
      throw new Error('should have thrown');
    } catch (err: any) {
      const body = err.getResponse();
      expect(body.code).toBe(FIRST_YEAR_RESTRICTED_CODE);
      expect(body.message).toBe(FIRST_YEAR_RESTRICTED_MESSAGE);
      // The refusal must not name which side failed, in either direction.
      expect(JSON.stringify(body)).not.toContain('senior');
      expect(JSON.stringify(body)).not.toContain('2025');
    }
  });

  it('passes when every recipient is compatible', async () => {
    const { service } = makeService(users);
    await expect(
      service.assertCanInteract('first-a', ['first-b']),
    ).resolves.toBeUndefined();
    await expect(
      service.assertCanInteract('senior', ['older', 'unresolved']),
    ).resolves.toBeUndefined();
  });

  it('never restricts a user from themselves', async () => {
    const { service } = makeService(users);
    await expect(
      service.assertCanInteract('first-a', ['first-a']),
    ).resolves.toBeUndefined();
  });
});

describe('the kill switch', () => {
  beforeEach(() => {
    process.env.FEATURE_FIRST_YEAR_ISOLATION = 'false';
    process.env.ACADEMIC_YEAR = '2026';
  });

  it('turns every runtime check into an allow', async () => {
    const { service } = makeService([
      { id: 'first', email: 'a_cs26@gla.ac.in' },
      { id: 'senior', email: 'b_cs25@gla.ac.in' },
    ]);
    expect(service.isEnforcementEnabled()).toBe(false);
    expect(
      service.canUsersInteract(
        { email: 'a_cs26@gla.ac.in' },
        { email: 'b_cs25@gla.ac.in' },
      ),
    ).toBe(true);
    await expect(service.canIdsInteract('first', 'senior')).resolves.toBe(true);
    await expect(
      service.assertCanInteract('first', ['senior']),
    ).resolves.toBeUndefined();
  });

  it('turns every query filter into a no-op, so the two halves cannot disagree', () => {
    const { service } = makeService();
    expect(service.visibleUserWhere(2026)).toEqual({});
    expect(service.visibleRelationWhere('creator', 2026)).toEqual({});
    expect(service.visibleUserSqlPredicate('u', 2026)).toBe('TRUE');
  });

  it('leaves a recipient list untouched', async () => {
    const { service } = makeService([
      { id: 'first', email: 'a_cs26@gla.ac.in' },
      { id: 'senior', email: 'b_cs25@gla.ac.in' },
    ]);
    await expect(
      service.filterInteractableUserIds('first', ['senior']),
    ).resolves.toEqual(['senior']);
  });
});
