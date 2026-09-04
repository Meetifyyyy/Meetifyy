import { Test, TestingModule } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { DomainEventService } from '../events/domain-event.service';
import { MentionsService } from '../mentions/mentions.service';
import { RedisService } from '../redis/redis.service';
import { BlocksService } from '../users/blocks.service';
import { verificationAccessMockProvider } from '../common/verification/testing/verification-access.mock';
import { allowAllRateLimitProvider } from '../common/rate-limit/testing/rate-limit.mock';

/**
 * Deleting a conversation is per-participant, and permanent for the participant
 * who did it.
 *
 * The bug this covers: delete stamped `deletedAt` and nothing else. Reviving the
 * conversation — by messaging the same person again — clears `deletedAt`, and
 * with no `clearedAt` watermark the history query had nothing to filter against,
 * so every message the user had deleted came back.
 */
describe('MessagesService — deleting a conversation', () => {
  let service: MessagesService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      conversation: {
        findFirst: jest.fn(async () => ({
          id: 'conv-internal',
          publicId: 'conv-public',
        })),
        findUnique: jest.fn(async () => ({
          id: 'conv-internal',
          publicId: 'conv-public',
        })),
      },
      conversationParticipant: {
        update: jest.fn(async ({ data }: any) => ({ ...data })),
        updateMany: jest.fn(async () => ({ count: 1 })),
        findUnique: jest.fn(),
        findMany: jest.fn(async () => []),
      },
      message: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(async () => []),
      },
      block: { findFirst: jest.fn() },
      deletedMessage: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (ops: any) =>
        Array.isArray(ops) ? ops : ops(prisma),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        allowAllRateLimitProvider(),
        verificationAccessMockProvider(),
        MessagesService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: PresenceService,
          useValue: {
            setOnline: jest.fn(),
            setOffline: jest.fn(),
            getPresence: jest.fn(),
          },
        },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        {
          provide: MentionsService,
          useValue: {
            sanitize: jest.fn().mockResolvedValue([]),
            persistAndNotify: jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            getClient: jest.fn().mockReturnValue(null),
            getSubClient: jest.fn().mockReturnValue(null),
          },
        },
        {
          provide: BlocksService,
          useValue: {
            getExcludedUserIds: jest.fn().mockResolvedValue([]),
            invalidateBlockCache: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(MessagesService);
  });

  it('watermarks the history at the same instant it hides the conversation', async () => {
    await service.deleteConversationForUser('conv-public', 'user-1');

    const { data } = prisma.conversationParticipant.updateMany.mock.calls[0][0];
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data.clearedAt).toBeInstanceOf(Date);
    // The same instant, so no message can slip between the two.
    expect(data.clearedAt.getTime()).toBe(data.deletedAt.getTime());
  });

  it("touches only the deleting participant's own row", async () => {
    await service.deleteConversationForUser('conv-public', 'user-1');

    const { where } =
      prisma.conversationParticipant.updateMany.mock.calls[0][0];
    expect(where).toEqual({
      userId: 'user-1',
      conversationId: 'conv-internal',
    });
  });

  /**
   * `updateMany` rather than `update` is the whole point: the UI removes the
   * chat optimistically, so a double-tap or an offline retry sends the request
   * twice. With `update` the second one throws P2025 and surfaces as a 500 to a
   * user whose chat is already gone.
   */
  it('is idempotent when the membership row no longer matches', async () => {
    prisma.conversationParticipant.updateMany.mockResolvedValueOnce({
      count: 0,
    });

    await expect(
      service.deleteConversationForUser('conv-public', 'user-1'),
    ).resolves.toEqual(expect.objectContaining({ success: true }));
  });

  it("never deletes the conversation itself or anyone's messages", async () => {
    await service.deleteConversationForUser('conv-public', 'user-1');

    expect(prisma.conversation.findFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.anything() }),
    );
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(prisma.message.deleteMany).toBeUndefined();
  });
});

/**
 * Clear differs from Delete in exactly one respect: the conversation stays in
 * the list. Both move the same per-user watermark, and neither touches a row
 * belonging to the other participant.
 */
describe('MessagingCoreService — per-user conversation actions', () => {
  let service: MessagesService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      conversation: {
        findFirst: jest.fn(async () => ({
          id: 'conv-internal',
          publicId: 'conv-public',
        })),
        findUnique: jest.fn(async () => ({
          id: 'conv-internal',
          publicId: 'conv-public',
        })),
      },
      conversationParticipant: {
        update: jest.fn(),
        updateMany: jest.fn(async () => ({ count: 1 })),
        findUnique: jest.fn(),
        findMany: jest.fn(async () => []),
      },
      message: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(async () => []),
      },
      block: { findFirst: jest.fn() },
      deletedMessage: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (ops: any) =>
        Array.isArray(ops) ? ops : ops(prisma),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        allowAllRateLimitProvider(),
        verificationAccessMockProvider(),
        MessagesService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: PresenceService,
          useValue: {
            setOnline: jest.fn(),
            setOffline: jest.fn(),
            getPresence: jest.fn(),
          },
        },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        {
          provide: MentionsService,
          useValue: {
            sanitize: jest.fn().mockResolvedValue([]),
            persistAndNotify: jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            getClient: jest.fn().mockReturnValue(null),
            getSubClient: jest.fn().mockReturnValue(null),
          },
        },
        {
          provide: BlocksService,
          useValue: {
            getExcludedUserIds: jest.fn().mockResolvedValue([]),
            invalidateBlockCache: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(MessagesService);
  });

  const lastCall = () =>
    prisma.conversationParticipant.updateMany.mock.calls.at(-1)[0];

  it('clears history for one user without hiding the conversation', async () => {
    await service.clearChatForUser('conv-public', 'user-1');

    const { where, data } = lastCall();
    expect(where).toEqual({
      userId: 'user-1',
      conversationId: 'conv-internal',
    });
    expect(data.clearedAt).toBeInstanceOf(Date);
    // Delete's marker, and only Delete's — clearing must leave the row visible.
    expect(data).not.toHaveProperty('deletedAt');
  });

  it('stamps pinnedAt on pin and clears it on unpin', async () => {
    await service.pinConversation('conv-public', 'user-1', true);
    expect(lastCall().data).toEqual({
      isPinned: true,
      pinnedAt: expect.any(Date),
    });

    await service.pinConversation('conv-public', 'user-1', false);
    expect(lastCall().data).toEqual({ isPinned: false, pinnedAt: null });
  });

  it('writes mute state against the (user, conversation) pair only', async () => {
    await service.muteConversation('conv-public', 'user-1', true);

    const { where, data } = lastCall();
    expect(where).toEqual({
      userId: 'user-1',
      conversationId: 'conv-internal',
    });
    expect(data).toEqual({ isMuted: true });
  });

  it("busts the caller's conversation-list cache after every action", async () => {
    const spy = jest
      .spyOn(service, 'invalidateUserConversationsCache')
      .mockResolvedValue(undefined);

    await service.muteConversation('conv-public', 'user-1', true);
    await service.pinConversation('conv-public', 'user-1', true);
    await service.clearChatForUser('conv-public', 'user-1');
    await service.deleteConversationForUser('conv-public', 'user-1');

    // Without this the optimistic UI update is undone the moment anything
    // refetches the list and is served the pre-action cache entry.
    expect(spy).toHaveBeenCalledTimes(4);
    spy.mock.calls.forEach(([ids]) => expect(ids).toEqual(['user-1']));
  });
});
