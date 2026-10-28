import { Test } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { DomainEventService } from '../events/domain-event.service';
import { MentionsService } from '../mentions/mentions.service';
import { RedisService } from '../redis/redis.service';
import { BlocksService } from '../users/blocks.service';
import { verificationAccessMockProvider } from '../common/verification/testing/verification-access.mock';
import { allowAllRateLimitProvider } from '../common/rate-limit/testing/rate-limit.mock';

/**
 * The message badge counts every unread conversation, not one page of them.
 *
 * The inbox loads the newest 50 rows and the badge was summed from those, so
 * an unread chat further down the list raised nothing. The summary lists every
 * conversation that should raise it, by the list's own rules.
 */
describe('the unread summary behind the message badge', () => {
  type FindManyArgs = { where: Record<string, unknown>; take: number };
  let findMany: jest.Mock<Promise<unknown[]>, [FindManyArgs]>;
  let service: MessagesService;

  beforeEach(async () => {
    findMany = jest.fn((_args: FindManyArgs) =>
      Promise.resolve([
        {
          unreadCount: 3,
          conversation: { id: 'int-1', publicId: 'pub-1', type: 'DM' },
        },
        {
          unreadCount: 12,
          conversation: { id: 'int-2', publicId: null, type: 'GROUP' },
        },
      ]),
    );
    const module = await Test.createTestingModule({
      providers: [
        allowAllRateLimitProvider(),
        verificationAccessMockProvider(),
        MessagesService,
        {
          provide: PrismaService,
          useValue: { conversationParticipant: { findMany } },
        },
        { provide: PresenceService, useValue: {} },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        { provide: MentionsService, useValue: {} },
        {
          provide: RedisService,
          useValue: { getClient: jest.fn().mockReturnValue(null) },
        },
        { provide: BlocksService, useValue: {} },
      ],
    }).compile();
    service = module.get(MessagesService);
  });

  it('counts only what the person can act on: unread, unmuted, not hidden, not left, not Instant Match', async () => {
    await service.getUnreadSummary('me');
    expect(findMany.mock.calls[0][0].where).toEqual({
      userId: 'me',
      deletedAt: null,
      leftAt: null,
      isMuted: false,
      unreadCount: { gt: 0 },
      conversation: { type: { in: ['DM', 'GROUP'] } },
    });
    expect(findMany.mock.calls[0][0].take).toBe(500);
  });

  it('names each conversation as the list does, with its kind and count', async () => {
    await expect(service.getUnreadSummary('me')).resolves.toEqual({
      conversations: [
        { id: 'pub-1', internalId: 'int-1', isGroup: false, unread: 3 },
        { id: 'int-2', internalId: 'int-2', isGroup: true, unread: 12 },
      ],
    });
  });

  it('is routed ahead of the conversation id, which would otherwise take the path', () => {
    const methods = Object.getOwnPropertyNames(MessagesController.prototype);
    expect(methods.indexOf('getUnreadSummary')).toBeGreaterThan(-1);
    expect(methods.indexOf('getUnreadSummary')).toBeLessThan(
      methods.indexOf('getHistory'),
    );
  });
});
