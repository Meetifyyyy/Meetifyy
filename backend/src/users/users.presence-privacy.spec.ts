import { UsersService } from './users.service';
import { maskPresenceForViewer } from './privacy.helper';
import { createBlocksServiceMock } from './testing/blocks.service.mock';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { PresenceService } from '../presence/presence.service';

jest.mock('../auth/auth.service', () => ({ clearAuthSyncCache: jest.fn() }));

const SEEN = '2026-10-01T10:00:00.000Z';
const online = (status: 'online' | 'offline' = 'online') => ({
  status,
  lastSeen: SEEN,
  socketIds: [] as string[],
});

type SettingsRow = {
  userId: string;
  showOnlineStatus: boolean;
  whoCanSeeOnline: string;
};

/**
 * `isOnline` and `lastActive` are the same disclosure: an offline user's
 * last-seen time says as much as a green dot. Several lists masked the first
 * and still sent the second to a blocked viewer, to someone the target hides
 * presence from, or to anyone at all.
 */
describe('maskPresenceForViewer', () => {
  const build = (viewerSettings: { showOnlineStatus: boolean } | null = null) =>
    stub<PrismaService>({
      userSettings: { findUnique: () => Promise.resolve(viewerSettings) },
      follow: { findMany: () => Promise.resolve([]) },
    });

  const run = (
    viewer: string | undefined,
    targets: Array<{ userId: string; rule: string; isEnabled: boolean }>,
    blocks: Array<{ blockerId: string; blockedId: string }> = [],
    viewerSettings: { showOnlineStatus: boolean } | null = null,
  ) =>
    maskPresenceForViewer(
      viewer,
      targets,
      new Map(targets.map((t) => [t.userId, online()])),
      build(viewerSettings),
      createBlocksServiceMock(blocks),
    );

  it('shows presence the target allows', async () => {
    const out = await run('viewer', [
      { userId: 't', rule: 'everyone', isEnabled: true },
    ]);
    expect(out.get('t')).toEqual({ isOnline: true, lastActive: SEEN });
  });

  it('masks both fields when the target hides presence from everyone', async () => {
    const out = await run('viewer', [
      { userId: 't', rule: 'nobody', isEnabled: true },
    ]);
    expect(out.get('t')).toEqual({ isOnline: false, lastActive: null });
  });

  it('masks both fields when the target switched presence off', async () => {
    const out = await run('viewer', [
      { userId: 't', rule: 'everyone', isEnabled: false },
    ]);
    expect(out.get('t')).toEqual({ isOnline: false, lastActive: null });
  });

  it('masks both fields across a block, whichever side placed it', async () => {
    const out = await run(
      'viewer',
      [
        { userId: 'iBlocked', rule: 'everyone', isEnabled: true },
        { userId: 'blockedMe', rule: 'everyone', isEnabled: true },
      ],
      [
        { blockerId: 'viewer', blockedId: 'iBlocked' },
        { blockerId: 'blockedMe', blockedId: 'viewer' },
      ],
    );
    expect(out.get('iBlocked')).toEqual({ isOnline: false, lastActive: null });
    expect(out.get('blockedMe')).toEqual({ isOnline: false, lastActive: null });
  });

  it('masks everything for a viewer who hides their own status', async () => {
    const out = await run(
      'viewer',
      [{ userId: 't', rule: 'everyone', isEnabled: true }],
      [],
      { showOnlineStatus: false },
    );
    expect(out.get('t')).toEqual({ isOnline: false, lastActive: null });
  });

  it('masks everything for an anonymous viewer', async () => {
    const out = await run(undefined, [
      { userId: 't', rule: 'everyone', isEnabled: true },
    ]);
    expect(out.get('t')).toEqual({ isOnline: false, lastActive: null });
  });

  it('reports an offline but visible user as offline with their last-seen time', async () => {
    const out = await maskPresenceForViewer(
      'viewer',
      [{ userId: 't', rule: 'everyone', isEnabled: true }],
      new Map([['t', online('offline')]]),
      build(),
      createBlocksServiceMock(),
    );
    expect(out.get('t')).toEqual({ isOnline: false, lastActive: SEEN });
  });
});

describe('UsersService — follower / following lists and presence', () => {
  const VIEWER = 'viewer';

  const build = (settings: SettingsRow[]) => {
    const prisma = stub<PrismaService>({
      user: { findUnique: () => Promise.resolve({ id: 'target' }) },
      $queryRaw: jest.fn(() =>
        Promise.resolve(
          settings.map((s) => ({
            id: s.userId,
            username: s.userId,
            displayName: s.userId,
            avatar: null,
            bio: null,
            role: 'USER',
            isFollowing: false,
          })),
        ),
      ),
      userSettings: {
        findMany: () => Promise.resolve(settings),
        findUnique: () => Promise.resolve(null),
      },
      follow: { findMany: () => Promise.resolve([]) },
    });
    const service = Object.create(UsersService.prototype) as UsersService;
    Object.assign(service, {
      prisma,
      blocksService: createBlocksServiceMock(),
      verificationAccess: { isEnforcementEnabled: () => false },
      presenceService: stub<PresenceService>({
        getPresenceMany: (ids: string[]) =>
          Promise.resolve(new Map(ids.map((id) => [id, online()]))),
      }),
    });
    return service;
  };

  const settings: SettingsRow[] = [
    { userId: 'open', showOnlineStatus: true, whoCanSeeOnline: 'everyone' },
    { userId: 'nobody', showOnlineStatus: true, whoCanSeeOnline: 'nobody' },
    { userId: 'off', showOnlineStatus: false, whoCanSeeOnline: 'everyone' },
  ];

  it.each(['getFollowers', 'getFollowing'] as const)(
    '%s masks isOnline and lastActive together',
    async (method) => {
      const service = build(settings);
      const rows = await service[method]('target', VIEWER, 50, 0);
      const byId = new Map(rows.map((r) => [r.id, r]));

      expect(byId.get('open')).toMatchObject({
        isOnline: true,
        lastActive: SEEN,
      });
      expect(byId.get('nobody')).toMatchObject({
        isOnline: false,
        online: false,
        lastActive: null,
      });
      expect(byId.get('off')).toMatchObject({
        isOnline: false,
        online: false,
        lastActive: null,
      });
    },
  );

  it.each(['getFollowers', 'getFollowing'] as const)(
    '%s shows nothing to an anonymous caller',
    async (method) => {
      const service = build(settings);
      const rows = await service[method]('target', undefined, 50, 0);
      expect(rows.every((r) => !r.isOnline && r.lastActive === null)).toBe(
        true,
      );
    },
  );
});

describe('UsersService.getProfileByUsername', () => {
  const targetRow = {
    id: 'target',
    username: 'sam',
    displayName: 'Sam',
    avatar: null,
    cover: null,
    bio: null,
    birthday: null,
    college: null,
    collegeId: null,
    isCampusRep: false,
    course: null,
    branch: null,
    passingYear: null,
    location: null,
    interests: [],
    verificationStatus: 'UNVERIFIED',
    profileCompleted: true,
    createdAt: new Date('2026-01-01'),
    deletedAt: null,
    settings: { showOnlineStatus: true, whoCanSeeOnline: 'nobody' },
    _count: { followers: 0, following: 0, posts: 0 },
  };

  const build = () => {
    const findFirst = jest.fn(() => Promise.resolve(targetRow));
    const prisma = stub<PrismaService>({
      user: { findFirst },
      follow: { findUnique: () => Promise.resolve(null) },
      userSettings: { findUnique: () => Promise.resolve(null) },
    });
    const service = Object.create(UsersService.prototype) as UsersService;
    Object.assign(service, {
      prisma,
      blocksService: createBlocksServiceMock(),
      presenceService: stub<PresenceService>({
        getPresence: () => Promise.resolve(online()),
      }),
    });
    return { service, findFirst };
  };

  it('does not look an account up by email or college email', async () => {
    const { service, findFirst } = build();
    await service.getProfileByUsername('someone@college.edu', 'viewer');

    const where = (
      findFirst.mock.calls[0] as unknown as [
        { where: { OR: Array<Record<string, unknown>> } },
      ]
    )[0].where;
    const keys = where.OR.flatMap((clause) => Object.keys(clause));
    expect(keys.sort()).toEqual(['id', 'username']);
  });

  it('withholds lastActive along with isOnline when the target hides presence', async () => {
    const { service } = build();
    const profile = await service.getProfileByUsername('sam', 'viewer');
    expect(profile.isOnline).toBe(false);
    expect(profile.lastActive).toBeNull();
  });
});

describe('UsersService.getCampusUsers', () => {
  it('leaves out people the viewer is blocked with', async () => {
    const findMany = jest.fn(() => Promise.resolve([]));
    const service = Object.create(UsersService.prototype) as UsersService;
    Object.assign(service, {
      prisma: stub<PrismaService>({ user: { findMany } }),
      blocksService: createBlocksServiceMock([
        { blockerId: 'viewer', blockedId: 'enemy' },
        { blockerId: 'fan', blockedId: 'viewer' },
      ]),
    });

    await service.getCampusUsers('viewer', 50, 0, { collegeId: 'college-a' });

    const where = (
      findMany.mock.calls[0] as unknown as [{ where: { AND: unknown[] } }]
    )[0].where;
    expect(where.AND).toContainEqual({
      id: { notIn: ['enemy', 'fan'] },
    });
  });
});

describe('UsersService.followUser', () => {
  it('only matches an ACTIVE account', async () => {
    const queryRaw = jest.fn(() => Promise.resolve([]));
    const service = Object.create(UsersService.prototype) as UsersService;
    Object.assign(service, {
      prisma: stub<PrismaService>({ $queryRaw: queryRaw }),
      logger: { warn: jest.fn(), debug: jest.fn(), log: jest.fn() },
    });

    await service.followUser('me', 'suspended-user').catch(() => undefined);

    const strings = (queryRaw.mock.calls[0] as unknown as [string[]])[0];
    expect(strings.join('?')).toMatch(/"accountStatus"::text = 'ACTIVE'/);
  });
});
