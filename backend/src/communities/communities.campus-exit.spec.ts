import { CommunitiesService } from './communities.service';
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
import type { CampusCommunityExit } from '../common/campus/campus-community-exit';

/**
 * What the app does after a campus exit commits: the same follow-up a normal
 * leave has, plus the announcement of a handover.
 */
describe('CommunitiesService campus exit follow-up', () => {
  const build = () => {
    const emit = jest.fn(() => Promise.resolve());
    const del = jest.fn(() => Promise.resolve(1));
    const redis = {
      smembers: jest.fn(() => Promise.resolve(['communities:all:30:0'])),
      del,
    };
    const tx = {
      communityMember: {
        findUnique: jest.fn(() => Promise.resolve({ userId: 'u' })),
        delete: jest.fn(() => Promise.resolve({})),
      },
      community: {
        update: jest.fn(() => Promise.resolve({ memberCount: 6 })),
      },
    };
    const service = new CommunitiesService(
      stub<PrismaService>({
        community: {
          findUnique: jest.fn(() =>
            Promise.resolve({
              deletedAt: null,
              ownerId: 'someone',
              collegeId: 'college-1',
              memberCount: 7,
            }),
          ),
        },
        $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) =>
          fn(tx),
        ),
      }),
      stub<DomainEventService>({ emit }),
      stub<RedisService>({
        getClient: () => redis as never,
        withLock: jest.fn(
          (_k: string, _t: number, fn: () => Promise<unknown>) => fn(),
        ),
      }),
      stub<PresenceService>(),
      stub<DefaultAssetsService>(),
      stub<BlocksService>(),
      stub<NotificationsService>(),
      stub<NotificationFactory>(),
      stub<CampusAccessService>(),
    );
    return { service, emit, del };
  };

  const exit: CampusCommunityExit = {
    removed: [
      { communityId: 'c1', memberCount: 4 },
      { communityId: 'c2', memberCount: 0 },
    ],
    transfers: [
      { communityId: 'c1', communityName: 'Coding', newOwnerId: 'heir' },
    ],
    unsuccessored: [],
  };

  it('announces each leave exactly as a normal leave does, and drops the caches', async () => {
    const { service, emit, del } = build();

    await service.announceCampusExit('u', 'college-1', exit);

    expect(emit).toHaveBeenCalledWith('community.memberLeft', {
      communityId: 'c1',
      userId: 'u',
      memberCount: 4,
    });
    expect(emit).toHaveBeenCalledWith('community.memberLeft', {
      communityId: 'c2',
      userId: 'u',
      memberCount: 0,
    });
    const deleted = del.mock.calls.flat() as string[];
    expect(deleted).toEqual(
      expect.arrayContaining(['community:c1', 'community:c2']),
    );
  });

  it('announces a handover as transferOwnership does, to both people', async () => {
    const { service, emit } = build();

    await service.announceCampusExit('u', 'college-1', exit);

    expect(emit).toHaveBeenCalledWith(
      'community.ownershipTransferred',
      {
        communityId: 'c1',
        newOwnerId: 'heir',
        previousOwnerId: 'u',
        communityName: 'Coding',
      },
      ['heir', 'u'],
    );
  });

  it('does nothing for an exit that changed nothing', async () => {
    const { service, emit, del } = build();
    await service.announceCampusExit('u', 'college-1', {
      removed: [],
      transfers: [],
      unsuccessored: [],
    });
    expect(emit).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('still emits the leave event and clears caches for an ordinary leave', async () => {
    const { service, emit, del } = build();

    await service.leaveCommunity('c1', 'u');

    expect(emit).toHaveBeenCalledWith('community.memberLeft', {
      communityId: 'c1',
      userId: 'u',
      memberCount: 6,
    });
    expect(del.mock.calls.flat()).toContain('community:c1');
  });
});
