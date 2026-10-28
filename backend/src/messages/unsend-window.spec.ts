import { MessagingCoreService } from './core/messaging-core.service';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { PresenceService } from '../presence/presence.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { MentionsService } from '../mentions/mentions.service';
import type { BlocksService } from '../users/blocks.service';
import type { VerificationAccessService } from '../common/verification/verification-access.service';
import type { RateLimitService } from '../common/rate-limit/rate-limit.service';
import { UNSEND_WINDOW_MS } from './core/unsend-policy';

/**
 * Unsend is the sender's, for 15 minutes from when the server accepted the
 * message, and the server is the only clock.
 *
 * It used to be 10 minutes, checked by a read before an unconditional write,
 * open to anyone who had ever been in the conversation, and applicable to the
 * "X removed Y" system lines an admin had authored. The window is now part of
 * the write (`createdAt >= now - 15 min`), so a request that passes the read
 * and reaches the database a moment too late still changes nothing.
 */
describe('MessagingCoreService — unsend window', () => {
  const ME = 'me-1';
  const CONV = 'conv-1';
  const SENT_AT = new Date('2026-10-27T10:00:00.000Z');

  type Row = {
    id: string;
    conversationId: string;
    senderId: string;
    createdAt: Date;
    state: string;
    type: string;
    payload: Record<string, unknown>;
  };
  type UpdateWhere = {
    id: string;
    senderId: string;
    state: { not: string };
    createdAt: { gte: Date };
  };

  let message: Row;
  let senderLeftAt: Date | null;
  let others: { userId: string; leftAt: Date | null }[];
  let mentionedIds: string[];
  let lastMessageId: string | null;
  let newerMessage: { id: string } | null;
  let mentionRows: { id: string; recipientId: string; metadata: unknown }[];
  let messageUpdateMany: jest.Mock<
    Promise<{ count: number }>,
    [{ where: UpdateWhere }]
  >;
  let conversationUpdateMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
  let notificationUpdate: jest.Mock<
    Promise<unknown>,
    [{ where: { id: string }; data: { metadata: Record<string, unknown> } }]
  >;
  let emit: jest.Mock<Promise<void>, [string, unknown, string[]?]>;
  let service: MessagingCoreService;

  /** What the database would do with the conditional update. */
  const applyConditionalUpdate = ({ where }: { where: UpdateWhere }) => {
    const matches =
      where.id === message.id &&
      where.senderId === message.senderId &&
      message.state !== where.state.not &&
      message.createdAt.getTime() >= where.createdAt.gte.getTime();
    if (matches) message = { ...message, state: 'UNSENT' };
    return Promise.resolve({ count: matches ? 1 : 0 });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    message = {
      id: 'm-1',
      conversationId: CONV,
      senderId: ME,
      createdAt: SENT_AT,
      state: 'NORMAL',
      type: 'CHAT',
      payload: { text: 'secret plans' },
    };
    senderLeftAt = null;
    others = [{ userId: 'them', leftAt: null }];
    mentionedIds = [];
    lastMessageId = 'm-1';
    newerMessage = null;
    mentionRows = [];
    messageUpdateMany = jest.fn(applyConditionalUpdate);
    conversationUpdateMany = jest.fn((_args: unknown) =>
      Promise.resolve({ count: 1 }),
    );
    notificationUpdate = jest.fn((args) =>
      Promise.resolve({ id: args.where.id, metadata: args.data.metadata }),
    );
    emit = jest.fn((_type: string, _data: unknown, _targets?: string[]) =>
      Promise.resolve(),
    );

    const prisma = {
      message: {
        findUnique: jest.fn((args: { select?: { conversation?: unknown } }) =>
          Promise.resolve(
            args.select?.conversation
              ? {
                  ...message,
                  conversation: {
                    id: CONV,
                    publicId: 'pub-1',
                    lastMessageId,
                    lastMessageAt: SENT_AT,
                    lastMessageSenderId: ME,
                    participants: [
                      { userId: ME, leftAt: senderLeftAt },
                      ...others,
                    ],
                  },
                }
              : { state: message.state },
          ),
        ),
        updateMany: messageUpdateMany,
        // "Is anything newer?" for a row with no lastMessageId.
        findFirst: jest.fn(() => Promise.resolve(newerMessage)),
      },
      conversation: { updateMany: conversationUpdateMany },
      mention: {
        findMany: jest.fn(() =>
          Promise.resolve(mentionedIds.map((userId) => ({ userId }))),
        ),
      },
      notification: {
        findMany: jest.fn(() => Promise.resolve(mentionRows)),
        update: notificationUpdate,
      },
    };

    service = new MessagingCoreService(
      stub<PrismaService>(prisma),
      stub<PresenceService>({}),
      stub<DomainEventService>({ emit }),
      stub<MentionsService>({}),
      stub<BlocksService>({}),
      stub<VerificationAccessService>({}),
      stub<RateLimitService>({}),
    );
  });

  afterEach(() => jest.useRealTimers());

  const at = (msAfterSend: number) =>
    jest.setSystemTime(new Date(SENT_AT.getTime() + msAfterSend));

  describe('the boundary', () => {
    it.each([
      ['at the moment it was sent', 0],
      ['just before the window closes', UNSEND_WINDOW_MS - 1],
      ['at exactly 15:00.000', UNSEND_WINDOW_MS],
    ])('allows it %s', async (_label, elapsed) => {
      at(elapsed);
      await expect(service.unsendMessage('m-1', ME)).resolves.toMatchObject({
        success: true,
        changed: true,
      });
      expect(message.state).toBe('UNSENT');
    });

    it('refuses it one millisecond after the window closes, and writes nothing', async () => {
      at(UNSEND_WINDOW_MS + 1);
      await expect(service.unsendMessage('m-1', ME)).rejects.toMatchObject({
        response: { code: 'UNSEND_WINDOW_EXPIRED' },
      });
      expect(messageUpdateMany).not.toHaveBeenCalled();
      expect(message.state).toBe('NORMAL');
    });

    it('refuses it hours later, whatever a client might believe the time is', async () => {
      // The request carries nothing but the message id: no client time exists
      // for the server to be fooled by.
      at(3 * 60 * 60 * 1000);
      await expect(service.unsendMessage('m-1', ME)).rejects.toMatchObject({
        response: { code: 'UNSEND_WINDOW_EXPIRED' },
      });
    });

    it('enforces the window in the write itself, so a request that loses the race to the deadline changes nothing', async () => {
      at(UNSEND_WINDOW_MS);
      // The read happened inside the window; by the time the write runs the
      // database's view has moved on.
      messageUpdateMany.mockImplementationOnce(({ where }) => {
        expect(where.createdAt.gte.getTime()).toBe(
          SENT_AT.getTime() + UNSEND_WINDOW_MS - UNSEND_WINDOW_MS,
        );
        return Promise.resolve({ count: 0 });
      });
      await expect(service.unsendMessage('m-1', ME)).rejects.toMatchObject({
        response: { code: 'UNSEND_WINDOW_EXPIRED' },
      });
      expect(message.state).toBe('NORMAL');
    });
  });

  describe('who may unsend', () => {
    it('only the sender', async () => {
      at(1000);
      await expect(
        service.unsendMessage('m-1', 'someone-else'),
      ).rejects.toThrow('You can only unsend your own messages');
      expect(messageUpdateMany).not.toHaveBeenCalled();
    });

    it('not a sender who has since been removed from the group', async () => {
      at(1000);
      senderLeftAt = new Date(SENT_AT.getTime() + 500);
      await expect(service.unsendMessage('m-1', ME)).rejects.toMatchObject({
        response: { code: 'NOT_A_MEMBER' },
      });
      expect(messageUpdateMany).not.toHaveBeenCalled();
    });

    it('never a system line, even by the admin it names as its author', async () => {
      at(1000);
      message = { ...message, type: 'SYSTEM' };
      await expect(service.unsendMessage('m-1', ME)).rejects.toThrow(
        'This message cannot be unsent',
      );
      expect(messageUpdateMany).not.toHaveBeenCalled();
    });
  });

  describe('repeats are harmless', () => {
    it('a message already unsent succeeds without writing or announcing again', async () => {
      at(1000);
      message = { ...message, state: 'UNSENT' };
      await expect(service.unsendMessage('m-1', ME)).resolves.toMatchObject({
        success: true,
        changed: false,
      });
      expect(messageUpdateMany).not.toHaveBeenCalled();
    });

    it('two requests at once: one changes it, the other reports it already done', async () => {
      at(1000);
      const [a, b] = await Promise.all([
        service.unsendMessage('m-1', ME),
        service.unsendMessage('m-1', ME),
      ]);
      expect([a.changed, b.changed].sort()).toEqual([false, true]);
      expect(message.state).toBe('UNSENT');
    });
  });

  describe('nothing keeps showing the original', () => {
    it('clears the list preview when this was the latest message', async () => {
      at(1000);
      await service.unsendMessage('m-1', ME);
      expect(conversationUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            lastMessageText: 'This message was unsent',
            lastMessageType: 'CHAT',
          },
        }),
      );
    });

    it('also for a row written before every send path recorded lastMessageId', async () => {
      at(1000);
      lastMessageId = null;
      await service.unsendMessage('m-1', ME);
      expect(conversationUpdateMany).toHaveBeenCalledTimes(1);
    });

    it('leaves the preview alone when a newer message is the latest', async () => {
      at(1000);
      lastMessageId = 'm-2';
      newerMessage = { id: 'm-2' };
      await service.unsendMessage('m-1', ME);
      expect(conversationUpdateMany).not.toHaveBeenCalled();
    });

    it('the preview write is conditional on it still being this message', async () => {
      at(1000);
      await service.unsendMessage('m-1', ME);
      expect(conversationUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CONV, lastMessageId: 'm-1' },
        }),
      );
    });

    it('drops the quote from the mention notifications it caused, and tells their recipients', async () => {
      at(1000);
      message = {
        ...message,
        payload: {
          text: '@them secret plans',
          mentions: [{ userId: 'them', username: 'them', start: 0, end: 5 }],
        },
      };
      mentionedIds = ['them'];
      mentionRows = [
        {
          id: 'n-1',
          recipientId: 'them',
          metadata: { contextText: 'secret plans', messageId: 'm-1' },
        },
      ];
      await service.unsendMessage('m-1', ME);
      expect(notificationUpdate).toHaveBeenCalledWith({
        where: { id: 'n-1' },
        data: { metadata: { contextText: '', messageId: 'm-1' } },
      });
      expect(emit).toHaveBeenCalledWith(
        'notification:updated',
        expect.objectContaining({ id: 'n-1' }),
        ['them'],
      );
    });

    it('leaves a notification since reused for a newer mention alone', async () => {
      at(1000);
      message = {
        ...message,
        payload: { text: '@them hi', mentions: [{ userId: 'them' }] },
      };
      mentionedIds = ['them'];
      mentionRows = [
        {
          id: 'n-1',
          recipientId: 'them',
          metadata: { contextText: 'a later one', messageId: 'm-9' },
        },
      ];
      await service.unsendMessage('m-1', ME);
      expect(notificationUpdate).not.toHaveBeenCalled();
    });

    it('does not look for mention notifications when the message mentioned nobody', async () => {
      at(1000);
      await service.unsendMessage('m-1', ME);
      expect(notificationUpdate).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('who is told', () => {
    it('current members, and anyone who left after it was sent, but not someone who left before', async () => {
      at(1000);
      others = [
        { userId: 'still-here', leftAt: null },
        { userId: 'left-after', leftAt: new Date(SENT_AT.getTime() + 500) },
        { userId: 'left-before', leftAt: new Date(SENT_AT.getTime() - 500) },
      ];
      const res = await service.unsendMessage('m-1', ME);
      expect(new Set(res.participantIds)).toEqual(
        new Set([ME, 'still-here', 'left-after']),
      );
    });
  });
});
