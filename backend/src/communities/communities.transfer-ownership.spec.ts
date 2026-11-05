import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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

/**
 * Handing a community to another member.
 *
 * Ownership is the strongest power in a community (edit, delete, re-role
 * anyone), so who may give it, and to whom, is checked here rather than
 * trusted from the client.
 */
describe('CommunitiesService.transferOwnership', () => {
  const ID = 'comm-1';
  const OWNER = 'owner-1';
  const TARGET = 'member-2';

  type Community = {
    ownerId: string | null;
    deletedAt: Date | null;
    collegeId: string | null;
    isCampusCommunity: boolean;
    name: string;
  };
  type Member = {
    role: string;
    user: {
      deletedAt: Date | null;
      accountStatus: string;
      verificationStatus: string;
    };
  } | null;

  type BuildOptions = {
    community?: Community | null;
    target?: Member;
    movedCount?: number;
    promotedCount?: number;
    targetCollegeId?: string | null;
  };

  const build = ({
    community = {
      ownerId: OWNER,
      deletedAt: null,
      collegeId: null,
      isCampusCommunity: false,
      name: 'Chess',
    },
    target = {
      role: 'MEMBER',
      user: {
        deletedAt: null,
        accountStatus: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
    },
    movedCount = 1,
    promotedCount = 1,
    targetCollegeId = null,
  }: BuildOptions = {}) => {
    const communityUpdateMany = jest.fn(() =>
      Promise.resolve({ count: movedCount }),
    );
    const memberUpdateMany = jest.fn(
      (args: { where: { userId: string }; data: { role: string } }) =>
        Promise.resolve({
          count: args.where.userId === TARGET ? promotedCount : 1,
        }),
    );
    const tx = {
      community: { updateMany: communityUpdateMany },
      communityMember: { updateMany: memberUpdateMany },
    };
    const emit = jest.fn(() => Promise.resolve());
    const service = new CommunitiesService(
      stub<PrismaService>({
        community: { findUnique: jest.fn(() => Promise.resolve(community)) },
        communityMember: { findUnique: jest.fn(() => Promise.resolve(target)) },
        $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) =>
          fn(tx),
        ),
      }),
      stub<DomainEventService>({ emit }),
      stub<RedisService>({ getClient: () => null }),
      stub<PresenceService>(),
      stub<DefaultAssetsService>(),
      stub<BlocksService>(),
      stub<NotificationsService>(),
      stub<NotificationFactory>(),
      stub<CampusAccessService>({
        getActiveCollegeId: jest.fn(() => Promise.resolve(targetCollegeId)),
      }),
    );
    return { service, communityUpdateMany, memberUpdateMany, emit };
  };

  it('makes the member the owner and the old owner a moderator', async () => {
    const { service, communityUpdateMany, memberUpdateMany, emit } = build();

    await expect(service.transferOwnership(ID, TARGET, OWNER)).resolves.toEqual(
      {
        success: true,
        ownerId: TARGET,
      },
    );

    // Conditional on the caller still being the owner.
    expect(communityUpdateMany).toHaveBeenCalledWith({
      where: { id: ID, ownerId: OWNER, deletedAt: null },
      data: { ownerId: TARGET },
    });
    expect(memberUpdateMany).toHaveBeenCalledWith({
      where: { userId: TARGET, communityId: ID },
      data: { role: 'OWNER' },
    });
    expect(memberUpdateMany).toHaveBeenCalledWith({
      where: { userId: OWNER, communityId: ID },
      data: { role: 'MODERATOR' },
    });
    expect(emit).toHaveBeenCalledWith(
      'community.ownershipTransferred',
      expect.objectContaining({ communityId: ID, newOwnerId: TARGET }),
      [TARGET, OWNER],
    );
  });

  it('refuses anyone but the current owner, a moderator included', async () => {
    const { service, communityUpdateMany } = build();
    await expect(
      service.transferOwnership(ID, TARGET, 'moderator-9'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(communityUpdateMany).not.toHaveBeenCalled();
  });

  it('refuses a transfer to oneself', async () => {
    const { service } = build();
    await expect(
      service.transferOwnership(ID, OWNER, OWNER),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses someone who is not a member', async () => {
    const { service } = build({ target: null });
    await expect(
      service.transferOwnership(ID, TARGET, OWNER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses an unverified member: ownership is gated like creating a community', async () => {
    const { service, communityUpdateMany } = build({
      target: {
        role: 'MEMBER',
        user: {
          deletedAt: null,
          accountStatus: 'ACTIVE',
          verificationStatus: 'UNVERIFIED',
        },
      },
    });
    await expect(
      service.transferOwnership(ID, TARGET, OWNER),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(communityUpdateMany).not.toHaveBeenCalled();
  });

  it('refuses a suspended member', async () => {
    const { service } = build({
      target: {
        role: 'MEMBER',
        user: {
          deletedAt: null,
          accountStatus: 'SUSPENDED',
          verificationStatus: 'VERIFIED',
        },
      },
    });
    await expect(
      service.transferOwnership(ID, TARGET, OWNER),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps a campus community with someone still at that campus', async () => {
    const campus = {
      ownerId: OWNER,
      deletedAt: null,
      collegeId: 'college-a',
      isCampusCommunity: true,
      name: 'Robotics',
    };
    const elsewhere = build({
      community: campus,
      targetCollegeId: 'college-b',
    });
    await expect(
      elsewhere.service.transferOwnership(ID, TARGET, OWNER),
    ).rejects.toBeInstanceOf(BadRequestException);
    const same = build({ community: campus, targetCollegeId: 'college-a' });
    await expect(
      same.service.transferOwnership(ID, TARGET, OWNER),
    ).resolves.toMatchObject({
      success: true,
    });
  });

  it('loses a race cleanly: ownership moved meanwhile', async () => {
    const { service } = build({ movedCount: 0 });
    await expect(
      service.transferOwnership(ID, TARGET, OWNER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('loses a race cleanly: the member left meanwhile (404, not a database error)', async () => {
    const { service } = build({ promotedCount: 0 });
    await expect(
      service.transferOwnership(ID, TARGET, OWNER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('is not found for a deleted community', async () => {
    const { service } = build({
      community: {
        ownerId: OWNER,
        deletedAt: new Date(),
        collegeId: null,
        isCampusCommunity: false,
        name: 'Gone',
      },
    });
    await expect(
      service.transferOwnership(ID, TARGET, OWNER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
