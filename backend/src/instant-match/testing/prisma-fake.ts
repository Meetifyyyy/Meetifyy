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
  if (condition instanceof Date) return value?.getTime?.() === condition.getTime();
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
        if (operand !== undefined && (operand as any[]).includes(value)) return false;
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
      default:
        throw new Error(`prisma-fake: unsupported operator "${op}"`);
    }
  }
  return true;
}

function matchesWhere(row: Row, where: Row = {}): boolean {
  for (const [key, condition] of Object.entries(where)) {
    if (condition === undefined) continue;
    if (key === 'OR') {
      if (!(condition as Row[]).some((sub) => matchesWhere(row, sub))) return false;
      continue;
    }
    if (key === 'AND') {
      if (!(condition as Row[]).every((sub) => matchesWhere(row, sub))) return false;
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
  currentYear: number | null;
  interests: string[];
  bio: string | null;
}

export class PrismaFake {
  users = new Map<string, FakeUser>();
  queue: Row[] = [];
  sessions: Row[] = [];
  blocks: Row[] = [];

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
      currentYear: 2,
      interests: [],
      bio: null,
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
    const self = this;
    return {
      async findUnique({ where }: any) {
        return self.queue.find((e) => e.userId === where.userId) ?? null;
      },
      async findMany({ where, include, select }: any) {
        return self.queue
          .filter((e) => matchesWhere(e, where))
          .map((e) => {
            const row: Row = select ? project(e, select) : { ...e };
            if (include?.user) row.user = project(self.users.get(e.userId)!, include.user.select);
            return row;
          });
      },
      async upsert({ where, create, update }: any) {
        const existing = self.queue.find((e) => e.userId === where.userId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: `q${++self.seq}`, ...create };
        self.queue.push(row);
        return row;
      },
      async deleteMany({ where }: any) {
        const before = self.queue.length;
        self.queue = self.queue.filter((e) => !matchesWhere(e, where));
        return { count: before - self.queue.length };
      },
    };
  }

  get matchSession() {
    const self = this;
    return {
      async findUnique({ where, select }: any) {
        const row = self.sessions.find((s) => s.id === where.id);
        return row ? project(row, select) : null;
      },
      async findFirst({ where }: any) {
        const rows = self.sessions.filter((s) => matchesWhere(s, where));
        rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows[0] ? { ...rows[0] } : null;
      },
      async findMany({ where, select }: any) {
        return self.sessions.filter((s) => matchesWhere(s, where)).map((s) => project(s, select));
      },
      async create({ data, select }: any) {
        const row = {
          id: `s${++self.seq}`,
          status: 'PENDING',
          aAccepted: false,
          bAccepted: false,
          conversationId: null,
          createdAt: new Date(),
          ...data,
        };
        self.sessions.push(row);
        return project(row, select);
      },
      async update({ where, data }: any) {
        const row = self.sessions.find((s) => s.id === where.id);
        if (!row) throw new Error('prisma-fake: session not found');
        Object.assign(row, data);
        return { ...row };
      },
      async updateMany({ where, data }: any) {
        const rows = self.sessions.filter((s) => matchesWhere(s, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    };
  }

  conversations: Row[] = [];

  seedConversation(id: string, overrides: Row = {}): Row {
    const row: Row = { id, publicId: `pub-${id}`, expiresAt: null, ...overrides };
    this.conversations.push(row);
    return row;
  }

  get conversation() {
    const self = this;
    return {
      async findFirst({ where, select }: any) {
        const row = self.conversations.find((c) => matchesWhere(c, where));
        return row ? project(row, select) : null;
      },
    };
  }

  get user() {
    const self = this;
    return {
      async findUnique({ where, select }: any) {
        const row = self.users.get(where.id);
        return row ? project(row, select) : null;
      },
    };
  }

  get block() {
    const self = this;
    return {
      async findMany({ where, select }: any) {
        return self.blocks.filter((b) => matchesWhere(b, where)).map((b) => project(b, select));
      },
    };
  }

  async $transaction(fn: (tx: PrismaFake) => Promise<any>) {
    // Snapshot-and-restore gives real rollback semantics, which is what the
    // pair-claim path depends on when it loses a race.
    const queueBefore = this.queue.map((e) => ({ ...e }));
    const sessionsBefore = this.sessions.map((s) => ({ ...s }));
    try {
      this.onTransaction?.();
      return await fn(this);
    } catch (err) {
      this.queue = queueBefore;
      this.sessions = sessionsBefore;
      throw err;
    }
  }
}
