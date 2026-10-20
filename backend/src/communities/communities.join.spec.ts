import { BadRequestException, ForbiddenException } from '@nestjs/common';
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
import type { Prisma } from '@prisma/client';
import { CreateCommunityDto } from './dto/community.dto';

/**
 * Joining a community (docs/college-affiliation.md, "Selfie gate").
 *
 * Joining, requesting to join and approving a request are NOT selfie-gated:
 * only creating a community is. A campus community instead requires the
 * joiner's ACTIVE college affiliation to that college; the `User.collegeId`
 * mirror (which outlives a removed or revoked email) never grants it.
 */
describe('CommunitiesService — joining', () => {
  const COMMUNITY = 'c1';
  const USER = 'joiner';

  type CommunityRow = {
    deletedAt: Date | null;
    isPrivate: boolean;
    isCampusCommunity: boolean;
    collegeId: string | null;
    ownerId: string;
    memberCount: number;
    college: { name: string } | null;
  };

  const community = (over: Partial<CommunityRow> = {}): CommunityRow => ({
    deletedAt: null,
    isPrivate: false,
    isCampusCommunity: false,
    collegeId: null,
    ownerId: 'owner',
    memberCount: 3,
    college: null,
    ...over,
  });

  const build = (
    comm: CommunityRow,
    activeCollegeId: string | null,
    opts: {
      requesterRole?: string | null;
      requestStatus?: string;
      /** The requester already has a member row (joined another way). */
      alreadyMember?: boolean;
    } = {},
  ) => {
    // The request and member row are state, so a second call sees what the
    // first one wrote — which is what the double-call cases are about.
    const state = {
      requestStatus: opts.requestStatus ?? 'PENDING',
      isMember: opts.alreadyMember ?? false,
      memberCount: 3,
    };
    const tx = {
      communityMember: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() => Promise.resolve({})),
        upsert: jest.fn(() => Promise.resolve({})),
        createMany: jest.fn(() => {
          const count = state.isMember ? 0 : 1;
          state.isMember = true;
          return Promise.resolve({ count });
        }),
      },
      community: {
        update: jest.fn(
          (args: { data: { memberCount: { increment: number } } }) => {
            state.memberCount += args.data.memberCount.increment;
            return Promise.resolve({ memberCount: state.memberCount });
          },
        ),
        findUnique: jest.fn(() =>
          Promise.resolve({ memberCount: state.memberCount }),
        ),
      },
      communityJoinRequest: {
        update: jest.fn(() => Promise.resolve({})),
        updateMany: jest.fn(
          (args: { where: { status: string }; data: { status: string } }) => {
            if (state.requestStatus !== args.where.status) {
              return Promise.resolve({ count: 0 });
            }
            state.requestStatus = args.data.status;
            return Promise.resolve({ count: 1 });
          },
        ),
      },
    };
    const prisma = {
      // Unverified selfie AND a matching mirror: neither may decide anything.
      user: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            verificationStatus: 'UNVERIFIED',
            collegeId: 'college-a',
          }),
        ),
      },
      community: {
        findUnique: jest.fn(() => Promise.resolve(comm)),
      },
      communityMember: {
        findUnique: jest.fn(() =>
          Promise.resolve(
            opts.requesterRole ? { role: opts.requesterRole } : null,
          ),
        ),
      },
      communityJoinRequest: {
        upsert: jest.fn(() => Promise.resolve({})),
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: 'r1',
            communityId: COMMUNITY,
            userId: USER,
            status: state.requestStatus,
          }),
        ),
        updateMany: tx.communityJoinRequest.updateMany,
      },
      $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const getActiveCollegeId = jest.fn<Promise<string | null>, [string]>(() =>
      Promise.resolve(activeCollegeId),
    );
    const domainEmit = jest.fn((_type: string, _payload?: unknown) =>
      Promise.resolve(),
    );
    const service = new CommunitiesService(
      stub<PrismaService>(prisma),
      stub<DomainEventService>({ emit: domainEmit }),
      stub<RedisService>({
        getClient: () => null,
        withLock: <T>(_k: string, _t: number, fn: () => Promise<T>) => fn(),
      }),
      stub<PresenceService>(),
      stub<DefaultAssetsService>(),
      stub<BlocksService>(),
      stub<NotificationsService>(),
      stub<NotificationFactory>(),
      stub<CampusAccessService>({ getActiveCollegeId }),
    );
    Object.assign(service, {
      invalidateCommunityCache: jest.fn(() => Promise.resolve()),
    });
    return { service, prisma, tx, getActiveCollegeId, state, domainEmit };
  };

  describe('joinCommunity', () => {
    it('lets a selfie-unverified user join a public community', async () => {
      const { service, tx, prisma } = build(community(), null);
      await expect(service.joinCommunity(COMMUNITY, USER)).resolves.toEqual(
        expect.objectContaining({ status: 'MEMBER', isJoined: true }),
      );
      expect(tx.communityMember.create).toHaveBeenCalled();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('lets a selfie-unverified user request a private community', async () => {
      const { service, prisma } = build(community({ isPrivate: true }), null);
      await expect(service.joinCommunity(COMMUNITY, USER)).resolves.toEqual(
        expect.objectContaining({ status: 'PENDING' }),
      );
      expect(prisma.communityJoinRequest.upsert).toHaveBeenCalled();
    });

    const campus = community({
      isCampusCommunity: true,
      collegeId: 'college-a',
      college: { name: 'College A' },
    });

    it('admits an unverified user holding the active affiliation', async () => {
      const { service, tx, getActiveCollegeId } = build(campus, 'college-a');
      await service.joinCommunity(COMMUNITY, USER);
      expect(getActiveCollegeId).toHaveBeenCalledWith(USER);
      expect(tx.communityMember.create).toHaveBeenCalled();
    });

    it('refuses a campus join with only the mirror (no active affiliation)', async () => {
      const { service, tx } = build(campus, null);
      const attempt = service.joinCommunity(COMMUNITY, USER);
      await expect(attempt).rejects.toThrow(ForbiddenException);
      await expect(attempt).rejects.toThrow(
        "limited to people who verified College A's email",
      );
      expect(tx.communityMember.create).not.toHaveBeenCalled();
    });

    it('refuses a user affiliated with another college', async () => {
      const { service } = build(campus, 'college-b');
      await expect(service.joinCommunity(COMMUNITY, USER)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('acceptJoinRequest', () => {
    it('approves a selfie-unverified requester', async () => {
      const { service, tx } = build(community({ isPrivate: true }), null, {
        requesterRole: 'OWNER',
      });
      await service.acceptJoinRequest(COMMUNITY, 'r1', 'owner');
      expect(tx.communityMember.createMany).toHaveBeenCalled();
    });

    const privateOwned = () =>
      build(community({ isPrivate: true }), null, { requesterRole: 'OWNER' });

    it('counts the new member once, however many times it is called', async () => {
      const { service, state, domainEmit } = privateOwned();

      await service.acceptJoinRequest(COMMUNITY, 'r1', 'owner');
      await service.acceptJoinRequest(COMMUNITY, 'r1', 'owner');
      await service.acceptJoinRequest(COMMUNITY, 'r1', 'owner');

      // Used to be 3 -> 6: every repeat incremented the counter again.
      expect(state.memberCount).toBe(4);
      expect(state.requestStatus).toBe('ACCEPTED');
      const accepted = domainEmit.mock.calls.filter(
        ([type]) => type === 'community.requestAccepted',
      );
      expect(accepted).toHaveLength(1);
    });

    it('does not count a member who already joined another way', async () => {
      const { service, state } = build(community({ isPrivate: true }), null, {
        requesterRole: 'OWNER',
        alreadyMember: true,
      });

      await service.acceptJoinRequest(COMMUNITY, 'r1', 'owner');

      expect(state.memberCount).toBe(3);
      expect(state.requestStatus).toBe('ACCEPTED');
    });

    it('does not let a declined request be accepted afterwards', async () => {
      const { service, state, tx } = build(
        community({ isPrivate: true }),
        null,
        {
          requesterRole: 'OWNER',
          requestStatus: 'DECLINED',
        },
      );

      await expect(
        service.acceptJoinRequest(COMMUNITY, 'r1', 'owner'),
      ).rejects.toThrow(BadRequestException);
      expect(tx.communityMember.createMany).not.toHaveBeenCalled();
      expect(state.memberCount).toBe(3);
    });

    it('loses a race cleanly: the request moved off PENDING after it was read', async () => {
      const { service, state, tx } = privateOwned();
      // Read as PENDING, but another moderator wins the conditional write.
      tx.communityJoinRequest.updateMany.mockImplementationOnce(() => {
        state.requestStatus = 'ACCEPTED';
        return Promise.resolve({ count: 0 });
      });

      await expect(
        service.acceptJoinRequest(COMMUNITY, 'r1', 'owner'),
      ).resolves.toEqual({ success: true });
      expect(tx.communityMember.createMany).not.toHaveBeenCalled();
      expect(state.memberCount).toBe(3);
    });
  });

  describe('declineJoinRequest', () => {
    it('declines once and is quiet on repeat', async () => {
      const { service, state, domainEmit } = build(
        community({ isPrivate: true }),
        null,
        { requesterRole: 'OWNER' },
      );

      await service.declineJoinRequest(COMMUNITY, 'r1', 'owner');
      await service.declineJoinRequest(COMMUNITY, 'r1', 'owner');

      expect(state.requestStatus).toBe('DECLINED');
      const declined = domainEmit.mock.calls.filter(
        ([type]) => type === 'community.requestDeclined',
      );
      expect(declined).toHaveLength(1);
    });

    it('cannot flip an accepted request to declined', async () => {
      const { service, state } = build(community({ isPrivate: true }), null, {
        requesterRole: 'OWNER',
        requestStatus: 'ACCEPTED',
      });

      await expect(
        service.declineJoinRequest(COMMUNITY, 'r1', 'owner'),
      ).rejects.toThrow(BadRequestException);
      expect(state.requestStatus).toBe('ACCEPTED');
    });
  });

  describe('acceptJoinRequest (campus)', () => {
    it('refuses a campus requester whose affiliation is gone', async () => {
      const { service, tx } = build(
        community({
          isPrivate: true,
          isCampusCommunity: true,
          collegeId: 'college-a',
        }),
        null,
      );
      await expect(
        service.acceptJoinRequest(COMMUNITY, 'r1', 'owner'),
      ).rejects.toThrow(ForbiddenException);
      expect(tx.communityMember.createMany).not.toHaveBeenCalled();
    });
  });

  describe('createCommunity (campus)', () => {
    const create = (activeCollegeId: string | null) => {
      const communityCreate = jest.fn(
        (args: { data: Prisma.CommunityCreateInput }) =>
          Promise.resolve({ id: 'new', ...args.data }),
      );
      const getActiveCollegeId = jest.fn<Promise<string | null>, [string]>(() =>
        Promise.resolve(activeCollegeId),
      );
      const service = new CommunitiesService(
        stub<PrismaService>({
          user: {
            // Selfie-verified (creating IS gated) with a stale mirror.
            findUnique: jest.fn(() =>
              Promise.resolve({
                verificationStatus: 'VERIFIED',
                collegeId: 'college-a',
              }),
            ),
          },
          community: {
            findUnique: jest.fn(() => Promise.resolve(null)),
            create: communityCreate,
          },
        }),
        stub<DomainEventService>({ emit: jest.fn(() => Promise.resolve()) }),
        stub<RedisService>({ getClient: () => null }),
        stub<PresenceService>(),
        stub<DefaultAssetsService>({ refFor: () => null }),
        stub<BlocksService>(),
        stub<NotificationsService>(),
        stub<NotificationFactory>(),
        stub<CampusAccessService>({ getActiveCollegeId }),
      );
      Object.assign(service, {
        invalidateCommunityCache: jest.fn(() => Promise.resolve()),
      });
      const dto = Object.assign(new CreateCommunityDto(), {
        name: 'Campus club',
        isCampusCommunity: true,
      });
      return {
        run: () => service.createCommunity(dto, 'creator'),
        communityCreate,
      };
    };

    it("binds a campus community to the creator's active affiliation", async () => {
      const { run, communityCreate } = create('college-b');
      await run();
      expect(communityCreate.mock.calls[0][0].data).toMatchObject({
        isCampusCommunity: true,
        college: { connect: { id: 'college-b' } },
      });
    });

    it('never binds one to the mirror when there is no active affiliation', async () => {
      const { run, communityCreate } = create(null);
      await run();
      const data = communityCreate.mock.calls[0][0].data;
      expect(data.college).toBeUndefined();
      expect(data.isCampusCommunity).toBeUndefined();
    });
  });
});
