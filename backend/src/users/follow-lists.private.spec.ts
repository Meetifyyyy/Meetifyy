import { UsersService } from './users.service';
import { createBlocksServiceMock } from './testing/blocks.service.mock';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { PresenceService } from '../presence/presence.service';
import {
  PUBLIC_AUTHOR,
  privateAuthor,
} from '../posts/testing/author-privacy.fake';
import type { AuthorPrivacyFields } from '../posts/author-visibility';

/**
 * A private account's follower and following lists are for the account itself
 * and its followers. Anyone else gets the empty list a quiet account has, with
 * the same shape, so an installed app renders it as it always did. The counts
 * on the profile are not touched.
 */
describe('UsersService — private account follower and following lists', () => {
  const rows = [
    {
      id: 'f1',
      username: 'f1',
      displayName: 'F1',
      avatar: null,
      bio: null,
      role: 'USER',
      isFollowing: false,
    },
  ];

  const build = (target: AuthorPrivacyFields & { id: string }) => {
    const findUnique = jest.fn((_args: unknown) => Promise.resolve(target));
    const queryRaw = jest.fn(() => Promise.resolve(rows));
    const service = Object.create(UsersService.prototype) as UsersService;
    Object.assign(service, {
      prisma: stub<PrismaService>({
        user: { findUnique },
        $queryRaw: queryRaw,
        userSettings: {
          findMany: () => Promise.resolve([]),
          findUnique: () => Promise.resolve(null),
        },
        follow: { findMany: () => Promise.resolve([]) },
      }),
      blocksService: createBlocksServiceMock(),
      verificationAccess: { isEnforcementEnabled: () => false },
      presenceService: stub<PresenceService>({
        getPresenceMany: () => Promise.resolve(new Map()),
      }),
    });
    return { service, findUnique, queryRaw };
  };

  const target = (row: AuthorPrivacyFields) => ({ id: 'target', ...row });

  describe.each(['getFollowers', 'getFollowing'] as const)('%s', (method) => {
    it('gives a stranger the empty list, and never queries the list', async () => {
      const { service, queryRaw } = build(target(privateAuthor()));
      await expect(service[method]('target', 'stranger')).resolves.toEqual([]);
      expect(queryRaw).not.toHaveBeenCalled();
    });

    it('gives a pending requester the empty list: a request is not a follow', async () => {
      // Only a Follow row is read; a pending request leaves none.
      const { service, queryRaw } = build(target(privateAuthor([])));
      await expect(service[method]('target', 'requester')).resolves.toEqual([]);
      expect(queryRaw).not.toHaveBeenCalled();
    });

    it('gives a signed-out reader the empty list', async () => {
      const { service } = build(target(privateAuthor()));
      await expect(service[method]('target', undefined)).resolves.toEqual([]);
    });

    it('gives a follower the list', async () => {
      const { service, queryRaw } = build(target(privateAuthor(['fan'])));
      const list = await service[method]('target', 'fan');
      expect(list.map((r) => r.id)).toEqual(['f1']);
      expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    it('gives the account itself the list', async () => {
      const { service } = build(target(privateAuthor()));
      const list = await service[method]('target', 'target');
      expect(list.map((r) => r.id)).toEqual(['f1']);
    });

    it('gives everyone the list of a public account', async () => {
      const { service } = build(target(PUBLIC_AUTHOR));
      const list = await service[method]('target', 'stranger');
      expect(list.map((r) => r.id)).toEqual(['f1']);
    });

    it('finds the account and the viewer’s follow row in the one lookup it already made', async () => {
      const { service, findUnique } = build(target(privateAuthor(['fan'])));
      await service[method]('Target ', 'fan');
      expect(findUnique).toHaveBeenCalledTimes(1);
      expect(findUnique).toHaveBeenCalledWith({
        where: { username: 'target' },
        select: {
          id: true,
          settings: { select: { privateProfile: true } },
          followers: {
            where: { followerId: 'fan' },
            select: { followerId: true },
            take: 1,
          },
        },
      });
    });
  });
});
