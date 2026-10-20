import { ForbiddenException } from '@nestjs/common';
import { MessagingCoreService } from './messaging-core.service';
import { stub } from '../../common/testing/stub';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PresenceService } from '../../presence/presence.service';
import type { DomainEventService } from '../../events/domain-event.service';
import type { MentionsService } from '../../mentions/mentions.service';
import type { BlocksService } from '../../users/blocks.service';
import type { VerificationAccessService } from '../../common/verification/verification-access.service';
import type { RateLimitService } from '../../common/rate-limit/rate-limit.service';

/**
 * Who may read, mark read, react to, hide or announce in a conversation.
 *
 * DmService and GroupChatsService inherit these methods from the core service,
 * so a gap here is a gap behind GET /api/dm/:id, GET /api/group-chats/:id and
 * the matching /read, /react and delete routes. Holding a conversation id (or
 * its publicId) must never be enough.
 */
describe('MessagingCoreService — conversation access', () => {
  const ME = 'me-1';
  const STRANGER = 'stranger-1';
  const CONV = 'conv-1';
  const MSG = 'msg-1';

  type Where = {
    userId?: string | { not: string };
    conversationId?: string;
    deletedAt?: null;
    leftAt?: null;
  };
  type Row = { userId: string; leftAt: Date | null; clearedAt: Date | null };

  let service: MessagingCoreService;
  let members: Row[];
  let convType: string;
  let isBlocked: jest.Mock;
  let emit: jest.Mock;
  let prisma: {
    conversation: { findUnique: jest.Mock };
    conversationParticipant: {
      findFirst: jest.Mock<Promise<Row | null>, [{ where: Where }]>;
      findMany: jest.Mock;
      updateMany: jest.Mock;
      upsert: jest.Mock;
    };
    deletedMessage: { findMany: jest.Mock; upsert: jest.Mock };
    message: {
      findUnique: jest.Mock;
      findMany: jest.Mock<
        Promise<unknown[]>,
        [{ where: { createdAt?: { lte?: Date } } }]
      >;
      create: jest.Mock;
    };
    messageReaction: { upsert: jest.Mock };
  };

  beforeEach(() => {
    members = [
      { userId: ME, leftAt: null, clearedAt: null },
      { userId: 'other-1', leftAt: null, clearedAt: null },
    ];
    convType = 'DM';
    isBlocked = jest.fn(() => Promise.resolve(false));
    emit = jest.fn();

    prisma = {
      conversation: {
        findUnique: jest.fn(() =>
          Promise.resolve({ id: CONV, type: convType, isInstantMatch: false }),
        ),
      },
      conversationParticipant: {
        // Honours the userId and the active-row filters, so a fake cannot make
        // a stranger look like a member.
        findFirst: jest.fn(({ where }: { where: Where }) =>
          Promise.resolve(
            members.find(
              (m) =>
                m.userId === where.userId &&
                (where.leftAt === null ? m.leftAt === null : true),
            ) ?? null,
          ),
        ),
        findMany: jest.fn(({ where }: { where: Where }) =>
          Promise.resolve(
            members
              .filter((m) =>
                typeof where.userId === 'object'
                  ? m.userId !== where.userId.not
                  : true,
              )
              .map((m) => ({
                userId: m.userId,
                lastReadAt: null,
                user: { settings: { readReceipts: true } },
              })),
          ),
        ),
        updateMany: jest.fn(({ where }: { where: Where }) =>
          Promise.resolve({
            count: members.some(
              (m) => m.userId === where.userId && m.leftAt === null,
            )
              ? 1
              : 0,
          }),
        ),
        upsert: jest.fn(),
      },
      deletedMessage: {
        findMany: jest.fn(() => Promise.resolve([])),
        upsert: jest.fn(),
      },
      message: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: MSG,
            conversationId: CONV,
            conversation: { type: convType },
          }),
        ),
        findMany: jest.fn((_query: { where: { createdAt?: { lte?: Date } } }) =>
          Promise.resolve([]),
        ),
        create: jest.fn(),
      },
      messageReaction: { upsert: jest.fn() },
    };

    service = new MessagingCoreService(
      stub<PrismaService>(prisma),
      stub<PresenceService>({}),
      stub<DomainEventService>({ emit }),
      stub<MentionsService>({}),
      stub<BlocksService>({ isBlocked }),
      stub<VerificationAccessService>({
        isEnforcementEnabled: () => false,
      }),
      stub<RateLimitService>({}),
    );
    service.resolveConversationId = jest.fn(() => Promise.resolve(CONV));
  });

  describe('getConversationHistory', () => {
    it('refuses a caller who is not a participant', async () => {
      await expect(
        service.getConversationHistory(CONV, STRANGER),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });

    it('refuses an unauthenticated caller', async () => {
      await expect(service.getConversationHistory(CONV)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });

    it('requires the participant row to be one that has not been removed', async () => {
      await service.getConversationHistory(CONV, ME);
      const { where } =
        prisma.conversationParticipant.findFirst.mock.calls[0][0];
      expect(where.deletedAt).toBeNull();
    });

    it('serves a current participant', async () => {
      const page = await service.getConversationHistory(CONV, ME);
      expect(page.messages).toEqual([]);
      expect(prisma.message.findMany).toHaveBeenCalled();
    });

    it('still serves a former member, bounded at the moment they left', async () => {
      const leftAt = new Date('2026-01-01T00:00:00Z');
      members[0] = { userId: ME, leftAt, clearedAt: null };
      await service.getConversationHistory(CONV, ME);
      const { where } = prisma.message.findMany.mock.calls[0][0];
      expect(where.createdAt?.lte).toEqual(leftAt);
    });

    it('does not serve an Instant Match thread through the DM/group path', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: CONV,
        type: 'INSTANT_MATCH',
        isInstantMatch: true,
      });
      const page = await service.getConversationHistory(CONV, ME);
      expect(page.messages).toEqual([]);
      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });
  });

  describe('markAsRead', () => {
    const flush = () => new Promise((r) => setImmediate(r));

    it('never creates a participant row for a non-participant', async () => {
      await service.markAsRead(CONV, STRANGER);
      await flush();
      await flush();
      expect(prisma.conversationParticipant.upsert).not.toHaveBeenCalled();
      expect(prisma.conversationParticipant.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: STRANGER,
            conversationId: CONV,
            deletedAt: null,
            leftAt: null,
          }) as unknown,
        }),
      );
      // The receipt is dropped entirely: nothing is fanned out to members.
      expect(emit).not.toHaveBeenCalled();
    });

    it('acknowledges the same way whether or not the caller is a member', async () => {
      await expect(service.markAsRead(CONV, STRANGER)).resolves.toEqual({
        success: true,
      });
      await expect(service.markAsRead(CONV, ME)).resolves.toEqual({
        success: true,
      });
    });

    it('records the read and notifies the others for a real participant', async () => {
      await service.markAsRead(CONV, ME);
      await flush();
      await flush();
      expect(prisma.conversationParticipant.updateMany).toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith(
        'conversation:seen',
        expect.objectContaining({ readerId: ME }),
        ['other-1'],
      );
    });
  });

  describe('reactToMessage', () => {
    it('refuses a caller outside the message conversation', async () => {
      await expect(service.reactToMessage(MSG, STRANGER, '👍')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.messageReaction.upsert).not.toHaveBeenCalled();
    });

    it('refuses a member who has left', async () => {
      members[0] = { userId: ME, leftAt: new Date(), clearedAt: null };
      await expect(service.reactToMessage(MSG, ME, '👍')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses a reaction in a DM where the pair is blocked', async () => {
      isBlocked.mockResolvedValue(true);
      await expect(service.reactToMessage(MSG, ME, '👍')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.messageReaction.upsert).not.toHaveBeenCalled();
    });

    it('does not apply the DM block rule to a group', async () => {
      convType = 'GROUP';
      isBlocked.mockResolvedValue(true);
      await expect(service.reactToMessage(MSG, ME, '👍')).resolves.toEqual({
        success: true,
      });
    });

    it('records a participant reaction', async () => {
      await expect(service.reactToMessage(MSG, ME, '👍')).resolves.toEqual({
        success: true,
      });
      expect(prisma.messageReaction.upsert).toHaveBeenCalled();
    });
  });

  describe('deleteMessageForMe', () => {
    it('does not reveal the conversation id to a non-participant', async () => {
      await expect(service.deleteMessageForMe(MSG, STRANGER)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.deletedMessage.upsert).not.toHaveBeenCalled();
    });

    it('hides the message for a participant', async () => {
      await expect(service.deleteMessageForMe(MSG, ME)).resolves.toMatchObject({
        success: true,
        conversationId: CONV,
      });
      expect(prisma.deletedMessage.upsert).toHaveBeenCalled();
    });
  });

  describe('createSystemMessage', () => {
    it('refuses an actor who is not in the conversation', async () => {
      await expect(
        service.createSystemMessage(CONV, STRANGER, 'x closed the group'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.message.create).not.toHaveBeenCalled();
    });
  });
});
