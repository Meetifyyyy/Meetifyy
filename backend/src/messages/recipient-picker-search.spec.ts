import { Test, TestingModule } from '@nestjs/testing';
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
 * The recipient picker's SEARCH, asserted on the query.
 *
 * Every Share modal used to fetch one page of conversations and filter it in
 * the browser, so a thread past that page could not be found however exactly
 * its name was typed. The fix moves the match into the database, and this
 * suite asserts on the emitted `where` rather than on the returned array —
 * for the same reason the isolation suites do. A service that fetched a page
 * and filtered it in JavaScript would satisfy an assertion on the result and
 * still be wrong.
 */
describe('getUserConversations — picker search', () => {
  let service: MessagesService;
  let prisma: any;

  const buildModule = async (batchYears: Record<string, number | null> = {}) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        allowAllRateLimitProvider(),
        verificationAccessMockProvider(),
        studentYearPolicyMockProvider(batchYears),
        MessagesService,
        {
          provide: PrismaService,
          useValue: {
            conversation: { findFirst: jest.fn(), findUnique: jest.fn() },
            conversationParticipant: {
              findUnique: jest.fn(),
              findMany: jest.fn().mockResolvedValue([]),
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

    service = module.get<MessagesService>(MessagesService);
    prisma = module.get(PrismaService);
  };

  /** The `AND` array the conversation filter is assembled into. */
  const emittedAnd = () => {
    const call = prisma.conversationParticipant.findMany.mock.calls[0][0];
    return call.where.conversation.AND as any[];
  };

  const searchClause = () =>
    emittedAnd().find((clause) =>
      JSON.stringify(clause).includes('contains'),
    );

  beforeEach(async () => {
    await buildModule();
  });

  it('sends no search clause when nothing has been typed', async () => {
    await service.getUserConversations('viewer', 50, 0, true);
    expect(searchClause()).toBeUndefined();
  });

  it('matches a group on its own name', async () => {
    await service.getUserConversations('viewer', 50, 0, true, 'hike');

    expect(searchClause().OR).toContainEqual({
      type: 'GROUP',
      name: { contains: 'hike', mode: 'insensitive' },
    });
  });

  it('matches a DM on the partner display name or username', async () => {
    await service.getUserConversations('viewer', 50, 0, true, 'sarthak');

    const dmArm = searchClause().OR.find((arm: any) => arm.type === 'DM');
    expect(dmArm.participants.some.userId).toEqual({ not: 'viewer' });
    expect(dmArm.participants.some.user.OR).toEqual([
      { displayName: { contains: 'sarthak', mode: 'insensitive' } },
      { username: { contains: 'sarthak', mode: 'insensitive' } },
    ]);
  });

  it('does not offer a group because a hidden member matched', async () => {
    await service.getUserConversations('viewer', 50, 0, true, 'sarthak');

    // The participant arm is scoped to DMs. A group row is rendered under its
    // own name, so matching it on a member the list never shows would look
    // like a result out of nowhere.
    searchClause().OR.forEach((arm: any) => {
      if (arm.participants) expect(arm.type).toBe('DM');
    });
  });

  it('applies the search BEFORE the page limit, not after', async () => {
    await service.getUserConversations('viewer', 50, 0, true, 'hike');

    const call = prisma.conversationParticipant.findMany.mock.calls[0][0];
    // The term reached the database, and the limit is the database's. Filtering
    // after `take` is what returned short pages and hid every thread past the
    // first page from the search box.
    expect(call.take).toBe(50);
    expect(JSON.stringify(call.where)).toContain('hike');
  });

  it('trims the term and treats whitespace as no search', async () => {
    await service.getUserConversations('viewer', 50, 0, true, '   ');
    expect(searchClause()).toBeUndefined();

    prisma.conversationParticipant.findMany.mockClear();
    await service.getUserConversations('viewer', 50, 0, true, '  hike  ');
    expect(JSON.stringify(searchClause())).toContain('"hike"');
  });

  it('keeps isolation and verification alongside the search, never instead', async () => {
    // A first-year viewer searching: the search narrows, it must not replace
    // the filters that decide who is reachable at all. Both live in the same
    // `AND`, so neither can overwrite the other.
    await buildModule({ viewer: 2026 });
    await service.getUserConversations('viewer', 50, 0, true, 'senior');

    const and = emittedAnd();
    const serialised = JSON.stringify(and);

    expect(serialised).toContain('verificationStatus');
    expect(serialised).toContain('batchYear');
    expect(serialised).toContain('senior');

    // Isolation is expressed as `none` over the incompatible set — never
    // `every` over the compatible one, which is not NULL-safe.
    expect(serialised).toContain('"none"');
    expect(serialised).not.toContain('"every"');
  });

  it('still filters a first-year viewer when the search box is empty', async () => {
    await buildModule({ viewer: 2026 });
    await service.getUserConversations('viewer', 50, 0, false);

    expect(JSON.stringify(emittedAnd())).toContain('batchYear');
  });

  it('scopes the cache entry by term, so two searches are two lists', async () => {
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      setex: jest.fn().mockResolvedValue('OK'),
    };
    (service as any).redis = redis;

    await service.getUserConversations('viewer', 50, 0, true, 'anita');
    await service.getUserConversations('viewer', 50, 0, true, 'bharat');

    const [first, second] = redis.get.mock.calls.map((c: any[]) => c[0]);
    expect(first).not.toEqual(second);
    expect(first).toContain('anita');
    expect(second).toContain('bharat');
  });
});
