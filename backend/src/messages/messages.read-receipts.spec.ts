import { Test } from '@nestjs/testing';
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

/**
 * Read receipts are a privacy setting: someone who turns them off must not be
 * seen to have read anything. GET /api/messages/:id (MessagesService) returned
 * every participant's lastReadAt and marked messages `read` regardless,
 * because its participant query never selected the setting it then checked —
 * the check read `undefined` and always passed. The DM and group routes
 * (MessagingCoreService) were already correct.
 *
 * The Prisma fake returns `user.settings` ONLY when the query selects it, as
 * the real client does; a fake that always returned it would not catch this.
 */
const CONV = '11111111-1111-4111-8111-111111111111';
const ME = 'alice';
const THEM = 'bob';
const SENT_AT = new Date('2026-09-24T10:00:00Z');
const THEY_READ_AT = new Date('2026-09-24T11:00:00Z');

async function historyWhenTheirReceiptsAre(readReceipts: boolean) {
  const participantRow =
    (userId: string, receipts: boolean, lastReadAt: Date | null) =>
    (args: { select?: { user?: { select?: Record<string, unknown> } } }) => {
      const userSelect = args.select?.user?.select ?? {};
      return {
        userId,
        lastReadAt,
        clearedAt: null,
        leftAt: null,
        user: {
          accountStatus: 'ACTIVE',
          deletedAt: null,
          ...('settings' in userSelect
            ? { settings: { readReceipts: receipts } }
            : {}),
        },
      };
    };

  const prisma = {
    conversation: {
      findUnique: jest.fn().mockResolvedValue({
        id: CONV,
        type: 'DM',
        isInstantMatch: false,
        publicId: 'pub',
      }),
      findFirst: jest.fn().mockResolvedValue({ id: CONV, publicId: 'pub' }),
    },
    conversationParticipant: {
      findFirst: jest.fn().mockResolvedValue({
        userId: ME,
        lastReadAt: null,
        clearedAt: null,
        leftAt: null,
      }),
      findMany: jest.fn(
        (args: { select?: { user?: { select?: Record<string, unknown> } } }) =>
          Promise.resolve([
            participantRow(ME, true, null)(args),
            participantRow(THEM, readReceipts, THEY_READ_AT)(args),
          ]),
      ),
    },
    deletedMessage: { findMany: jest.fn().mockResolvedValue([]) },
    message: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'm1',
          conversationId: CONV,
          senderId: ME,
          type: 'CHAT',
          state: 'SENT',
          createdAt: SENT_AT,
          payload: { text: 'hi' },
          replyTo: null,
          sender: {
            id: ME,
            username: 'alice',
            displayName: 'Alice',
            avatar: null,
            accountStatus: 'ACTIVE',
            deletedAt: null,
          },
        },
      ]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      allowAllRateLimitProvider(),
      verificationAccessMockProvider(),
      studentYearPolicyMockProvider(),
      MessagesService,
      { provide: PrismaService, useValue: prisma },
      { provide: PresenceService, useValue: { getPresence: jest.fn() } },
      { provide: DomainEventService, useValue: { emit: jest.fn() } },
      {
        provide: MentionsService,
        useValue: { sanitize: jest.fn().mockResolvedValue([]) },
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
        },
      },
    ],
  }).compile();

  return moduleRef.get(MessagesService).getConversationHistory(CONV, ME);
}

describe('GET /api/messages/:id — read receipts', () => {
  it("hides the other person's read time and read status when their receipts are off", async () => {
    const history = await historyWhenTheirReceiptsAre(false);

    expect(
      history.participants.find((p) => p.userId === THEM)?.lastReadAt,
    ).toBeNull();
    expect(history.messages[0].status).toBe('sent');
  });

  it('shows them when receipts are on', async () => {
    const history = await historyWhenTheirReceiptsAre(true);

    expect(
      history.participants.find((p) => p.userId === THEM)?.lastReadAt,
    ).toEqual(THEY_READ_AT);
    expect(history.messages[0].status).toBe('read');
  });
});
