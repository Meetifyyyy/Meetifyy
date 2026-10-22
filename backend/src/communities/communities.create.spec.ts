import { ForbiddenException } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Prisma } from '@prisma/client';
import { CommunitiesService } from './communities.service';
import { CreateCommunityDto } from './dto/community.dto';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { RedisService } from '../redis/redis.service';
import type { PresenceService } from '../presence/presence.service';
import type { DefaultAssetsService } from '../uploads/default-assets.service';
import type { BlocksService } from '../users/blocks.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { NotificationFactory } from '../notifications/notification.factory';
import type { CampusAccessService } from '../common/campus/campus-access.service';

/**
 * Creating a community: behaviour, side effects, and the number of sequential
 * round trips (database + Redis) on the critical path of the HTTP response.
 *
 * Each fake call records the "wave" it started in; it finishes one wave later.
 * Calls started together share a wave, so the final wave count is the length
 * of the longest sequential chain of awaited I/O.
 */
describe('CommunitiesService.createCommunity', () => {
  const build = (
    opts: { verified?: boolean; college?: string | null } = {},
  ) => {
    let wave = 0;
    let calls = 0;
    const io = <T>(value: T): Promise<T> => {
      calls += 1;
      const started = wave;
      return Promise.resolve().then(() => {
        wave = Math.max(wave, started + 1);
        return value;
      });
    };

    const userFind = jest.fn((_args: Prisma.UserFindUniqueArgs) =>
      io(
        opts.verified === false
          ? { verificationStatus: 'PENDING' }
          : { verificationStatus: 'VERIFIED' },
      ),
    );
    const slugFind = jest.fn((_args: Prisma.CommunityFindUniqueArgs) =>
      io<{ id: string } | null>(null),
    );
    const communityCreate = jest.fn(
      (args: { data: Prisma.CommunityCreateInput }) =>
        io({ id: 'new', ...args.data }),
    );
    const getActiveCollegeId = jest.fn((_userId: string) =>
      io(opts.college ?? null),
    );
    const smembers = jest.fn((_key: string) => io<string[]>(['all:x']));
    const del = jest.fn((..._keys: string[]) => io(1));
    const emit = jest.fn((_name: string, _payload: unknown) =>
      Promise.resolve(),
    );

    const service = new CommunitiesService(
      stub<PrismaService>({
        user: { findUnique: userFind },
        community: { findUnique: slugFind, create: communityCreate },
      }),
      stub<DomainEventService>({ emit }),
      stub<RedisService>({ getClient: () => stub<Redis>({ smembers, del }) }),
      stub<PresenceService>(),
      stub<DefaultAssetsService>({ refFor: () => null }),
      stub<BlocksService>(),
      stub<NotificationsService>(),
      stub<NotificationFactory>(),
      stub<CampusAccessService>({ getActiveCollegeId }),
    );
    return {
      service,
      communityCreate,
      getActiveCollegeId,
      smembers,
      del,
      emit,
      stats: () => ({ waves: wave, calls }),
    };
  };

  const dto = (extra: Partial<CreateCommunityDto> = {}) =>
    Object.assign(new CreateCommunityDto(), { name: 'Chess Club', ...extra });

  it('creates the community with the owner membership and returns the row', async () => {
    const h = build();
    const result = await h.service.createCommunity(dto(), 'creator');
    expect(result).toMatchObject({ id: 'new', slug: 'chess-club' });
    expect(h.communityCreate.mock.calls[0][0].data).toMatchObject({
      name: 'Chess Club',
      memberCount: 1,
      owner: { connect: { id: 'creator' } },
      members: { create: [{ userId: 'creator', role: 'OWNER' }] },
    });
  });

  it('still emits community.created and invalidates the list cache', async () => {
    const h = build();
    await h.service.createCommunity(dto(), 'creator');
    expect(h.emit).toHaveBeenCalledWith(
      'community.created',
      expect.objectContaining({ communityId: 'new', creatorId: 'creator' }),
    );
    expect(h.del).toHaveBeenCalledWith(
      'all:x',
      'community:new',
      'communities:tag:lists',
    );
  });

  // A throw after the insert would make the idempotency interceptor release
  // the key, and the client's retry would create a second community.
  it('resolves with the created community when post-commit side effects fail', async () => {
    const h = build();
    h.service['invalidateCommunityCache'] = jest.fn(
      (_communityId?: string, _collegeId?: string): Promise<void> =>
        Promise.reject(new Error('redis down')),
    );
    await expect(
      h.service.createCommunity(dto(), 'creator'),
    ).resolves.toMatchObject({ id: 'new', slug: 'chess-club' });
    expect(h.communityCreate).toHaveBeenCalledTimes(1);
  });

  it('refuses an unverified creator and writes nothing', async () => {
    const h = build({ verified: false });
    await expect(h.service.createCommunity(dto(), 'creator')).rejects.toThrow(
      ForbiddenException,
    );
    expect(h.communityCreate).not.toHaveBeenCalled();
    expect(h.emit).not.toHaveBeenCalled();
  });

  it('only looks up the affiliation for a campus community', async () => {
    const h = build();
    await h.service.createCommunity(dto(), 'creator');
    expect(h.getActiveCollegeId).not.toHaveBeenCalled();
  });

  it('binds a campus community to the active affiliation', async () => {
    const h = build({ college: 'college-b' });
    await h.service.createCommunity(dto({ privacy: 'campus' }), 'creator');
    expect(h.communityCreate.mock.calls[0][0].data).toMatchObject({
      isCampusCommunity: true,
      college: { connect: { id: 'college-b' } },
    });
  });

  // Before: user -> slug -> (college) -> create -> SMEMBERS -> DEL -> DEL
  // = 6 sequential round trips (7 for a campus community).
  it('keeps the critical path to 4 sequential round trips', async () => {
    const plain = build();
    await plain.service.createCommunity(dto(), 'creator');
    expect(plain.stats()).toEqual({ waves: 4, calls: 5 });

    const campus = build({ college: 'college-b' });
    await campus.service.createCommunity(dto({ privacy: 'campus' }), 'c');
    expect(campus.stats()).toEqual({ waves: 4, calls: 6 });
  });
});
