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

type Row = Record<string, any>;

function matchesCondition(value: any, condition: any): boolean {
  if (condition === null) return value === null;
  if (condition instanceof Date)
    return value?.getTime?.() === condition.getTime();
  if (typeof condition !== 'object') return value === condition;

  for (const [op, operand] of Object.entries(condition)) {
    switch (op) {
      case 'not':
        if (matchesCondition(value, operand)) return false;
        break;
      case 'in':
        if (!(operand as any[]).includes(value)) return false;
        break;
      case 'notIn':
        if (operand !== undefined && (operand as any[]).includes(value))
          return false;
        break;
      case 'gt':
        if (!(value > (operand as any))) return false;
        break;
      case 'gte':
        if (!(value >= (operand as any))) return false;
        break;
      case 'lt':
        if (!(value < (operand as any))) return false;
        break;
      case 'lte':
        if (!(value <= (operand as any))) return false;
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
        row.user || (row.userId && users ? users.get(row.userId) : null);
      if (!u || !matchesWhere(u, condition as Row, users)) return false;
      continue;
    }
    if (!matchesCondition(row[key], condition)) return false;
  }
  return true;
}

function project<T extends Row>(row: T, select?: Row): Row {
  if (!select) return { ...row };
  const out: Row = {};
  for (const key of Object.keys(select)) if (select[key]) out[key] = row[key];
  return out;
}

export interface FakeUser {
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
}

export class PrismaFake {
  users = new Map<string, FakeUser>();
  queue: Row[] = [];
  sessions: Row[] = [];
  blocks: Row[] = [];
  /** The messages and participant rows of a match's conversation. Present so
   *  the teardown a session performs when it ends — the part that makes an
   *  ended chat's transcript unrecoverable — is exercised rather than
   *  swallowed by the service's catch. */
  messages: Row[] = [];
  participants: Row[] = [];

  /** Runs at the start of every $transaction, to simulate a competing match
   *  landing first and stealing one of the two queue entries. */
  onTransaction: (() => void) | null = null;

  private seq = 0;

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

  seedQueueEntry(userId: string, overrides: Row = {}): Row {
    const entry: Row = {
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

  seedSession(overrides: Row = {}): Row {
    const session: Row = {
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
      findUnique: async ({ where }: any) => {
        return this.queue.find((e) => e.userId === where.userId) ?? null;
      },
      findMany: async ({ where, include, select }: any) => {
        return this.queue
          .filter((e) => matchesWhere(e, where, this.users))
          .map((e) => {
            const row: Row = select ? project(e, select) : { ...e };
            if (include?.user)
              row.user = project(
                this.users.get(e.userId)!,
                include.user.select,
              );
            return row;
          });
      },
      upsert: async ({ where, create, update }: any) => {
        const existing = this.queue.find((e) => e.userId === where.userId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: `q${++this.seq}`, ...create };
        this.queue.push(row);
        return row;
      },
      deleteMany: async ({ where }: any) => {
        const before = this.queue.length;
        this.queue = this.queue.filter(
          (e) => !matchesWhere(e, where, this.users),
        );
        return { count: before - this.queue.length };
      },
    };
  }

  get matchSession() {
    return {
      findUnique: async ({ where, select }: any) => {
        const row = this.sessions.find((s) => s.id === where.id);
        return row ? project(row, select) : null;
      },
      findFirst: async ({ where }: any) => {
        const rows = this.sessions.filter((s) =>
          matchesWhere(s, where, this.users),
        );
        rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows[0] ? { ...rows[0] } : null;
      },
      findMany: async ({ where, select }: any) => {
        return this.sessions
          .filter((s) => matchesWhere(s, where, this.users))
          .map((s) => project(s, select));
      },
      create: async ({ data, select }: any) => {
        const row = {
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
        return project(row, select);
      },
      update: async ({ where, data }: any) => {
        const row = this.sessions.find((s) => s.id === where.id);
        if (!row) throw new Error('prisma-fake: session not found');
        Object.assign(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }: any) => {
        const rows = this.sessions.filter((s) =>
          matchesWhere(s, where, this.users),
        );
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    };
  }

  /** Follow edges and community memberships: the ranker's social signals.
   *  Both are read once per matching attempt, batched over every candidate. */
  follows: Row[] = [];
  communityMembers: Row[] = [];

  addFollow(followerId: string, followingId: string) {
    this.follows.push({ followerId, followingId, createdAt: new Date() });
  }

  addCommunityMember(userId: string, communityId: string) {
    this.communityMembers.push({ userId, communityId });
  }

  get follow() {
    return {
      findMany: async ({ where, select }: any) => {
        return this.follows
          .filter((f) => matchesWhere(f, where))
          .map((f) => project(f, select));
      },
    };
  }

  get communityMember() {
    return {
      findMany: async ({ where, select }: any) => {
        return this.communityMembers
          .filter((m) => matchesWhere(m, where))
          .map((m) => project(m, select));
      },
    };
  }

  conversations: Row[] = [];

  seedConversation(id: string, overrides: Row = {}): Row {
    const row: Row = {
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
      findFirst: async ({ where, select }: any) => {
        const row = this.conversations.find((c) =>
          matchesWhere(c, where, this.users),
        );
        return row ? project(row, select) : null;
      },
      // Ending a chat closes its conversation too, so the fake has to accept
      // the write even though no assertion reads it back.
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const c of this.conversations) {
          if (matchesWhere(c, where, this.users)) {
            Object.assign(c, data);
            count += 1;
          }
        }
        return { count };
      },
    };
  }

  get message() {
    return {
      deleteMany: async ({ where }: any) => {
        const before = this.messages.length;
        this.messages = this.messages.filter((m) => !matchesWhere(m, where));
        return { count: before - this.messages.length };
      },
    };
  }

  get conversationParticipant() {
    return {
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of this.participants) {
          if (!matchesWhere(row, where)) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
      findUnique: async ({ where, select }: any) => {
        const key = where.userId_conversationId || where;
        const row = this.participants.find(
          (p) =>
            p.userId === key.userId && p.conversationId === key.conversationId,
        );
        return row ? project(row, select) : null;
      },
    };
  }

  get user() {
    return {
      findUnique: async ({ where, select }: any) => {
        let row = this.users.get(where.id);
        if (!row && where.id) {
          row = this.seedUser(where.id);
        }
        return row ? project(row, select) : null;
      },
    };
  }

  get block() {
    return {
      findMany: async ({ where, select }: any) => {
        return this.blocks
          .filter((b) => matchesWhere(b, where))
          .map((b) => project(b, select));
      },
    };
  }

  async $transaction(fn: (tx: PrismaFake) => Promise<any>) {
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
