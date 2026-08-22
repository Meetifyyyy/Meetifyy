import { Test, TestingModule } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { DomainEventService } from '../events/domain-event.service';
import { MentionsService } from '../mentions/mentions.service';
import { RedisService } from '../redis/redis.service';
import { BlocksService } from '../users/blocks.service';

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
        findFirst: jest.fn(async () => ({ id: 'conv-internal', publicId: 'conv-public' })),
        findUnique: jest.fn(async () => ({ id: 'conv-internal', publicId: 'conv-public' })),
      },
      conversationParticipant: {
        update: jest.fn(async ({ data }: any) => ({ ...data })),
        updateMany: jest.fn(async () => ({ count: 1 })),
        findUnique: jest.fn(),
        findMany: jest.fn(async () => []),
      },
      message: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(async () => []) },
      block: { findFirst: jest.fn() },
      deletedMessage: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (ops: any) => (Array.isArray(ops) ? ops : ops(prisma))),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: PresenceService, useValue: { setOnline: jest.fn(), setOffline: jest.fn(), getPresence: jest.fn() } },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        { provide: MentionsService, useValue: { sanitize: jest.fn().mockResolvedValue([]), persistAndNotify: jest.fn() } },
        { provide: RedisService, useValue: { getClient: jest.fn().mockReturnValue(null), getSubClient: jest.fn().mockReturnValue(null) } },
        { provide: BlocksService, useValue: { getExcludedUserIds: jest.fn().mockResolvedValue([]), invalidateBlockCache: jest.fn() } },
      ],
    }).compile();

    service = module.get(MessagesService);
  });

  it('watermarks the history at the same instant it hides the conversation', async () => {
    await service.deleteConversationForUser('conv-public', 'user-1');

    const { data } = prisma.conversationParticipant.update.mock.calls[0][0];
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data.clearedAt).toBeInstanceOf(Date);
    // The same instant, so no message can slip between the two.
    expect(data.clearedAt.getTime()).toBe(data.deletedAt.getTime());
  });

  it('touches only the deleting participant\'s own row', async () => {
    await service.deleteConversationForUser('conv-public', 'user-1');

    const { where } = prisma.conversationParticipant.update.mock.calls[0][0];
    expect(where).toEqual({ userId_conversationId: { userId: 'user-1', conversationId: 'conv-internal' } });
  });

  it('never deletes the conversation itself or anyone\'s messages', async () => {
    await service.deleteConversationForUser('conv-public', 'user-1');

    expect(prisma.conversation.findFirst).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.anything() }));
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect((prisma.message as any).deleteMany).toBeUndefined();
  });
});
