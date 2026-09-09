import { UsersService } from './users.service';
import { createBlocksServiceMock } from './testing/blocks.service.mock';

/**
 * The campus directory is alphabetical, and you are at the top of your own.
 *
 * It used to be newest-first, paged on `createdAt`. Ordering by name means the
 * cursor has to be built from the name too — a keyset cursor that does not match
 * its ORDER BY returns overlapping and skipped pages rather than failing, which
 * is the kind of bug that shows up as "somebody is missing from the directory".
 */
describe('UsersService — directory ordering', () => {
  const ME = 'me';
  let prisma: any;
  let service: any;
  let lastArgs: any;

  const row = (id: string, displayName: string) => ({
    id,
    username: id,
    displayName,
    avatar: null,
    course: null,
    branch: null,
    passingYear: null,
    createdAt: new Date('2026-01-01'),
  });

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === ME
            ? { ...row(ME, 'My Own Name'), collegeId: 'college-1' }
            : null,
        ),
        findMany: jest.fn(async (args: any) => {
          lastArgs = args;
          return [
            row('u-b', 'Bella'),
            row('u-a', 'Aarav'),
            row('u-c', 'Chetan'),
          ];
        }),
      },
    };

    service = Object.create(UsersService.prototype);
    service.prisma = prisma;
    service.blocksService = createBlocksServiceMock([]);
    service.studentYearPolicy = {
      injectUserFilter: (where: any) => where,
      getBatchYearFor: async () => null,
      getUserBatchYear: () => null,
      isEnforcementEnabled: () => false,
      visibleUserWhere: () => ({}),
    };
    service.getFollowingSet = async () => new Set();
    service.viewerBatchYear = async () => null;
  });

  it('orders by display name, with id as the tie-break', async () => {
    await service.getDirectory(ME, {});
    expect(lastArgs.orderBy).toEqual([{ displayName: 'asc' }, { id: 'asc' }]);
  });

  /**
   * The viewer is NOT in this payload, and must not be.
   *
   * DirectoryPage renders their card itself, above the list, labelled "(You)" —
   * and relies on the server excluding them, in as many words. Pinning them
   * here as well put the same person on screen twice: once as the page's own
   * "(You)" card and once as an ordinary row. The sort was the missing piece;
   * the pin already existed.
   */
  it('excludes the viewer, whose card the page renders itself', async () => {
    const { users } = await service.getDirectory(ME, {});
    expect(users.some((u: any) => u.id === ME)).toBe(false);
    expect(lastArgs.where.id).toEqual({ not: ME });
  });

  it('excludes them on later pages too', async () => {
    const { users } = await service.getDirectory(ME, { cursor: 'Bella|u-b' });
    expect(users.some((u: any) => u.id === ME)).toBe(false);
  });

  describe('the keyset cursor', () => {
    it('is built from the name it ordered by, not the timestamp', async () => {
      prisma.user.findMany = jest.fn(async (args: any) => {
        lastArgs = args;
        // One more than the limit, so `hasMore` is true and a cursor is emitted.
        return Array.from({ length: 21 }, (_, i) =>
          row(`u-${i}`, `Name ${String(i).padStart(2, '0')}`),
        );
      });

      const { nextCursor } = await service.getDirectory(ME, { limit: 20 });
      expect(nextCursor).toBe('Name 19|u-19');
    });

    it('pages forward from a name, not backward from a date', async () => {
      await service.getDirectory(ME, { cursor: 'Bella|u-b' });
      expect(lastArgs.where.OR).toEqual([
        { displayName: { gt: 'Bella' } },
        { displayName: 'Bella', id: { gt: 'u-b' } },
      ]);
    });

    /**
     * A display name may contain the delimiter; a uuid cannot. Splitting on the
     * first `|` truncated such a name and paged from the wrong place.
     */
    it('splits on the last separator, so a name containing one survives', async () => {
      await service.getDirectory(ME, { cursor: 'Bella | B|u-b' });
      expect(lastArgs.where.OR[0]).toEqual({
        displayName: { gt: 'Bella | B' },
      });
      expect(lastArgs.where.OR[1]).toEqual({
        displayName: 'Bella | B',
        id: { gt: 'u-b' },
      });
    });
  });
});
