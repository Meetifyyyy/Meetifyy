import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import { MessagesService } from './messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { DomainEventService } from '../events/domain-event.service';
import { MentionsService } from '../mentions/mentions.service';
import { RedisService } from '../redis/redis.service';
import { BlocksService } from '../users/blocks.service';
import { verificationAccessMockProvider } from '../common/verification/testing/verification-access.mock';
import { studentYearPolicyMockProvider } from '../common/student-year/testing/student-year-policy.mock';
import { allowAllRateLimitProvider } from '../common/rate-limit/testing/rate-limit.mock';
import {
  MEDIA_PAGE_DEFAULT,
  MEDIA_PAGE_MAX,
  buildMediaCursor,
  clampMediaLimit,
  mediaMessageFilter,
  parseMediaCursor,
  toMediaItem,
  type MediaMessageRow,
} from './conversation-media.util';

const row = (
  id: string,
  payload: Prisma.JsonValue | null,
  createdAt = new Date('2026-10-01T10:00:00.000Z'),
): MediaMessageRow => ({ id, senderId: 'u2', createdAt, payload });

describe('conversation media — pure helpers', () => {
  it('clamps the page size into a safe range', () => {
    expect(clampMediaLimit(undefined)).toBe(MEDIA_PAGE_DEFAULT);
    expect(clampMediaLimit(Number.NaN)).toBe(MEDIA_PAGE_DEFAULT);
    expect(clampMediaLimit(0)).toBe(1);
    expect(clampMediaLimit(-5)).toBe(1);
    expect(clampMediaLimit(7.9)).toBe(7);
    expect(clampMediaLimit(10_000)).toBe(MEDIA_PAGE_MAX);
  });

  it('round-trips a position cursor and treats junk as "from the newest"', () => {
    const at = new Date('2026-10-01T10:00:00.000Z');
    const cursor = buildMediaCursor({ id: 'm1', createdAt: at });
    expect(parseMediaCursor(cursor)).toEqual({
      kind: 'position',
      createdAt: at,
      id: 'm1',
    });
    expect(parseMediaCursor('not-a-date|m1')).toBeNull();
    expect(parseMediaCursor('')).toBeNull();
    expect(parseMediaCursor(undefined)).toBeNull();
    expect(parseMediaCursor('m-bare-id')).toEqual({
      kind: 'message',
      id: 'm-bare-id',
    });
  });

  it('maps an image and a video attachment, keeping the stored value', () => {
    expect(
      toMediaItem(
        row('m1', {
          mediaUrl: '/api/media/chat/a.webp',
          mediaType: 'image',
          thumbnailUrl: '/api/media/chat/a_thumb.webp',
          width: 800,
          height: 600,
        }),
      ),
    ).toEqual({
      messageId: 'm1',
      senderId: 'u2',
      kind: 'image',
      mediaUrl: '/api/media/chat/a.webp',
      thumbnailUrl: '/api/media/chat/a_thumb.webp',
      width: 800,
      height: 600,
      duration: null,
      createdAt: '2026-10-01T10:00:00.000Z',
    });
    expect(
      toMediaItem(
        row('m2', {
          mediaUrl: 'chat/b.mp4',
          mediaType: 'video/mp4',
          duration: 12,
        }),
      ),
    ).toMatchObject({ kind: 'video', duration: 12, thumbnailUrl: null });
  });

  it('infers the kind from the extension for older rows with no mediaType', () => {
    expect(toMediaItem(row('m3', { mediaUrl: 'chat/old.jpg' }))?.kind).toBe(
      'image',
    );
    expect(toMediaItem(row('m4', { mediaUrl: 'chat/old.MOV?x=1' }))?.kind).toBe(
      'video',
    );
  });

  it('rejects voice notes, empty payloads and non-string URLs', () => {
    expect(
      toMediaItem(
        row('v1', { mediaUrl: 'voice/n.webm', mediaType: 'audio/webm' }),
      ),
    ).toBeNull();
    expect(toMediaItem(row('v2', { mediaUrl: 'voice/n.m4a' }))).toBeNull();
    // A voice note stored without a type, as webm: not a video.
    expect(toMediaItem(row('v6', { mediaUrl: 'voice/n.webm' }))).toBeNull();
    expect(toMediaItem(row('v3', null))).toBeNull();
    expect(toMediaItem(row('v4', { mediaUrl: 42 }))).toBeNull();
    expect(toMediaItem(row('v5', { text: 'hi' }))).toBeNull();
  });

  it('selects MEDIA messages only, by type or by extension, in the query', () => {
    const filter = mediaMessageFilter();
    expect(filter.type).toBe('MEDIA');
    const arms = filter.OR as Prisma.MessageWhereInput[];
    const paths = arms.map((arm) => JSON.stringify(arm.payload));
    expect(
      paths.some((p) => p.includes('"mediaType"') && p.includes('image')),
    ).toBe(true);
    expect(
      paths.some((p) => p.includes('"mediaType"') && p.includes('video')),
    ).toBe(true);
    expect(paths.some((p) => p.includes('.mp4'))).toBe(true);
    expect(paths.some((p) => p.includes('audio'))).toBe(false);
  });
});

type MediaQuery = {
  where: {
    conversationId: string;
    deletedAt: null;
    id?: { notIn: string[] };
    createdAt?: { gt?: Date; lte?: Date };
    AND: Prisma.MessageWhereInput[];
  };
  take: number;
};

const makePrisma = () => ({
  conversation: {
    findUnique: jest
      .fn()
      .mockResolvedValue({ type: 'DM', isInstantMatch: false }),
    findFirst: jest.fn(),
  },
  conversationParticipant: {
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn(),
  },
  message: {
    findMany: jest.fn<Promise<MediaMessageRow[]>, [MediaQuery]>(),
    findUnique: jest.fn(),
  },
  deletedMessage: { findMany: jest.fn().mockResolvedValue([]) },
  block: { findFirst: jest.fn() },
  $transaction: jest.fn(),
});

describe('MessagesService.getConversationMedia', () => {
  let service: MessagesService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        allowAllRateLimitProvider(),
        verificationAccessMockProvider(),
        studentYearPolicyMockProvider({}),
        MessagesService,
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
    service = module.get(MessagesService);
    prisma.conversationParticipant.findFirst.mockResolvedValue({
      clearedAt: null,
      leftAt: null,
    });
  });

  const mediaRows = (count: number): MediaMessageRow[] =>
    Array.from({ length: count }, (_, i) =>
      row(
        `m${i}`,
        { mediaUrl: `chat/${i}.webp`, mediaType: 'image' },
        new Date(Date.UTC(2026, 9, 1, 12, 0, 0) - i * 60_000),
      ),
    );

  const lastQuery = (): MediaQuery => {
    const calls = prisma.message.findMany.mock.calls;
    return calls[calls.length - 1][0];
  };

  it('refuses someone who is not an active member', async () => {
    prisma.conversationParticipant.findFirst.mockResolvedValue(null);
    await expect(
      service.getConversationMedia('c1', 'u1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it('asks the database for one extra row and reports the next cursor when more remain', async () => {
    prisma.message.findMany.mockResolvedValue(mediaRows(3));
    const page = await service.getConversationMedia('c1', 'u1', undefined, 2);

    expect(lastQuery().take).toBe(3);
    expect(page.items.map((i) => i.messageId)).toEqual(['m0', 'm1']);
    expect(page.nextCursor).toBe(
      buildMediaCursor({ id: 'm1', createdAt: mediaRows(2)[1].createdAt }),
    );
  });

  it('ends the cursor on the last page', async () => {
    prisma.message.findMany.mockResolvedValue(mediaRows(2));
    const page = await service.getConversationMedia('c1', 'u1', undefined, 5);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('never returns rows before the viewer cleared the chat or after they left', async () => {
    const clearedAt = new Date('2026-09-01T00:00:00.000Z');
    const leftAt = new Date('2026-09-20T00:00:00.000Z');
    prisma.conversationParticipant.findFirst.mockResolvedValue({
      clearedAt,
      leftAt,
    });
    prisma.message.findMany.mockResolvedValue([]);

    await service.getConversationMedia('c1', 'u1');

    expect(lastQuery().where.createdAt).toEqual({ gt: clearedAt, lte: leftAt });
  });

  it('excludes what the viewer deleted for themselves and anything unsent', async () => {
    prisma.deletedMessage.findMany.mockResolvedValue([{ messageId: 'gone' }]);
    prisma.message.findMany.mockResolvedValue([]);

    await service.getConversationMedia('c1', 'u1');

    expect(lastQuery().where.id).toEqual({ notIn: ['gone'] });
    expect(lastQuery().where.deletedAt).toBeNull();
  });

  it('seeks strictly older than the cursor, by position', async () => {
    prisma.message.findMany.mockResolvedValue([]);
    const at = new Date('2026-10-01T10:00:00.000Z');

    await service.getConversationMedia(
      'c1',
      'u1',
      buildMediaCursor({ id: 'm9', createdAt: at }),
    );

    const seek = lastQuery().where.AND[1];
    expect(seek).toEqual({
      OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: 'm9' } }],
    });
    expect(prisma.message.findUnique).not.toHaveBeenCalled();
  });

  it('resolves a bare message-id cursor through the database', async () => {
    const at = new Date('2026-10-01T10:00:00.000Z');
    prisma.message.findUnique.mockResolvedValue({ id: 'm9', createdAt: at });
    prisma.message.findMany.mockResolvedValue([]);

    await service.getConversationMedia('c1', 'u1', 'm9');

    expect(lastQuery().where.AND[1]).toEqual({
      OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: 'm9' } }],
    });
  });

  it('caps the page size', async () => {
    prisma.message.findMany.mockResolvedValue([]);
    await service.getConversationMedia('c1', 'u1', undefined, 5000);
    expect(lastQuery().take).toBe(MEDIA_PAGE_MAX + 1);
  });

  it('answers empty for an instant-match room the guard does not clear', async () => {
    prisma.conversation.findUnique.mockResolvedValue({
      type: 'INSTANT_MATCH',
      isInstantMatch: true,
    });
    const page = await service.getConversationMedia('c1', 'u1');
    expect(page).toEqual({ items: [], nextCursor: null });
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });
});
