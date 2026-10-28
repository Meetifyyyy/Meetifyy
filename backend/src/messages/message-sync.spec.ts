import { Test, TestingModule } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { MessagingCoreService } from './core/messaging-core.service';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { DomainEventService } from '../events/domain-event.service';
import { MentionsService } from '../mentions/mentions.service';
import { RedisService } from '../redis/redis.service';
import { BlocksService } from '../users/blocks.service';
import { verificationAccessMockProvider } from '../common/verification/testing/verification-access.mock';
import { allowAllRateLimitProvider } from '../common/rate-limit/testing/rate-limit.mock';
import { stub } from '../common/testing/stub';
import type { VerificationAccessService } from '../common/verification/verification-access.service';
import type { RateLimitService } from '../common/rate-limit/rate-limit.service';
import { announceUnsent, UnsendOutcome } from './unsend-announce.util';

/**
 * Keeping every device's list and badge in step with the server.
 */
const ME = 'me';
const THEM = 'them';
const CONV = 'conv-1';

describe('the socket send path reaches someone who deleted the chat', () => {
  type UpdateManyArgs = {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  };
  let service: MessagesService;
  let participantWhere: unknown;
  let sanitize: jest.Mock;
  let createdPayload: () => unknown;
  let updateMany: jest.Mock<Promise<{ count: number }>, [UpdateManyArgs]>;
  let emit: jest.Mock<Promise<void>, [string, unknown, string[]?]>;

  beforeEach(async () => {
    updateMany = jest.fn((_args: UpdateManyArgs) =>
      Promise.resolve({ count: 1 }),
    );
    sanitize = jest.fn(() => Promise.resolve([]));
    emit = jest.fn((_type: string, _data: unknown, _targets?: string[]) =>
      Promise.resolve(),
    );
    const create = jest.fn((_args: { data: { payload: unknown } }) =>
      Promise.resolve({
        id: 'm-1',
        conversationId: CONV,
        senderId: ME,
        createdAt: new Date(),
        payload: { text: 'hi' },
        type: 'CHAT',
        state: 'NORMAL',
        sender: { id: ME, username: 'me', displayName: 'Me', avatar: null },
        replyTo: null,
      }),
    );
    createdPayload = () => create.mock.calls[0]?.[0].data.payload;
    const tx = {
      message: {
        create,
      },
      conversation: { update: jest.fn(() => Promise.resolve({})) },
      conversationParticipant: {
        count: jest.fn(() => Promise.resolve(1)),
        updateMany,
      },
    };
    const prisma = {
      conversation: {
        findUnique: jest.fn(
          (args: { select: { participants: { where: unknown } } }) => {
            participantWhere = args.select.participants.where;
            return Promise.resolve({
              id: CONV,
              publicId: 'pub-1',
              name: null,
              type: 'DM',
              isInstantMatch: false,
              participants: [
                {
                  userId: ME,
                  isMuted: false,
                  deletedAt: null,
                  user: { accountStatus: 'ACTIVE', deletedAt: null },
                },
                // THEM deleted (hid) the chat earlier; still in it.
                {
                  userId: THEM,
                  isMuted: false,
                  deletedAt: new Date('2026-10-01T00:00:00Z'),
                  user: { accountStatus: 'ACTIVE', deletedAt: null },
                },
              ],
            });
          },
        ),
      },
      message: { findFirst: jest.fn(() => Promise.resolve(null)) },
      $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        allowAllRateLimitProvider(),
        verificationAccessMockProvider(),
        MessagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: PresenceService, useValue: {} },
        { provide: DomainEventService, useValue: { emit } },
        {
          provide: MentionsService,
          useValue: { sanitize },
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
          useValue: { getExcludedUserIds: jest.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();
    service = module.get(MessagesService);
    service.resolveConversationId = jest.fn(() => Promise.resolve(CONV));
  });

  it('a direct chat carries no mentions: none checked, stored or notified', async () => {
    const res = await service.sendMessage(ME, CONV, {
      text: 'hi @them',
      clientId: 'c-2',
      mentions: [{ userId: THEM, username: 'them', start: 3, end: 8 }],
    });
    expect(res.recipientIds).toEqual([THEM]);
    expect(sanitize).not.toHaveBeenCalled();
    expect(createdPayload()).toMatchObject({ mentions: [] });
  });

  it('does not filter out a participant who deleted the chat', async () => {
    const res = await service.sendMessage(ME, CONV, {
      text: 'hi',
      clientId: 'c-1',
    });
    expect(participantWhere).toEqual({ leftAt: null });
    expect(res.recipientIds).toEqual([THEM]);
  });

  it('counts it as unread for them, and brings the chat back', async () => {
    await service.sendMessage(ME, CONV, { text: 'hi', clientId: 'c-1' });
    const [unread, revive] = updateMany.mock.calls.map((c) => c[0]);
    expect(unread).toEqual({
      where: { conversationId: CONV, userId: { not: ME }, leftAt: null },
      data: { unreadCount: { increment: 1 } },
    });
    expect(revive).toEqual({
      where: { conversationId: CONV, leftAt: null, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
  });

  it("has the members it brought back join the chat's rooms now, not at their next reconnect", async () => {
    await service.sendMessage(ME, CONV, { text: 'hi', clientId: 'c-3' });
    const revived = emit.mock.calls.filter(
      ([type]) => type === 'conversation:revived',
    );
    expect(revived).toEqual([
      [
        'conversation:revived',
        {
          conversationId: 'pub-1',
          publicId: 'pub-1',
          internalId: CONV,
          userIds: [THEM],
        },
        [THEM],
      ],
    ]);
  });
});

describe('reading on one device clears the badge on the others', () => {
  it('tells every device of the reader, whatever their receipt setting, and drops their cached list', async () => {
    const emit = jest.fn(() => Promise.resolve());
    const prisma = {
      conversation: {
        findUnique: jest.fn(() =>
          Promise.resolve({ id: CONV, publicId: 'pub-1' }),
        ),
      },
      conversationParticipant: {
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              userId: ME,
              lastReadAt: new Date(),
              user: { settings: { readReceipts: false } },
            },
          ]),
        ),
      },
    };
    const service = new MessagingCoreService(
      stub<PrismaService>(prisma),
      stub<PresenceService>({}),
      stub<DomainEventService>({ emit }),
      stub<MentionsService>({}),
      stub<BlocksService>({}),
      stub<VerificationAccessService>({}),
      stub<RateLimitService>({}),
    );
    service.resolveConversationId = jest.fn(() => Promise.resolve(CONV));
    const evict = jest.spyOn(service, 'invalidateUserConversationsCache');

    await service['_persistMarkAsRead']('pub-1', ME);

    expect(emit).toHaveBeenCalledWith(
      'conversation:read',
      expect.objectContaining({
        conversationId: 'pub-1',
        internalId: CONV,
        readAt: expect.any(String) as unknown,
      }),
      [ME],
    );
    expect(evict).toHaveBeenCalledWith([ME]);
  });

  it('a non-participant reading changes nothing and tells nobody', async () => {
    const emit = jest.fn(() => Promise.resolve());
    const service = new MessagingCoreService(
      stub<PrismaService>({
        conversation: {
          findUnique: jest.fn(() =>
            Promise.resolve({ id: CONV, publicId: 'pub-1' }),
          ),
        },
        conversationParticipant: {
          updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
        },
      }),
      stub<PresenceService>({}),
      stub<DomainEventService>({ emit }),
      stub<MentionsService>({}),
      stub<BlocksService>({}),
      stub<VerificationAccessService>({}),
      stub<RateLimitService>({}),
    );
    service.resolveConversationId = jest.fn(() => Promise.resolve(CONV));
    await service['_persistMarkAsRead']('pub-1', 'stranger');
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('announceUnsent', () => {
  const outcome = (over: Partial<UnsendOutcome> = {}): UnsendOutcome => ({
    changed: true,
    messageId: 'm-1',
    conversationId: CONV,
    publicId: 'pub-1',
    participantIds: [ME, THEM],
    wasLatest: false,
    createdAt: new Date(Date.UTC(2026, 9, 28, 10, 0)),
    senderId: ME,
    ...over,
  });
  const flush = () => new Promise((r) => setImmediate(r));

  it('updates the message everywhere, with its time, but leaves list previews alone when it was not the latest', async () => {
    const emit = jest.fn(() => Promise.resolve());
    announceUnsent(stub<DomainEventService>({ emit }), outcome());
    await flush();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      'message:updated',
      expect.objectContaining({
        id: 'm-1',
        state: 'UNSENT',
        createdAt: '2026-10-28T10:00:00.000Z',
      }),
      [ME, THEM],
    );
  });

  it('changes the list preview when it was the latest', async () => {
    const emit = jest.fn(() => Promise.resolve());
    announceUnsent(
      stub<DomainEventService>({ emit }),
      outcome({ wasLatest: true }),
    );
    await flush();
    expect(emit).toHaveBeenCalledWith(
      'conversation:updated',
      expect.objectContaining({
        lastMessage: expect.objectContaining({
          id: 'm-1',
          text: 'This message was unsent',
        }) as unknown,
      }),
      [ME, THEM],
    );
  });

  it('announces nothing for a repeat', async () => {
    const emit = jest.fn(() => Promise.resolve());
    announceUnsent(
      stub<DomainEventService>({ emit }),
      outcome({ changed: false }),
    );
    await flush();
    expect(emit).not.toHaveBeenCalled();
  });
});
