import type { Prisma } from '@prisma/client';
import { affiliatedWith } from '../common/campus/testing/affiliation.fixture';
import { UsersService } from './users.service';
import { createBlocksServiceMock } from './testing/blocks.service.mock';

/**
 * The directory card shows the campus representative badge beside a name, so
 * the directory says who is one, and says nothing more about a blocked row
 * than its name (a blocked representative is not marked as one).
 */
describe('UsersService — directory representative badge', () => {
  const row = (id: string, isCampusRep: boolean) => ({
    id,
    username: id,
    displayName: id.toUpperCase(),
    avatar: null,
    isCampusRep,
    course: null,
    branch: null,
    passingYear: null,
    createdAt: new Date('2026-01-01'),
  });

  const build = (blocked: { blockerId: string; blockedId: string }[]) => {
    const findMany = jest.fn((_args: Prisma.UserFindManyArgs) =>
      Promise.resolve([
        row('rep', true),
        row('member', false),
        row('blockedrep', true),
      ]),
    );
    const service = Object.create(UsersService.prototype) as UsersService;
    Object.assign(service, {
      prisma: {
        collegeAffiliation: {
          findUnique: () => Promise.resolve(affiliatedWith('college-1')),
        },
        user: { findMany },
      },
      blocksService: createBlocksServiceMock(blocked),
      getFollowingSet: () => Promise.resolve(new Set()),
    });
    return { service, findMany };
  };

  it('returns isCampusRep for each person, and false for a blocked one', async () => {
    const { service, findMany } = build([
      { blockerId: 'me', blockedId: 'blockedrep' },
    ]);
    const page = await service.getDirectory('me', { limit: 20 });
    const select = findMany.mock.calls[0][0].select as Record<string, unknown>;
    expect(select.isCampusRep).toBe(true);
    expect(page.users.map((u) => [u.id, u.isCampusRep])).toEqual([
      ['rep', true],
      ['member', false],
      ['blockedrep', false],
    ]);
  });
});
