import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { BlocksService } from './blocks.service';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { PresenceService } from '../presence/presence.service';

/**
 * Opening a profile asks the block list three different questions about the
 * viewer: the mutual list (follower counts), the direction of a block with the
 * profile's owner, and whether the two may see each other's presence. They used
 * to be three Block reads, because the direction was cached per user in two
 * lists and the owner's list was fetched as well. One read of the viewer's rows
 * answers all of them, and the answers must not change.
 */
describe('UsersService — a profile view reads the block list once', () => {
  const VIEWER = 'pv-viewer';
  const TARGET = 'pv-target';

  type Row = { blockerId: string; blockedId: string };

  const build = (rows: Row[]) => {
    const findMany = jest.fn(
      ({ where }: { where: { OR: { blockerId?: string }[] } }) => {
        const me = where.OR[0].blockerId;
        return Promise.resolve(
          rows.filter((r) => r.blockerId === me || r.blockedId === me),
        );
      },
    );
    const target = {
      id: TARGET,
      username: 'target',
      displayName: 'Target',
      email: null,
      avatar: null,
      cover: null,
      bio: null,
      birthday: null,
      college: { name: 'Uni' },
      collegeId: null,
      isCampusRep: false,
      course: null,
      branch: null,
      passingYear: null,
      location: null,
      interests: [],
      verificationStatus: 'UNVERIFIED',
      profileCompleted: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      deletedAt: null,
      settings: {
        privateProfile: false,
        // Presence is public, so the visibility check consults the block list.
        showOnlineStatus: true,
        showCollegeOnProfile: true,
        whoCanSeeOnline: 'everyone',
      },
      _count: { followers: 0, following: 0, posts: 0 },
    };
    const prisma = stub<PrismaService>({
      block: { findMany },
      user: { findFirst: jest.fn(() => Promise.resolve(target)) },
      follow: { findUnique: jest.fn(() => Promise.resolve(null)) },
      followRequest: { findUnique: jest.fn(() => Promise.resolve(null)) },
      userSettings: { findUnique: jest.fn(() => Promise.resolve(null)) },
    });
    const service = Object.create(UsersService.prototype) as UsersService;
    Object.assign(service, {
      prisma,
      blocksService: new BlocksService(prisma),
      presenceService: stub<PresenceService>({
        getPresence: () => Promise.resolve(null),
      }),
    });
    return { service, findMany };
  };

  beforeEach(() => {
    // The block cache is static and outlives each test's service.
    BlocksService['cache'].clear();
  });
  afterAll(() => {
    BlocksService['cache'].clear();
  });

  it('no block: one read, ordinary profile', async () => {
    const { service, findMany } = build([]);
    const profile = await service.getProfileByUsername('target', VIEWER);
    expect(profile.blockedByMe).toBe(false);
    expect(profile.username).toBe('target');
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('the viewer blocked the owner: one read, still reachable, flagged', async () => {
    const { service, findMany } = build([
      { blockerId: VIEWER, blockedId: TARGET },
    ]);
    const profile = await service.getProfileByUsername('target', VIEWER);
    expect(profile.blockedByMe).toBe(true);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('the owner blocked the viewer: one read, and the neutral not-found', async () => {
    const { service, findMany } = build([
      { blockerId: TARGET, blockedId: VIEWER },
    ]);
    const outcome = await service.getProfileByUsername('target', VIEWER).then(
      () => null,
      (e: unknown) => e,
    );
    expect(outcome).toBeInstanceOf(NotFoundException);
    expect((outcome as NotFoundException).message).toBe(
      "This profile isn't available.",
    );
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('a mutual block: one read, refused as blocked by them', async () => {
    const { service, findMany } = build([
      { blockerId: VIEWER, blockedId: TARGET },
      { blockerId: TARGET, blockedId: VIEWER },
    ]);
    await expect(
      service.getProfileByUsername('target', VIEWER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('the by-id twin reads the block list once as well', async () => {
    const { service, findMany } = build([
      { blockerId: VIEWER, blockedId: TARGET },
    ]);
    const prisma = (service as unknown as { prisma: PrismaService }).prisma;
    (prisma.user as unknown as { findUnique: jest.Mock }).findUnique = jest.fn(
      () =>
        Promise.resolve({
          id: TARGET,
          username: 'target',
          displayName: 'Target',
          deletedAt: null,
          settings: { showOnlineStatus: true, whoCanSeeOnline: 'everyone' },
        }),
    );
    const user = await service.getUserById(TARGET, VIEWER);
    expect(user.blockedByMe).toBe(true);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
