import { Test, TestingModule } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { DomainEventService } from '../events/domain-event.service';
import { MentionsService } from '../mentions/mentions.service';
import { RedisService } from '../redis/redis.service';
import { BlocksService } from '../users/blocks.service';
import { verificationAccessMockProvider } from '../common/verification/testing/verification-access.mock';

describe('MessagesService', () => {
  let service: MessagesService;
  let prisma: any;
  let module_blocks: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        verificationAccessMockProvider(),
        MessagesService,
        {
          provide: PrismaService,
          useValue: {
            conversation: { findFirst: jest.fn(), findUnique: jest.fn() },
            conversationParticipant: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
              findFirst: jest.fn(),
            },
            message: {
              create: jest.fn(),
              findFirst: jest.fn(),
              findMany: jest.fn(),
            },
            deletedMessage: { findMany: jest.fn() },
            block: { findFirst: jest.fn() },
            $transaction: jest.fn(),
          },
        },
        {
          provide: PresenceService,
          useValue: {
            setOnline: jest.fn(),
            setOffline: jest.fn(),
            getPresence: jest.fn(),
          },
        },
        {
          provide: DomainEventService,
          useValue: { emit: jest.fn() },
        },
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
          useValue: (module_blocks = {
            getExcludedUserIds: jest.fn().mockResolvedValue([]),
            getBlockedByUserIds: jest.fn().mockResolvedValue([]),
            invalidateBlockCache: jest.fn(),
          }),
        },
      ],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getConversationHistory — block must not hide history', () => {
    beforeEach(() => {
      jest
        .spyOn(service as any, 'resolveConversationId')
        .mockResolvedValue('conv-1');
      prisma.deletedMessage.findMany.mockResolvedValue([]);
      prisma.conversationParticipant.findFirst.mockResolvedValue({
        userId: 'alice',
        lastReadAt: null,
        clearedAt: null,
        leftAt: null,
      });
      prisma.conversationParticipant.findMany.mockResolvedValue([
        { userId: 'alice', lastReadAt: null, clearedAt: null, leftAt: null },
        { userId: 'bob', lastReadAt: null, clearedAt: null, leftAt: null },
      ]);
      prisma.message.findMany.mockResolvedValue([]);
    });

    it('does not exclude any sender from the transcript', async () => {
      // alice has blocked bob.
      const blocks = module_blocks;
      blocks.getBlockedByUserIds = jest.fn().mockResolvedValue(['bob']);
      blocks.getExcludedUserIds = jest.fn().mockResolvedValue(['bob']);

      await service.getConversationHistory('conv-1', 'alice');

      const where = prisma.message.findMany.mock.calls[0][0].where;

      // A block closes the thread for writes; it does not redact what was
      // already said. Filtering here left the blocker reading a one-sided
      // transcript of their own replies.
      expect(where.NOT).toBeUndefined();
      expect(JSON.stringify(where)).not.toContain('bob');
    });

    it('still scopes the transcript to the conversation and excludes deleted rows', async () => {
      await service.getConversationHistory('conv-1', 'alice');

      const where = prisma.message.findMany.mock.calls[0][0].where;
      expect(where.conversationId).toBe('conv-1');
      expect(where.deletedAt).toBeNull();
    });
  });
});
