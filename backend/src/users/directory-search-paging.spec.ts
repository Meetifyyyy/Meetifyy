import type { Prisma } from '@prisma/client';
import { affiliatedWith } from '../common/campus/testing/affiliation.fixture';
import { UsersService } from './users.service';
import { createBlocksServiceMock } from './testing/blocks.service.mock';

/**
 * A directory search keeps filtering on every page (pending item A18).
 *
 * The search clause and the keyset cursor are both `OR`s. Spread into one
 * `where`, the cursor's replaced the search's, so page 1 was filtered and
 * every later page was the next alphabetical slice of the whole college.
 *
 * The fake evaluates the `where` it is given against an in-memory college,
 * so this checks what a page contains rather than how the query is spelt.
 */
type Row = {
  id: string;
  username: string;
  displayName: string;
  collegeId: string;
  accountStatus: string;
  deletedAt: Date | null;
  avatar: null;
  course: null;
  branch: null;
  passingYear: null;
  createdAt: Date;
  /** The verified college email, as the relation filter sees it. */
  collegeAffiliation: { collegeId: string; revokedAt: Date | null } | null;
};

/** The subset of Prisma's filter language the directory query uses. */
function matches(row: Row, where: Prisma.UserWhereInput | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === 'OR')
      return (cond as Prisma.UserWhereInput[]).some((w) => matches(row, w));
    if (key === 'AND')
      return ([] as Prisma.UserWhereInput[])
        .concat(cond as Prisma.UserWhereInput[])
        .every((w) => matches(row, w));
    if (key === 'collegeAffiliation') {
      const is = (cond as { is: { collegeId: string; revokedAt: null } }).is;
      const a = row.collegeAffiliation;
      return Boolean(
        a && a.collegeId === is.collegeId && a.revokedAt === is.revokedAt,
      );
    }
    const value = row[key as Exclude<keyof Row, 'collegeAffiliation'>];
    if (cond === null || typeof cond !== 'object' || cond instanceof Date)
      return value === cond;
    const c = cond as { not?: unknown; gt?: string; contains?: string };
    if ('not' in c) return value !== c.not;
    if (c.gt !== undefined) return String(value) > c.gt;
    if (c.contains !== undefined)
      return String(value).toLowerCase().includes(c.contains.toLowerCase());
    throw new Error(`unsupported filter on ${key}: ${JSON.stringify(cond)}`);
  });
}

describe('UsersService — directory search across pages (A18)', () => {
  const ME = 'me';
  const person = (id: string, displayName: string): Row => ({
    id,
    username: id,
    displayName,
    collegeId: 'college-1',
    accountStatus: 'ACTIVE',
    deletedAt: null,
    avatar: null,
    course: null,
    branch: null,
    passingYear: null,
    createdAt: new Date('2026-01-01'),
    collegeAffiliation: { collegeId: 'college-1', revokedAt: null },
  });
  const college = [
    person('u1', 'Aanya'),
    person('u2', 'Bharat'),
    person('u3', 'Chandan'),
    person('u4', 'Dev'),
    person('u5', 'Eshan'),
    person('u6', 'Farhan'),
    person('u7', 'Gita'),
  ];

  /**
   * Same college on the mirror, but no verified college email: a legacy row
   * the backfill skipped, and one an admin revoked. Neither is listed.
   */
  const unverified: Row[] = [
    { ...person('u8', 'Harsh'), collegeAffiliation: null },
    {
      ...person('u9', 'Isha'),
      collegeAffiliation: { collegeId: 'college-1', revokedAt: new Date() },
    },
  ];

  const build = () => {
    const service = Object.create(UsersService.prototype) as UsersService;
    Object.assign(service, {
      prisma: {
        // The viewer's campus is their ACTIVE affiliation.
        collegeAffiliation: {
          findUnique: () => Promise.resolve(affiliatedWith('college-1')),
        },
        user: {
          findMany: (args: Prisma.UserFindManyArgs) =>
            Promise.resolve(
              [...college, ...unverified]
                .filter((r) => matches(r, args.where))
                .sort(
                  (a, b) =>
                    a.displayName.localeCompare(b.displayName) ||
                    a.id.localeCompare(b.id),
                )
                .slice(0, args.take),
            ),
        },
      },
      blocksService: createBlocksServiceMock([]),
      getFollowingSet: () => Promise.resolve(new Set()),
    });
    return service;
  };

  /** Every page of `search`, following nextCursor to the end. */
  const allPages = async (search: string) => {
    const service = build();
    const pages: string[][] = [];
    let cursor: string | undefined;
    do {
      const page = await service.getDirectory(ME, { search, limit: 1, cursor });
      pages.push(page.users.map((u) => u.displayName ?? ''));
      cursor = page.nextCursor;
    } while (cursor && pages.length < 20);
    return pages;
  };

  it('returns only matches on every page, each exactly once', async () => {
    const pages = await allPages('an');
    expect(pages.flat()).toEqual(['Aanya', 'Chandan', 'Eshan', 'Farhan']);
    expect(pages.every((p) => p.length === 1)).toBe(true);
  });

  it('still pages the whole college when there is no search', async () => {
    const pages = await allPages('');
    expect(pages.flat()).toEqual(college.map((p) => p.displayName));
  });

  it('never lists a collegeId-only (legacy) or revoked user', async () => {
    const names = (await allPages('')).flat();
    expect(names).not.toContain('Harsh');
    expect(names).not.toContain('Isha');
    expect(await allPages('Harsh')).toEqual([[]]);
  });

  it('applies the same rule to GET /api/users/campus', async () => {
    const service = build();
    const users = (await service.getCampusUsers(ME, 50, 0, {
      collegeId: 'college-1',
    })) as Array<{ id: string }>;
    const ids = users.map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining(['u1', 'u7']));
    expect(ids).not.toContain('u8');
    expect(ids).not.toContain('u9');
  });
});
