import { NotFoundException, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import { MessagesService } from './messages.service';
import { DmService } from './dm/dm.service';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { DomainEventService } from '../events/domain-event.service';
import { MentionsService } from '../mentions/mentions.service';
import { RedisService } from '../redis/redis.service';
import { BlocksService } from '../users/blocks.service';
import { verificationAccessMockProvider } from '../common/verification/testing/verification-access.mock';
import { studentYearPolicyMockProvider } from '../common/student-year/testing/student-year-policy.mock';
import { allowAllRateLimitProvider } from '../common/rate-limit/testing/rate-limit.mock';

/**
 * Forwarding copies a message into another conversation, so being allowed to
 * forward a message is being allowed to read it.
 *
 * `forwardMessage` used to look the message up by id and nothing else. Anyone
 * who held a message id could copy a private message - its text or its media -
 * into a conversation of their own. The caller must now be an active member of
 * the SOURCE message's conversation and inside their own read window, and every
 * refusal is the same "not found" so an outsider cannot tell a real id from an
 * invented one.
 *
 * Asserted on both implementations: MessagesService carries its own copy of the
 * method, and the DM and group services inherit the core one.
 */

const ME = 'user-me';
const SOURCE_CONV = 'conv-source';
const TARGET_CONV = 'conv-target';
const T = (iso: string) => new Date(iso);

interface SourceMessage {
  id: string;
  conversationId: string;
  createdAt: Date;
  deletedAt: Date | null;
  state: 'NORMAL' | 'UNSENT' | 'EDITED';
  type: 'CHAT' | 'SYSTEM' | 'MEDIA';
  payload: Prisma.JsonValue;
}
interface ParticipantRow {
  clearedAt: Date | null;
  leftAt: Date | null;
}
type ParticipantQuery = { where: { userId: string; conversationId: string } };

const message = (over: Partial<SourceMessage> = {}): SourceMessage => ({
  id: 'msg-1',
  conversationId: SOURCE_CONV,
  createdAt: T('2026-10-01T10:00:00.000Z'),
  deletedAt: null,
  state: 'NORMAL',
  type: 'MEDIA',
  payload: { text: 'look', mediaUrl: 'chat/a.webp', mediaType: 'image' },
  ...over,
});

const services: [string, Type<MessagesService | DmService>][] = [
  ['MessagesService', MessagesService],
  ['DmService (inherits the core implementation)', DmService],
];

describe.each(services)('forwardMessage access — %s', (_name, ServiceClass) => {
  let service: MessagesService | DmService;
  let sendMessage: jest.SpyInstance;
  let sourceMessage: SourceMessage | null;
  let sourceMember: ParticipantRow | null;
  let deletedForMe: boolean;

  const prisma = {
    conversation: { findUnique: jest.fn(), findFirst: jest.fn() },
    conversationParticipant: { findFirst: jest.fn() },
    message: { findUnique: jest.fn() },
    deletedMessage: { findFirst: jest.fn() },
  };

  beforeEach(async () => {
    sourceMessage = message();
    sourceMember = { clearedAt: null, leftAt: null };
    deletedForMe = false;

    prisma.conversation.findUnique.mockResolvedValue(null);
    prisma.conversation.findFirst.mockResolvedValue(null);
    prisma.message.findUnique.mockImplementation(() =>
      Promise.resolve(sourceMessage),
    );
    prisma.deletedMessage.findFirst.mockImplementation(() =>
      Promise.resolve(deletedForMe ? { id: 'del-1' } : null),
    );
    // The same call serves both checks: membership of the source conversation
    // (what this suite varies) and of the destination (always a member).
    prisma.conversationParticipant.findFirst.mockImplementation(
      ({ where }: ParticipantQuery) =>
        Promise.resolve(
          where.conversationId === SOURCE_CONV
            ? sourceMember
            : { clearedAt: null, leftAt: null },
        ),
    );

    const module = await Test.createTestingModule({
      providers: [
        allowAllRateLimitProvider(),
        verificationAccessMockProvider(),
        studentYearPolicyMockProvider({}),
        ServiceClass,
        { provide: PrismaService, useValue: prisma },
        {
          provide: PresenceService,
          useValue: {
            setOnline: jest.fn(),
            setOffline: jest.fn(),
            getPresence: jest.fn(),
            getPresenceMany: jest.fn().mockResolvedValue(new Map()),
          },
        },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        {
          provide: MentionsService,
          useValue: {
            sanitize: jest.fn().mockResolvedValue([]),
            persistAndNotify: jest.fn().mockResolvedValue(undefined),
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
            getBlockedByUserIds: jest.fn().mockResolvedValue([]),
            invalidateBlockCache: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<MessagesService | DmService>(ServiceClass);
    sendMessage = jest
      .spyOn(service, 'sendMessage')
      .mockImplementation(() => Promise.resolve({ id: 'copy-1' } as never));
  });

  const forward = () => service.forwardMessage('msg-1', [TARGET_CONV], ME);
  const refused = async () => {
    await expect(forward()).rejects.toBeInstanceOf(NotFoundException);
    expect(sendMessage).not.toHaveBeenCalled();
  };

  it('copies the message for an active member of its conversation', async () => {
    const result = await forward();

    expect(result.count).toBe(1);
    expect(sendMessage).toHaveBeenCalledWith(
      ME,
      TARGET_CONV,
      expect.objectContaining({
        text: 'look',
        mediaUrl: 'chat/a.webp',
        isForwarded: true,
        forwardedFromMessageId: 'msg-1',
      }),
    );
  });

  it('checks membership of the SOURCE conversation, not just that the message exists', async () => {
    await forward();
    expect(prisma.conversationParticipant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: ME,
          conversationId: SOURCE_CONV,
          deletedAt: null,
        }) as unknown,
      }),
    );
  });

  it("refuses someone who is not in the message's conversation", async () => {
    sourceMember = null;
    await refused();
  });

  it('refuses a message that does not exist, with the same answer', async () => {
    sourceMessage = null;
    await refused();
  });

  it('refuses a message deleted for everyone or unsent', async () => {
    sourceMessage = message({ deletedAt: T('2026-10-02T00:00:00.000Z') });
    await refused();
    sourceMessage = message({ state: 'UNSENT' });
    await refused();
  });

  it('refuses a system line', async () => {
    sourceMessage = message({ type: 'SYSTEM' });
    await refused();
  });

  it('refuses what the caller deleted for themselves', async () => {
    deletedForMe = true;
    await refused();
  });

  it('refuses what was sent before the caller cleared the chat', async () => {
    sourceMember = { clearedAt: T('2026-10-01T12:00:00.000Z'), leftAt: null };
    await refused();
  });

  it('allows what was sent after the clear', async () => {
    sourceMember = { clearedAt: T('2026-10-01T09:00:00.000Z'), leftAt: null };
    expect((await forward()).count).toBe(1);
  });

  it('refuses what was sent after the caller left the conversation', async () => {
    sourceMember = { clearedAt: null, leftAt: T('2026-10-01T09:00:00.000Z') };
    await refused();
  });

  it('allows what was sent while the caller was still a member', async () => {
    sourceMember = { clearedAt: null, leftAt: T('2026-10-01T11:00:00.000Z') };
    expect((await forward()).count).toBe(1);
  });
});
