/**
 * A tiny in-memory stand-in for the slice of PrismaClient that
 * InstantMatchService touches.
 *
 * It exists so the matching, acceptance and expiry state machines can be
 * driven through their real branches — including the concurrent ones — without
 * a database. It supports only the filter shapes the service actually uses;
 * anything else throws loudly rather than silently matching everything, so a
 * future query change fails the test instead of quietly weakening it.
 */

import type { MatchQueueEntry, MatchSession } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { BlocksService } from '../../users/blocks.service';
import type { InstantMatchEmitter } from '../instant-match.service';
import { stub } from '../../common/testing/stub';

/** A row of any table; filters and projections work on its plain fields. */
type Row = Record<string, unknown>;

/** The values the fake's range operators compare: numbers, strings, dates. */
type Comparable = number | string | Date;

/** Rows the specs seed directly, with the columns the service reads. */
export type MessageRow = Row & {
  id: string;
  conversationId: string;
  senderId: string;
};
export type ParticipantRow = Row & {
  userId: string;
  conversationId: string;
  unreadCount?: number;
};
export type ConversationRow = Row & {
  id: string;
  publicId: string;
  expiresAt: Date | null;
};
export type BlockRow = {
  blockerId: string;
  blockedId: string;
  createdAt: Date;
};
export type FollowRow = {
  followerId: string;
  followingId: string;
  createdAt: Date;
};
export type CommunityMemberRow = { userId: string; communityId: string };

/** The `where`/`select`/`include` arguments the delegates accept. */
type FindArgs = { where?: Row; select?: Row };

function matchesCondition(value: unknown, condition: unknown): boolean {
  if (condition === null) return value === null;
  if (condition instanceof Date)
    return value instanceof Date && value.getTime() === condition.getTime();
  if (typeof condition !== 'object') return value === condition;

  for (const [op, operand] of Object.entries(condition)) {
    switch (op) {
      case 'not':
        if (matchesCondition(value, operand)) return false;
        break;
      case 'in':
        if (!(operand as unknown[]).includes(value)) return false;
        break;
      case 'notIn':
        if (operand !== undefined && (operand as unknown[]).includes(value))
          return false;
        break;
      case 'gt':
        if (!((value as Comparable) > (operand as Comparable))) return false;
        break;
      case 'gte':
        if (!((value as Comparable) >= (operand as Comparable))) return false;
        break;
      case 'lt':
        if (!((value as Comparable) < (operand as Comparable))) return false;
        break;
      case 'lte':
        if (!((value as Comparable) <= (operand as Comparable))) return false;
        break;
      default:
        throw new Error(`prisma-fake: unsupported operator "${op}"`);
    }
  }
  return true;
}

function matchesWhere(
  row: Row,
  where: Row = {},
  users?: Map<string, FakeUser>,
): boolean {
  for (const [key, condition] of Object.entries(where)) {
    if (condition === undefined) continue;
    if (key === 'OR') {
      if (!(condition as Row[]).some((sub) => matchesWhere(row, sub, users)))
        return false;
      continue;
    }
    if (key === 'AND') {
      if (!(condition as Row[]).every((sub) => matchesWhere(row, sub, users)))
        return false;
      continue;
    }
    if (key === 'user') {
      const u =
        (row.user as Row | undefined) ||
        (typeof row.userId === 'string' && users
          ? users.get(row.userId)
          : null);
      if (!u || !matchesWhere(u, condition as Row, users)) return false;
      continue;
    }
    if (!matchesCondition(row[key], condition)) return false;
  }
  return true;
}

function project(row: Row, select?: Row): Row {
  if (!select) return { ...row };
  const out: Row = {};
  for (const key of Object.keys(select)) if (select[key]) out[key] = row[key];
  return out;
}

export type FakeUser = {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  course: string | null;
  branch: string | null;
  passingYear: number | null;
  interests: string[];
  bio: string | null;
  verificationStatus?: string;
};

export class PrismaFake {
  users = new Map<string, FakeUser>();
  queue: MatchQueueEntry[] = [];
  sessions: MatchSession[] = [];
  blocks: BlockRow[] = [];
  /** The messages and participant rows of a match's conversation. Present so
   *  the teardown a session performs when it ends — the part that makes an
   *  ended chat's transcript unrecoverable — is exercised rather than
   *  swallowed by the service's catch. */
  messages: MessageRow[] = [];
  participants: ParticipantRow[] = [];

  /** Runs at the start of every $transaction, to simulate a competing match
   *  landing first and stealing one of the two queue entries. */
  onTransaction: (() => void) | null = null;

  private seq = 0;

  /**
   * This fake, handed to the service as its PrismaService.
   *
   * The one cast between the two lives here. A structural check is not
   * practical: the delegates implement only the filter shapes the service
   * uses, while Prisma's own signatures are generic over every query shape.
   */
  asService(): PrismaService {
    return this as unknown as PrismaService;
  }

  seedUser(id: string, overrides: Partial<FakeUser> = {}): FakeUser {
    const user: FakeUser = {
      id,
      username: id,
      displayName: id.toUpperCase(),
      avatar: null,
      course: 'B.Tech',
      branch: 'CSE',
      passingYear: 2028,
      interests: [],
      bio: null,
      verificationStatus: 'VERIFIED',
      ...overrides,
    };
    this.users.set(id, user);
    return user;
  }

  seedQueueEntry(
    userId: string,
    overrides: Partial<MatchQueueEntry> = {},
  ): MatchQueueEntry {
    const entry: MatchQueueEntry = {
      id: `q${++this.seq}`,
      userId,
      campus: 'campus-a',
      activity: 'study',
      timePreference: 'now',
      optionalDetail: null,
      area: null,
      latitude: null,
      longitude: null,
      joinedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      ...overrides,
    };
    this.queue = this.queue.filter((e) => e.userId !== userId);
    this.queue.push(entry);
    return entry;
  }

  seedSession(overrides: Partial<MatchSession> = {}): MatchSession {
    const session: MatchSession = {
      id: `s${++this.seq}`,
      userAId: 'a',
      userBId: 'b',
      activity: 'study',
      status: 'PENDING',
      aAccepted: false,
      bAccepted: false,
      conversationId: null,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      // Mirrors the column defaults, so a seeded session behaves like a real
      // row for the chat-lifecycle questions the service asks of it.
      chatStatus: 'ACTIVE',
      chatExpiresAt: null,
      endedById: null,
      endedAt: null,
      declinedById: null,
      matchReason: null,
      snapshotA: null,
      snapshotB: null,
      ...overrides,
    };
    this.sessions.push(session);
    return session;
  }

  addBlock(blockerId: string, blockedId: string) {
    this.blocks.push({ blockerId, blockedId, createdAt: new Date() });
  }

  // ── Delegates ──────────────────────────────────────────────────────────────

  get matchQueueEntry() {
    return {
      findUnique: ({ where }: { where: { userId: string } }) => {
        return Promise.resolve(
          this.queue.find((e) => e.userId === where.userId) ?? null,
        );
      },
      findMany: ({
        where,
        include,
        select,
      }: FindArgs & { include?: { user?: { select?: Row } } }) => {
        return Promise.resolve(
          this.queue
            .filter((e) => matchesWhere(e, where, this.users))
            .map((e) => {
              const row: Row = select ? project(e, select) : { ...e };
              if (include?.user)
                row.user = project(
                  this.users.get(e.userId)!,
                  include.user.select,
                );
              return row;
            }),
        );
      },
      upsert: ({
        where,
        create,
        update,
      }: {
        where: { userId: string };
        create: Omit<MatchQueueEntry, 'id'>;
        update: Partial<MatchQueueEntry>;
      }) => {
        const existing = this.queue.find((e) => e.userId === where.userId);
        if (existing) {
          Object.assign(existing, update);
          return Promise.resolve(existing);
        }
        const row: MatchQueueEntry = { id: `q${++this.seq}`, ...create };
        this.queue.push(row);
        return Promise.resolve(row);
      },
      deleteMany: ({ where }: { where: Row }) => {
        const before = this.queue.length;
        this.queue = this.queue.filter(
          (e) => !matchesWhere(e, where, this.users),
        );
        return Promise.resolve({ count: before - this.queue.length });
      },
    };
  }

  get matchSession() {
    return {
      findUnique: ({
        where,
        select,
      }: {
        where: { id: string };
        select?: Row;
      }) => {
        const row = this.sessions.find((s) => s.id === where.id);
        return Promise.resolve(row ? project(row, select) : null);
      },
      findFirst: ({ where }: { where: Row }) => {
        const rows = this.sessions.filter((s) =>
          matchesWhere(s, where, this.users),
        );
        rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return Promise.resolve(rows[0] ? { ...rows[0] } : null);
      },
      findMany: ({ where, select }: FindArgs) => {
        return Promise.resolve(
          this.sessions
            .filter((s) => matchesWhere(s, where, this.users))
            .map((s) => project(s, select)),
        );
      },
      create: ({
        data,
        select,
      }: {
        data: Pick<
          MatchSession,
          | 'userAId'
          | 'userBId'
          | 'activity'
          | 'expiresAt'
          | 'snapshotA'
          | 'snapshotB'
        >;
        select?: Row;
      }) => {
        const row: MatchSession = {
          id: `s${++this.seq}`,
          status: 'PENDING',
          aAccepted: false,
          bAccepted: false,
          conversationId: null,
          createdAt: new Date(),
          // Chat lifecycle defaults, mirroring the schema's own.
          chatStatus: 'ACTIVE',
          chatExpiresAt: null,
          endedById: null,
          endedAt: null,
          declinedById: null,
          matchReason: null,
          ...data,
        };
        this.sessions.push(row);
        return Promise.resolve(project(row, select));
      },
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<MatchSession>;
      }) => {
        const row = this.sessions.find((s) => s.id === where.id);
        if (!row)
          return Promise.reject(new Error('prisma-fake: session not found'));
        Object.assign(row, data);
        return Promise.resolve({ ...row });
      },
      updateMany: ({ where, data }: { where: Row; data: Row }) => {
        const rows = this.sessions.filter((s) =>
          matchesWhere(s, where, this.users),
        );
        rows.forEach((r) => Object.assign(r, data));
        return Promise.resolve({ count: rows.length });
      },
    };
  }

  /** Follow edges and community memberships: the ranker's social signals.
   *  Both are read once per matching attempt, batched over every candidate. */
  follows: FollowRow[] = [];
  communityMembers: CommunityMemberRow[] = [];

  addFollow(followerId: string, followingId: string) {
    this.follows.push({ followerId, followingId, createdAt: new Date() });
  }

  addCommunityMember(userId: string, communityId: string) {
    this.communityMembers.push({ userId, communityId });
  }

  get follow() {
    return {
      findMany: ({ where, select }: FindArgs) => {
        return Promise.resolve(
          this.follows
            .filter((f) => matchesWhere(f, where))
            .map((f) => project(f, select)),
        );
      },
    };
  }

  get communityMember() {
    return {
      findMany: ({ where, select }: FindArgs) => {
        return Promise.resolve(
          this.communityMembers
            .filter((m) => matchesWhere(m, where))
            .map((m) => project(m, select)),
        );
      },
    };
  }

  conversations: ConversationRow[] = [];

  seedConversation(id: string, overrides: Row = {}): ConversationRow {
    const row: ConversationRow = {
      id,
      publicId: `pub-${id}`,
      expiresAt: null,
      ...overrides,
    };
    this.conversations.push(row);
    return row;
  }

  get conversation() {
    return {
      findFirst: ({ where, select }: FindArgs) => {
        const row = this.conversations.find((c) =>
          matchesWhere(c, where, this.users),
        );
        return Promise.resolve(row ? project(row, select) : null);
      },
      // Ending a chat closes its conversation too, so the fake has to accept
      // the write even though no assertion reads it back.
      updateMany: ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        for (const c of this.conversations) {
          if (matchesWhere(c, where, this.users)) {
            Object.assign(c, data);
            count += 1;
          }
        }
        return Promise.resolve({ count });
      },
    };
  }

  get message() {
    return {
      deleteMany: ({ where }: { where: Row }) => {
        const before = this.messages.length;
        this.messages = this.messages.filter((m) => !matchesWhere(m, where));
        return Promise.resolve({ count: before - this.messages.length });
      },
    };
  }

  get conversationParticipant() {
    return {
      updateMany: ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        for (const row of this.participants) {
          if (!matchesWhere(row, where)) continue;
          Object.assign(row, data);
          count += 1;
        }
        return Promise.resolve({ count });
      },
      findUnique: ({
        where,
        select,
      }: {
        where: {
          userId?: string;
          conversationId?: string;
          userId_conversationId?: { userId: string; conversationId: string };
        };
        select?: Row;
      }) => {
        const key = where.userId_conversationId || where;
        const row = this.participants.find(
          (p) =>
            p.userId === key.userId && p.conversationId === key.conversationId,
        );
        return Promise.resolve(row ? project(row, select) : null);
      },
    };
  }

  get user() {
    return {
      findUnique: ({
        where,
        select,
      }: {
        where: { id: string };
        select?: Row;
      }) => {
        let row = this.users.get(where.id);
        if (!row && where.id) {
          row = this.seedUser(where.id);
        }
        return Promise.resolve(row ? project(row, select) : null);
      },
    };
  }

  get block() {
    return {
      findMany: ({ where, select }: FindArgs) => {
        return Promise.resolve(
          this.blocks
            .filter((b) => matchesWhere(b, where))
            .map((b) => project(b, select)),
        );
      },
    };
  }

  async $transaction<T>(fn: (tx: PrismaFake) => Promise<T>): Promise<T> {
    // Snapshot-and-restore gives real rollback semantics, which is what the
    // pair-claim path depends on when it loses a race.
    const queueBefore = this.queue.map((e) => ({ ...e }));
    const sessionsBefore = this.sessions.map((s) => ({ ...s }));
    const conversationsBefore = this.conversations.map((c) => ({ ...c }));
    const messagesBefore = this.messages.map((m) => ({ ...m }));
    const participantsBefore = this.participants.map((p) => ({ ...p }));
    try {
      this.onTransaction?.();
      return await fn(this);
    } catch (err) {
      this.queue = queueBefore;
      this.sessions = sessionsBefore;
      this.conversations = conversationsBefore;
      this.messages = messagesBefore;
      this.participants = participantsBefore;
      throw err;
    }
  }
}

/**
 * Stands in for BlocksService, reading the fake's seeded block rows so the
 * block-aware matching tests exercise real exclusion behaviour.
 */
export function blocksStubFor(prisma: PrismaFake): BlocksService {
  const excluded = (userId: string): string[] =>
    prisma.blocks
      .filter((b) => b.blockerId === userId || b.blockedId === userId)
      .map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId));

  return stub<BlocksService>({
    getExcludedUserIds: (userId: string) => Promise.resolve(excluded(userId)),
    isBlocked: (a: string, b: string) =>
      Promise.resolve(excluded(a).includes(b)),
    filterBlockedUsers: (userId: string, ids: string[]) => {
      const set = new Set(excluded(userId));
      return Promise.resolve(ids.filter((id) => !set.has(id)));
    },
    injectBlockFilter: <T extends object>(_userId: string, where: T) =>
      Promise.resolve(where),
    invalidateBlockCache: async () => {},
  });
}

/** The realtime emitter, as jest mocks typed by the real interface. */
export function createEmitterMock() {
  type Args<K extends keyof InstantMatchEmitter> = Parameters<
    InstantMatchEmitter[K]
  >;
  return {
    emitMatchFound: jest.fn<void, Args<'emitMatchFound'>>(),
    emitMatchAccepted: jest.fn<void, Args<'emitMatchAccepted'>>(),
    emitMatchDeclined: jest.fn<void, Args<'emitMatchDeclined'>>(),
    emitSearchResumed: jest.fn<void, Args<'emitSearchResumed'>>(),
    emitQueueStats: jest.fn<void, Args<'emitQueueStats'>>(),
    emitInstantMatchChatEnded: jest.fn<
      void,
      Args<'emitInstantMatchChatEnded'>
    >(),
    emitQueueChanged: jest.fn<void, Args<'emitQueueChanged'>>(),
  } satisfies InstantMatchEmitter;
}
