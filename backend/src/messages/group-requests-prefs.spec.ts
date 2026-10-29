import { ForbiddenException } from '@nestjs/common';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { PresenceService } from '../presence/presence.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { MentionsService } from '../mentions/mentions.service';
import type { BlocksService } from '../users/blocks.service';
import type { VerificationAccessService } from '../common/verification/verification-access.service';
import type { RateLimitService } from '../common/rate-limit/rate-limit.service';
import { MessagingCoreService } from './core/messaging-core.service';
import { GroupChatsService } from './group-chats/group-chats.service';

/**
 * Join requests and per-user chat preferences:
 * - a decline reports whether it removed anything and refreshes the details
 *   admins read; only an owner or admin may decline;
 * - a re-tapped request is not a new one (admins are not told twice);
 * - muting or pinning reaches the user's other devices;
 * - only the owner and admins are sent a group's pending requests.
 */
const CONV = 'conv-1';
const admin = { role: 'ADMIN', leftAt: null, deletedAt: null };
const member = { role: 'MEMBER', leftAt: null, deletedAt: null };

function core(
  prisma: Record<string, unknown>,
  emit = jest.fn(() => Promise.resolve()),
) {
  const service = new MessagingCoreService(
    stub<PrismaService>(prisma),
    stub<PresenceService>({}),
    stub<DomainEventService>({ emit }),
    stub<MentionsService>({}),
    stub<BlocksService>({ isBlocked: () => Promise.resolve(false) }),
    stub<VerificationAccessService>({
      isEnforcementEnabled: () => false,
      getIneligibleUserIds: () => Promise.resolve([]),
    }),
    stub<RateLimitService>({}),
  );
  service.resolveConversationId = jest.fn(() => Promise.resolve(CONV));
  return { service, emit };
}

describe('declining a join request', () => {
  const conversation = {
    findUnique: jest.fn(() => Promise.resolve({ publicId: 'pub-1' })),
  };

  it('marks it declined, keeps the row, and refreshes the details admins read', async () => {
    const updateMany = jest.fn(() => Promise.resolve({ count: 1 }));
    const deleteMany = jest.fn();
    const upsert = jest.fn();
    const { service } = core({
      conversation,
      conversationParticipant: {
        findUnique: jest.fn(() => Promise.resolve(admin)),
        upsert,
      },
      conversationJoinRequest: { updateMany, deleteMany },
    });
    const refresh = jest.spyOn(
      service as unknown as {
        invalidateGroupDetailsVersion: (id: string) => Promise<void>;
      },
      'invalidateGroupDetailsVersion',
    );
    await expect(
      service.declineGroupJoinRequest(CONV, 'admin', 'asker'),
    ).resolves.toEqual({
      success: true,
      changed: true,
      internalId: CONV,
      publicId: 'pub-1',
    });
    // Only a request still waiting moves, and it moves to REJECTED with who
    // answered: a second admin's decline (or an approval) finds nothing.
    expect(updateMany).toHaveBeenCalledWith({
      where: { conversationId: CONV, userId: 'asker', status: 'PENDING' },
      data: {
        status: 'REJECTED',
        decidedAt: expect.any(Date) as unknown,
        decidedById: 'admin',
      },
    });
    expect(deleteMany).not.toHaveBeenCalled();
    // A decline never makes a member.
    expect(upsert).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledWith(CONV);
  });

  it('a request already answered is not an error, and changes nothing', async () => {
    const { service } = core({
      conversation,
      conversationParticipant: {
        findUnique: jest.fn(() => Promise.resolve(admin)),
      },
      conversationJoinRequest: {
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
    });
    await expect(
      service.declineGroupJoinRequest(CONV, 'admin', 'asker'),
    ).resolves.toMatchObject({
      changed: false,
    });
  });

  it('a member who is not an admin cannot decline', async () => {
    const updateMany = jest.fn();
    const { service } = core({
      conversation,
      conversationParticipant: {
        findUnique: jest.fn(() => Promise.resolve(member)),
      },
      conversationJoinRequest: { updateMany },
    });
    await expect(
      service.declineGroupJoinRequest(CONV, 'm', 'asker'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('an admin who has left the group cannot decline', async () => {
    const { service } = core({
      conversation,
      conversationParticipant: {
        findUnique: jest.fn(() =>
          Promise.resolve({ ...admin, leftAt: new Date() }),
        ),
      },
      conversationJoinRequest: { updateMany: jest.fn() },
    });
    await expect(
      service.declineGroupJoinRequest(CONV, 'admin', 'asker'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('requesting to join twice', () => {
  const LINK = { code: 'Abc123Def456' };
  const prismaFor = (prior: unknown) => ({
    conversation: {
      findFirst: jest.fn(() =>
        Promise.resolve({
          id: CONV,
          publicId: 'pub-1',
          name: 'Crew',
          ownerId: 'owner',
          whoCanJoin: 'APPROVAL',
          visibility: 'PUBLIC',
          status: 'ACTIVE',
        }),
      ),
    },
    conversationParticipant: {
      // The asker has no row; the link's creator (the owner) is in the group.
      findUnique: jest.fn(
        (args: { where: { userId_conversationId: { userId: string } } }) =>
          Promise.resolve(
            args.where.userId_conversationId.userId === 'owner'
              ? { leftAt: null }
              : null,
          ),
      ),
    },
    groupInviteLink: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          conversationId: CONV,
          createdById: 'owner',
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
        }),
      ),
    },
    conversationJoinRequest: {
      findUnique: jest.fn(() => Promise.resolve(prior)),
      upsert: jest.fn(() => Promise.resolve({})),
    },
  });

  it('a first request is new; a re-tap on one still pending is not', async () => {
    const first = await core(prismaFor(null)).service.joinGroupByInvite(
      CONV,
      'asker',
      LINK,
    );
    expect(first).toMatchObject({ status: 'PENDING', newRequest: true });
    const prisma = prismaFor({ status: 'PENDING', decidedAt: null });
    const again = await core(prisma).service.joinGroupByInvite(
      CONV,
      'asker',
      LINK,
    );
    expect(again).toMatchObject({ status: 'PENDING', newRequest: false });
    // Nothing is written for a request already waiting.
    expect(prisma.conversationJoinRequest.upsert).not.toHaveBeenCalled();
  });

  it('a new request has no expiry and clears any earlier answer', async () => {
    const prisma = prismaFor({
      status: 'REJECTED',
      decidedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    await core(prisma).service.joinGroupByInvite(CONV, 'asker', LINK);
    expect(prisma.conversationJoinRequest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          status: 'PENDING',
          createdAt: expect.any(Date) as unknown,
          expiresAt: null,
          decidedAt: null,
          decidedById: null,
        },
      }),
    );
  });
});

describe("mute and pin reach the user's other devices", () => {
  it("muting tells only that user's devices, and nothing for a non-participant", async () => {
    const updateMany = jest.fn(() => Promise.resolve({ count: 1 }));
    const { service, emit } = core({ conversationParticipant: { updateMany } });
    await service.muteConversation(CONV, 'me', true);
    expect(emit).toHaveBeenCalledWith(
      'conversation:prefs',
      { conversationId: CONV, internalId: CONV, muted: true },
      ['me'],
    );
    updateMany.mockResolvedValueOnce({ count: 0 });
    emit.mockClear();
    await service.muteConversation(CONV, 'stranger', true);
    expect(emit).not.toHaveBeenCalled();
  });

  it('pinning carries the time it was pinned', async () => {
    const { service, emit } = core({
      conversationParticipant: {
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
    });
    await service.pinConversation(CONV, 'me', true);
    expect(emit).toHaveBeenCalledWith(
      'conversation:prefs',
      expect.objectContaining({
        pinned: true,
        pinnedAt: expect.any(String) as unknown,
      }),
      ['me'],
    );
  });
});

describe("who is sent a group's pending requests", () => {
  const details = (role: string) => {
    const findMany = jest.fn(() =>
      Promise.resolve([
        {
          id: 'r1',
          userId: 'asker',
          createdAt: new Date(),
          expiresAt: null,
          user: {
            id: 'asker',
            username: 'asker',
            displayName: 'Asker',
            avatar: null,
          },
        },
      ]),
    );
    const prisma = {
      conversation: {
        findFirst: jest.fn(() =>
          Promise.resolve({
            id: CONV,
            publicId: 'pub-1',
            name: 'Crew',
            type: 'GROUP',
            ownerId: 'owner',
            status: 'ACTIVE',
            createdAt: new Date(),
            participants: [
              {
                userId: 'me',
                role,
                user: {
                  id: 'me',
                  username: 'me',
                  displayName: 'Me',
                  avatar: null,
                  accountStatus: 'ACTIVE',
                  deletedAt: null,
                },
              },
            ],
          }),
        ),
      },
      conversationJoinRequest: {
        findMany,
        deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
    };
    const service = new GroupChatsService(
      stub<PrismaService>(prisma),
      stub<PresenceService>({}),
      stub<DomainEventService>({ emit: jest.fn(() => Promise.resolve()) }),
      stub<MentionsService>({}),
      stub<BlocksService>({}),
      stub<VerificationAccessService>({}),
      stub<RateLimitService>({}),
    );
    service.resolveConversationId = jest.fn(() => Promise.resolve(CONV));
    return { service, findMany };
  };

  it('an admin gets them', async () => {
    const { service } = details('ADMIN');
    const res = await service.getGroupDetails(CONV, 'me');
    expect(res.pendingRequests).toHaveLength(1);
  });

  it('a member does not, and they are not even read', async () => {
    const { service, findMany } = details('MEMBER');
    const res = await service.getGroupDetails(CONV, 'me');
    expect(res.pendingRequests).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
