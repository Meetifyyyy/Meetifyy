import { Test, TestingModule } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { DomainEventService } from '../events/domain-event.service';
import { MentionsService } from '../mentions/mentions.service';
import { RedisService } from '../redis/redis.service';
import { BlocksService } from '../users/blocks.service';
import { verificationAccessMockProvider } from '../common/verification/testing/verification-access.mock';

/**
 * An Instant Match conversation belongs to one match session, and to nothing
 * else.
 *
 * The bug this covers: creation used to look for an existing INSTANT_MATCH
 * conversation between the same two users inside its 24h window and hand that
 * back. The identity of the chat was therefore the *pair*, not the session —
 * so two people who matched, talked, ended the session and matched again the
 * same day were put straight back into the previous conversation, reading the
 * previous conversation's messages. Everything else in the feature is scoped
 * to a session id; this one lookup was not, and it was enough to undo all of
 * it.
 */
describe('MessagesService — Instant Match conversations', () => {
  let service: MessagesService;
  let prisma: any;
  let created: any[];

  beforeEach(async () => {
    created = [];
    prisma = {
      conversation: {
        // Deliberately answers "yes, one exists between this pair" to every
        // query. If creation ever consults it again, these tests fail.
        findFirst: jest.fn(async () => ({
          id: 'old-internal',
          publicId: 'old-public',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        })),
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `internal-${created.length + 1}`, ...data };
          created.push(row);
          return row;
        }),
      },
      conversationParticipant: {
        findMany: jest.fn(async () => []),
        // The viewer is a participant; the guard, not membership, is what
        // these tests are about.
        findFirst: jest.fn(async () => ({
          userId: 'alice',
          lastReadAt: null,
          clearedAt: null,
          leftAt: null,
        })),
      },
      message: { findMany: jest.fn(async () => []) },
      block: { findFirst: jest.fn() },
      deletedMessage: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (ops: any) =>
        Array.isArray(ops) ? ops : ops(prisma),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        verificationAccessMockProvider(),
        MessagesService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: PresenceService,
          useValue: { setOnline: jest.fn(), setOffline: jest.fn(), getPresence: jest.fn() },
        },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        {
          provide: MentionsService,
          useValue: { sanitize: jest.fn().mockResolvedValue([]), persistAndNotify: jest.fn() },
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

  it('opens a brand-new conversation even when the same pair already has one', async () => {
    const conv = await service.createInstantMatchConversation(
      'alice',
      'bob',
      'study',
    );

    expect(prisma.conversation.create).toHaveBeenCalledTimes(1);
    expect(conv.internalId).not.toBe('old-internal');
    expect(conv.id).not.toBe('old-public');
  });

  it('gives a re-matched pair a second, unrelated conversation', async () => {
    const first = await service.createInstantMatchConversation('alice', 'bob', 'study');
    const second = await service.createInstantMatchConversation('alice', 'bob', 'study');

    // Different rows and different public ids: the second session cannot
    // route to, join, or read the first session's thread.
    expect(second.internalId).not.toBe(first.internalId);
    expect(second.id).not.toBe(first.id);
    expect(prisma.conversation.create).toHaveBeenCalledTimes(2);
  });

  it('creates it empty — no carried-over messages, no seeded preview', async () => {
    await service.createInstantMatchConversation('alice', 'bob', 'study');

    const [{ data }] = prisma.conversation.create.mock.calls[0];
    expect(data.type).toBe('INSTANT_MATCH');
    expect(data.isInstantMatch).toBe(true);
    expect(data.messages).toBeUndefined();
    expect(data.lastMessageText).toBeUndefined();
    expect(data.participants.create).toHaveLength(2);
  });

  /**
   * The other half of "an ended session's messages are gone": the read path.
   *
   * Deleting the rows is the guarantee; this is what makes a client that still
   * holds the id harmless in the window before (or if) the delete has not
   * happened — and what stops a refresh rebuilding an ended chat out of
   * whatever the database still has.
   */
  describe('reading an Instant Match conversation', () => {
    beforeEach(() => {
      prisma.conversation.findUnique = jest.fn(async () => ({
        id: 'conv-internal',
        publicId: 'conv-public',
        type: 'INSTANT_MATCH',
        isInstantMatch: true,
      }));
      prisma.conversation.findFirst = jest.fn(async () => ({
        id: 'conv-internal',
        publicId: 'conv-public',
      }));
    });

    it('returns nothing once the session behind it is no longer live', async () => {
      service.registerInstantMatchGuard({
        assertCanSendInChat: jest.fn(),
        canReadChat: jest.fn(async () => false),
      });

      const res: any = await service.getConversationHistory(
        'conv-public',
        'alice',
      );

      expect(res.messages).toEqual([]);
      expect(res.canSendMessages).toBe(false);
      // An empty page, not an error: a chat legitimately ends under someone
      // who is looking at it, and that must render as "this ended" rather
      // than as a broken screen.
      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });

    it('refuses when no Instant Match guard is registered at all', async () => {
      service.registerInstantMatchGuard(null);

      const res: any = await service.getConversationHistory(
        'conv-public',
        'alice',
      );

      expect(res.messages).toEqual([]);
    });

    it('reads normally while the session is live', async () => {
      service.registerInstantMatchGuard({
        assertCanSendInChat: jest.fn(),
        canReadChat: jest.fn(async () => true),
      });

      await service.getConversationHistory('conv-public', 'alice');

      expect(prisma.message.findMany).toHaveBeenCalled();
    });
  });

  /**
   * The empty-message guard.
   *
   * Its real job is to make a client bug loud. Every field on SendMessageDto
   * is optional, so a body with nothing in it validated cleanly and was
   * stored — and a stored empty message renders as a bubble with a timestamp
   * and no content, on both sides, which reads as a rendering failure rather
   * than as a send that lost its text.
   */
  describe('sending an empty message', () => {
    beforeEach(() => {
      prisma.conversation.findUnique = jest.fn(async () => ({
        id: 'conv-internal',
        publicId: 'conv-public',
        type: 'DM',
        isInstantMatch: false,
        participants: [
          { userId: 'alice', isMuted: false },
          { userId: 'bob', isMuted: false },
        ],
      }));
      prisma.message.create = jest.fn();
    });

    const send = (body: any) =>
      service.sendMessage('alice', 'conv-public', body);

    it('refuses a body with no text, no media and no invite', async () => {
      await expect(send({})).rejects.toThrow(/empty message/i);
      await expect(send({ text: '' })).rejects.toThrow(/empty message/i);
      await expect(send({ text: '   ' })).rejects.toThrow(/empty message/i);
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('lets media and invites through without text', async () => {
      // Both get past the guard; they fail later in the send path for reasons
      // this mock does not model, which is fine — the guard is what is under
      // test, and it is the only thing that rejects with this message.
      await expect(send({ mediaUrl: 'r2://clip.mp4', mediaType: 'video' }))
        .rejects.not.toThrow(/empty message/i);
      await expect(send({ inviteData: { groupName: 'Chess' } }))
        .rejects.not.toThrow(/empty message/i);
    });
  });

  it('refuses a self-match', async () => {
    await expect(
      service.createInstantMatchConversation('alice', 'alice', 'study'),
    ).rejects.toThrow();
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });
});
