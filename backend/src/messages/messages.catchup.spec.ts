import { Test, TestingModule } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { DomainEventService } from '../events/domain-event.service';
import { MentionsService } from '../mentions/mentions.service';
import { RedisService } from '../redis/redis.service';
import { BlocksService } from '../users/blocks.service';
import { verificationAccessMockProvider } from '../common/verification/testing/verification-access.mock';
import { allowAllRateLimitProvider } from '../common/rate-limit/testing/rate-limit.mock';

/**
 * Reconnect catch-up delivers every missed message, exactly once.
 *
 * It used to return the first 100 messages after `since` with no way to ask
 * for more, and the client then moved its sync point to its own clock — so a
 * long absence silently lost everything past the first 100. It also ignored a
 * chat the user had cleared, and skipped chats they had left during the gap.
 *
 * The Prisma fake evaluates the filters catch-up builds (per-conversation
 * bounds and the (createdAt, id) keyset) over an in-memory table, so these
 * tests exercise the real paging rather than a canned answer.
 */
type DateFilter = { gt?: Date; lte?: Date } | Date;
type Where = {
  conversationId?: string;
  createdAt?: DateFilter;
  id?: { gt: string };
  OR?: Where[];
  AND?: Where[];
};
type Row = {
  id: string;
  conversationId: string;
  senderId: string;
  createdAt: Date;
  payload: { text: string };
  state: 'NORMAL';
  type: 'TEXT';
  replyTo: null;
  sender: {
    id: string;
    username: string;
    displayName: string;
    avatar: null;
    accountStatus: 'ACTIVE';
    deletedAt: null;
  };
};
type Membership = {
  conversationId: string;
  clearedAt: Date | null;
  leftAt: Date | null;
  conversation: { type: string; isInstantMatch: boolean };
};

const at = (s: number) => new Date(Date.UTC(2026, 9, 1, 12, 0, s));

function dateMatches(value: Date, f: DateFilter | undefined): boolean {
  if (!f) return true;
  if (f instanceof Date) return value.getTime() === f.getTime();
  if (f.gt && !(value > f.gt)) return false;
  if (f.lte && !(value <= f.lte)) return false;
  return true;
}

function matches(row: Row, w: Where): boolean {
  if (w.conversationId && row.conversationId !== w.conversationId) return false;
  if (!dateMatches(row.createdAt, w.createdAt)) return false;
  if (w.id && !(row.id > w.id.gt)) return false;
  if (w.OR && !w.OR.some((o) => matches(row, o))) return false;
  if (w.AND && !w.AND.every((a) => matches(row, a))) return false;
  return true;
}

const row = (id: string, conversationId: string, s: number): Row => ({
  id,
  conversationId,
  senderId: 'bob',
  createdAt: at(s),
  payload: { text: id },
  state: 'NORMAL',
  type: 'TEXT',
  replyTo: null,
  sender: {
    id: 'bob',
    username: 'bob',
    displayName: 'Bob',
    avatar: null,
    accountStatus: 'ACTIVE',
    deletedAt: null,
  },
});

describe('MessagesService — reconnect catch-up', () => {
  let service: MessagesService;
  let table: Row[];
  let memberships: Membership[];

  beforeEach(async () => {
    table = [];
    memberships = [
      {
        conversationId: 'c1',
        clearedAt: null,
        leftAt: null,
        conversation: { type: 'DIRECT', isInstantMatch: false },
      },
    ];
    const prisma = {
      conversationParticipant: {
        findMany: jest.fn(() => Promise.resolve(memberships)),
      },
      message: {
        findMany: jest.fn(({ where, take }: { where: Where; take: number }) =>
          Promise.resolve(
            table
              .filter((r) => matches(r, where))
              .sort(
                (a, b) =>
                  a.createdAt.getTime() - b.createdAt.getTime() ||
                  (a.id < b.id ? -1 : 1),
              )
              .slice(0, take),
          ),
        ),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        allowAllRateLimitProvider(),
        verificationAccessMockProvider(),
        MessagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: PresenceService, useValue: { getPresence: jest.fn() } },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        { provide: MentionsService, useValue: { sanitize: jest.fn() } },
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
  });

  /** Pages until the server says there is no more, as the client does. */
  async function drain(since: Date) {
    const ids: string[] = [];
    let after: string | undefined;
    for (let i = 0; i < 50; i += 1) {
      const page = await service.getCatchupMessages(
        'alice',
        since.toISOString(),
        after,
      );
      ids.push(...page.messages.map((m) => m.id));
      if (!page.hasMore) return ids;
      after = page.cursor ?? undefined;
    }
    throw new Error('did not finish paging');
  }

  it('delivers far more than one page, each message once, in order', async () => {
    const total = MessagesService.CATCHUP_PAGE_SIZE * 2 + 37;
    for (let i = 0; i < total; i += 1) {
      // Several messages share each second, so the id tiebreak is exercised.
      table.push(
        row(`m${String(i).padStart(4, '0')}`, 'c1', 60 + Math.floor(i / 7)),
      );
    }
    const ids = await drain(at(30));
    expect(ids).toHaveLength(total);
    expect(new Set(ids).size).toBe(total);
    expect(ids).toEqual(table.map((r) => r.id));
  });

  it('re-reads a short window before `since`, for messages committed late', async () => {
    // Stamped 5s before the last sync but committed after it.
    table.push(row('late', 'c1', 25), row('new', 'c1', 40));
    expect(await drain(at(30))).toEqual(['late', 'new']);
  });

  it('reports the server clock as the next sync point', async () => {
    const before = Date.now();
    const page = await service.getCatchupMessages('alice', at(0).toISOString());
    expect(new Date(page.syncedAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(page.hasMore).toBe(false);
    expect(page.cursor).toBeNull();
  });

  it('keeps a chat the user cleared cleared', async () => {
    memberships[0].clearedAt = at(50);
    table.push(row('before-clear', 'c1', 45), row('after-clear', 'c1', 55));
    expect(await drain(at(30))).toEqual(['after-clear']);
  });

  it('delivers what was said before the user left a chat during the gap', async () => {
    memberships.push({
      conversationId: 'c2',
      clearedAt: null,
      leftAt: at(50),
      conversation: { type: 'GROUP', isInstantMatch: false },
    });
    table.push(row('while-member', 'c2', 45), row('after-leaving', 'c2', 55));
    expect(await drain(at(30))).toEqual(['while-member']);
  });

  it('returns nothing from an instant-match chat its session no longer allows', async () => {
    memberships[0].conversation = {
      type: 'INSTANT_MATCH',
      isInstantMatch: true,
    };
    service.registerInstantMatchGuard({
      canReadChat: jest.fn(() => Promise.resolve(false)),
    } as unknown as Parameters<
      MessagesService['registerInstantMatchGuard']
    >[0]);
    table.push(row('m1', 'c1', 40));
    expect(await drain(at(30))).toEqual([]);
  });

  it('answers malformed input with an empty final page, as before', async () => {
    const bad = await service.getCatchupMessages('alice', 'not-a-date');
    expect(bad.messages).toEqual([]);
    expect(bad.hasMore).toBe(false);
    const badCursor = await service.getCatchupMessages(
      'alice',
      at(0).toISOString(),
      'garbage',
    );
    expect(badCursor.messages).toEqual([]);
  });
});
