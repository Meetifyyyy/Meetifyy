import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ConfessionReactionType,
  ConfessionStatus,
  Prisma,
  ReportTargetType,
} from '@prisma/client';
import { stub } from '../common/testing/stub';
import type { DomainEventService } from '../events/domain-event.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  ConfessionsService,
  syncConfessionReports,
} from './confessions.service';
import {
  checkHandle,
  confessionHash,
  normaliseConfession,
} from './confession-rules';
import { ReportTargetResolver } from '../moderation/report-target.resolver';
import type { ActivityAuthorizationService } from '../activities/activity-authorization.service';
import { affiliatedWith } from '../common/campus/testing/affiliation.fixture';

const NOW = new Date('2026-10-01T12:00:00.000Z');

function row(id: string, profileId: string, createdAt = NOW) {
  return {
    id,
    content: 'something I never told anyone',
    createdAt,
    profileId,
    profile: { handle: 'NightOwl' },
  };
}

function p2002(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err: unknown) {
    if (
      err instanceof BadRequestException ||
      err instanceof ConflictException ||
      err instanceof ForbiddenException ||
      err instanceof NotFoundException
    ) {
      return err.getResponse();
    }
    throw err;
  }
  throw new Error('expected a rejection');
}

/** What the reaction statement answers: the state before its write. */
function reactionRow(
  over: Partial<{
    hasProfile: boolean;
    visible: boolean;
    previous: string | null;
    love: number;
    funny: number;
    sad: number;
    surprised: number;
    relatable: number;
  }> = {},
) {
  return {
    hasProfile: true,
    visible: true,
    previous: null,
    love: 0,
    funny: 0,
    sad: 0,
    surprised: 0,
    relatable: 0,
    ...over,
  };
}

function build(opts: { events?: DomainEventService } = {}) {
  const profileFindUnique = jest.fn();
  const profileCreate = jest.fn();
  const userFindUnique = jest.fn(() =>
    Promise.resolve({ username: 'real.name' }),
  );
  const confessionFindMany = jest.fn(() =>
    Promise.resolve([] as ReturnType<typeof row>[]),
  );
  const confessionFindFirst = jest.fn();
  const confessionCreate = jest.fn();
  const confessionUpdate = jest.fn();
  const confessionUpdateMany = jest.fn(() => Promise.resolve({ count: 1 }));
  const confessionFindUniqueOrThrow = jest.fn(() =>
    Promise.resolve({ relateCount: 1 }),
  );
  const relateFindMany = jest.fn(() =>
    Promise.resolve(
      [] as { confessionId: string; reaction: ConfessionReactionType }[],
    ),
  );
  const relateGroupBy = jest.fn(() =>
    Promise.resolve(
      [] as {
        confessionId: string;
        reaction: ConfessionReactionType;
        _count: { _all: number };
      }[],
    ),
  );
  /** The single reaction statement: its SQL text and the row it answers. */
  const queryRaw = jest.fn(
    (_strings: TemplateStringsArray, ..._values: unknown[]) =>
      Promise.resolve([reactionRow()]),
  );
  const calls: string[] = [];
  const executeRaw = jest.fn((sql: TemplateStringsArray) => {
    calls.push(sql.join('?'));
    return Promise.resolve(1);
  });
  confessionFindFirst.mockImplementation(() => {
    calls.push('findFirst');
    return Promise.resolve(null);
  });

  const tx = {
    $executeRaw: executeRaw,
    confession: {
      findFirst: confessionFindFirst,
      create: confessionCreate,
      update: confessionUpdate,
      findUniqueOrThrow: confessionFindUniqueOrThrow,
    },
  };
  const prisma = stub<PrismaService>({
    user: { findUnique: userFindUnique },
    confessionProfile: {
      findUnique: profileFindUnique,
      create: profileCreate,
    },
    confession: {
      findMany: confessionFindMany,
      findFirst: confessionFindFirst,
      create: confessionCreate,
      updateMany: confessionUpdateMany,
    },
    confessionReaction: { findMany: relateFindMany, groupBy: relateGroupBy },
    $queryRaw: queryRaw,
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  });
  return {
    service: new ConfessionsService(prisma, opts.events),
    profileFindUnique,
    profileCreate,
    userFindUnique,
    confessionFindMany,
    confessionFindFirst,
    confessionCreate,
    confessionUpdate,
    confessionUpdateMany,
    confessionFindUniqueOrThrow,
    relateFindMany,
    relateGroupBy,
    queryRaw,
    executeRaw,
    calls,
  };
}

describe('confession rules', () => {
  it.each([
    ['ab', 'invalid'],
    ['a'.repeat(21), 'invalid'],
    ['1abc', 'invalid'],
    ['_abc', 'invalid'],
    ['ab-cd', 'invalid'],
    ['ab cd', 'invalid'],
    ['ab..cd', 'invalid'],
    ['ab._cd', 'invalid'],
    ['abcd.', 'invalid'],
    ['abcd_', 'invalid'],
    ['Admin', 'reserved'],
    ['MODERATOR', 'reserved'],
    ['meetifyy', 'reserved'],
    ['Real.Name', 'reserved'],
    ['Night.Owl_7', null],
    ['abc', null],
  ])('checkHandle(%p) → %p', (handle, expected) => {
    expect(checkHandle(handle, 'real.name')).toBe(expected);
  });

  it('normalises controls, CRLF and blank-line runs', () => {
    expect(normaliseConfession('  hi\u0000 there\r\n\r\n\r\n\r\nend‮  ')).toBe(
      'hi there\n\nend',
    );
  });

  it('keeps angle brackets as text instead of eating the rest of the line', () => {
    expect(normaliseConfession('I <3 this place, and 2 < 3')).toBe(
      'I <3 this place, and 2 < 3',
    );
    expect(normaliseConfession('<b>bold</b>')).toBe('<b>bold</b>');
  });

  it('keeps emoji ZWJ sequences intact', () => {
    const family = 'family \u{1F468}‍\u{1F469}‍\u{1F467} here';
    expect(normaliseConfession(family)).toBe(family);
  });

  it('hashes case- and whitespace-insensitively', () => {
    expect(confessionHash('Hello   World')).toBe(confessionHash('hello world'));
    expect(confessionHash('a')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('ConfessionsService — profile', () => {
  it('reports availability reasons', async () => {
    const t = build();
    t.profileFindUnique.mockResolvedValue(null);
    await expect(t.service.checkAvailability('u1', 'x!')).resolves.toEqual({
      handle: 'x!',
      available: false,
      reason: 'invalid',
    });
    await expect(
      t.service.checkAvailability('u1', 'REAL.name'),
    ).resolves.toMatchObject({ available: false, reason: 'reserved' });
    await expect(
      t.service.checkAvailability('u1', 'NightOwl'),
    ).resolves.toEqual({ handle: 'NightOwl', available: true, reason: null });
    expect(t.profileFindUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { handleKey: 'nightowl' } }),
    );
    t.profileFindUnique.mockResolvedValue({ id: 'p' });
    await expect(
      t.service.checkAvailability('u1', 'NightOwl'),
    ).resolves.toMatchObject({ available: false, reason: 'taken' });
  });

  it('rejects an invalid or reserved handle with handle_invalid', async () => {
    const t = build();
    await expect(
      codeOf(t.service.createProfile('u1', 'a')),
    ).resolves.toMatchObject({ code: 'handle_invalid', reason: 'invalid' });
    await expect(
      codeOf(t.service.createProfile('u1', 'Staff')),
    ).resolves.toMatchObject({ code: 'handle_invalid', reason: 'reserved' });
    expect(t.profileCreate).not.toHaveBeenCalled();
  });

  it('refuses a second profile', async () => {
    const t = build();
    t.profileFindUnique.mockResolvedValue({ id: 'p1' });
    await expect(
      codeOf(t.service.createProfile('u1', 'NightOwl')),
    ).resolves.toMatchObject({ code: 'profile_exists' });
  });

  it('maps a P2002 race on handleKey to handle_taken', async () => {
    const t = build();
    t.profileFindUnique.mockResolvedValue(null);
    t.profileCreate.mockRejectedValue(p2002(['handleKey']));
    await expect(
      codeOf(t.service.createProfile('u1', 'NightOwl')),
    ).resolves.toMatchObject({ code: 'handle_taken' });
  });

  it('maps a P2002 race on userId to profile_exists', async () => {
    const t = build();
    t.profileFindUnique.mockResolvedValue(null);
    t.profileCreate.mockRejectedValue(p2002(['userId']));
    await expect(
      codeOf(t.service.createProfile('u1', 'NightOwl')),
    ).resolves.toMatchObject({ code: 'profile_exists' });
  });

  it('stores the handle as typed and its lower-cased key', async () => {
    const t = build();
    t.profileFindUnique.mockResolvedValue(null);
    t.profileCreate.mockResolvedValue({ handle: 'NightOwl', createdAt: NOW });
    await expect(t.service.createProfile('u1', 'NightOwl')).resolves.toEqual({
      profile: { handle: 'NightOwl', createdAt: NOW.toISOString() },
    });
    expect(t.profileCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { userId: 'u1', handle: 'NightOwl', handleKey: 'nightowl' },
      }),
    );
  });
});

describe('ConfessionsService — create', () => {
  it('requires a profile', async () => {
    const t = build();
    t.profileFindUnique.mockResolvedValue(null);
    await expect(
      codeOf(t.service.create('u1', 'c1', 'a perfectly long confession')),
    ).resolves.toMatchObject({ code: 'confession_profile_required' });
  });

  it('measures length after normalising', async () => {
    const t = build();
    t.profileFindUnique.mockResolvedValue({ id: 'p1' });
    await expect(
      codeOf(
        t.service.create('u1', 'c1', '  short\u0000\u0000\u200b\u200b\u200b  '),
      ),
    ).resolves.toMatchObject({ code: 'content_invalid' });
    await expect(
      codeOf(t.service.create('u1', 'c1', 'x'.repeat(1001))),
    ).resolves.toMatchObject({ code: 'content_invalid' });
  });

  it('needs at least 15 characters', async () => {
    const t = build();
    t.profileFindUnique.mockResolvedValue({ id: 'p1' });
    t.confessionCreate.mockResolvedValue(row('n1', 'p1'));
    await expect(
      codeOf(t.service.create('u1', 'c1', 'fourteen chars')),
    ).resolves.toMatchObject({ code: 'content_invalid' });
    await expect(
      t.service.create('u1', 'c1', 'fifteen chars!!'),
    ).resolves.toHaveProperty('confession');
  });

  it('rejects the same content from the same profile within 24h', async () => {
    const t = build();
    t.profileFindUnique.mockResolvedValue({ id: 'p1' });
    t.confessionFindFirst.mockResolvedValue({ id: 'old' });
    await expect(
      codeOf(t.service.create('u1', 'c1', 'I am the same confession')),
    ).resolves.toMatchObject({ code: 'duplicate_confession' });
    expect(t.confessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          profileId: 'p1',
          contentHash: confessionHash('I am the same confession'),
        }) as unknown,
      }),
    );
  });

  it('stores normalised content on the affiliation campus', async () => {
    const t = build();
    t.profileFindUnique.mockResolvedValue({ id: 'p1' });
    t.confessionFindFirst.mockResolvedValue(null);
    t.confessionCreate.mockResolvedValue(row('n1', 'p1'));
    const { confession } = await t.service.create(
      'u1',
      'c1',
      '  my secret is out\n\n\n\nnow ',
    );
    expect(t.confessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          collegeId: 'c1',
          profileId: 'p1',
          content: 'my secret is out\n\nnow',
        }) as unknown,
      }),
    );
    expect(confession.isMine).toBe(true);
  });

  it('takes the per-profile lock before checking for a duplicate', async () => {
    const t = build();
    t.profileFindUnique.mockResolvedValue({ id: 'p1' });
    t.confessionCreate.mockResolvedValue(row('n1', 'p1'));
    await t.service.create('u1', 'c1', 'a confession posted twice at once');
    // Check-then-insert outside a lock let a double tap post twice.
    expect(t.calls[0]).toContain('pg_advisory_xact_lock');
    expect(t.calls[1]).toBe('findFirst');
    expect(t.executeRaw.mock.calls[0]).toContain('p1');
  });
});

describe('ConfessionsService — feed', () => {
  it('scopes to the given college and VISIBLE, and exposes only the DTO keys', async () => {
    const t = build();
    t.profileFindUnique.mockResolvedValue({ id: 'me' });
    t.confessionFindMany.mockResolvedValue([
      row('b', 'me'),
      row('a', 'other'),
      row('z', 'other', new Date('2026-09-30T00:00:00.000Z')),
    ]);
    t.relateFindMany.mockResolvedValue([
      { confessionId: 'a', reaction: ConfessionReactionType.SAD },
    ]);
    t.relateGroupBy.mockResolvedValue([
      {
        confessionId: 'a',
        reaction: ConfessionReactionType.SAD,
        _count: { _all: 2 },
      },
      {
        confessionId: 'a',
        reaction: ConfessionReactionType.LOVE,
        _count: { _all: 1 },
      },
    ]);

    const page = await t.service.list('u1', 'college-1', { limit: 2 });

    expect(t.confessionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { collegeId: 'college-1', status: ConfessionStatus.VISIBLE },
        take: 3,
      }),
    );
    expect(page.confessions).toHaveLength(2);
    for (const c of page.confessions) {
      expect(Object.keys(c).sort()).toEqual(
        [
          'content',
          'createdAt',
          'handle',
          'id',
          'isMine',
          'myReaction',
          'reactionCount',
          'reactions',
          'relateCount',
          'relatedByMe',
        ].sort(),
      );
    }
    expect(JSON.stringify(page)).not.toMatch(/profileId|userId|"me"|other/);
    expect(page.confessions[0]).toMatchObject({
      isMine: true,
      myReaction: null,
      reactionCount: 0,
      relatedByMe: false,
      relateCount: 0,
    });
    expect(page.confessions[1]).toMatchObject({
      isMine: false,
      myReaction: 'sad',
      reactions: { love: 1, funny: 0, sad: 2, surprised: 0, relatable: 0 },
      reactionCount: 3,
      relatedByMe: true,
      relateCount: 3,
    });
    // Counts and the caller's own reaction are read for the page only, in
    // one grouped query each.
    expect(t.relateGroupBy).toHaveBeenCalledTimes(1);
    expect(t.relateGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { confessionId: { in: ['b', 'a'] } } }),
    );
    expect(page.nextCursor).toBe(`${NOW.toISOString()}|a`);
  });

  it('applies a keyset cursor with an id tie-break', async () => {
    const t = build();
    t.profileFindUnique.mockResolvedValue(null);
    await t.service.list('u1', 'c1', {
      limit: 20,
      cursor: `${NOW.toISOString()}|abc`,
    });
    expect(t.confessionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          collegeId: 'c1',
          status: ConfessionStatus.VISIBLE,
          OR: [
            { createdAt: { lt: NOW } },
            { createdAt: NOW, id: { lt: 'abc' } },
          ],
        },
      }),
    );
    expect(t.relateFindMany).not.toHaveBeenCalled();
  });
});

describe('ConfessionsService — live totals', () => {
  const withEvents = () => {
    const emit = jest.fn((_type: string, _data: unknown, _targets?: string[]) =>
      Promise.resolve(),
    );
    const t = build({ events: stub<DomainEventService>({ emit }) });
    return { t, emit };
  };

  it('broadcasts the new totals to the campus when they move, and nothing else', async () => {
    const { t, emit } = withEvents();
    t.queryRaw.mockResolvedValue([reactionRow({ previous: 'LOVE', love: 2 })]);
    await t.service.react('u1', 'college-1', 'x', 'sad');
    expect(emit).toHaveBeenCalledTimes(1);
    const [type, data, targets] = emit.mock.calls[0];
    expect(type).toBe('confession.reactions');
    expect(targets).toBeUndefined();
    const { at, ...rest } = data as { at: unknown };
    expect(typeof at).toBe('number');
    expect(rest).toEqual({
      collegeId: 'college-1',
      confessionId: 'x',
      reactions: { love: 1, funny: 0, sad: 1, surprised: 0, relatable: 0 },
      reactionCount: 2,
    });
    // Totals only: nothing that says who reacted, or with what.
    expect(JSON.stringify(data)).not.toMatch(/u1|myReaction|profile|user/i);
  });

  it('sends nothing for a repeat or a no-op', async () => {
    const { t, emit } = withEvents();
    t.queryRaw.mockResolvedValue([reactionRow({ previous: 'SAD', sad: 1 })]);
    await t.service.react('u1', 'college-1', 'x', 'sad');
    t.queryRaw.mockResolvedValue([reactionRow()]);
    await t.service.unreact('u1', 'college-1', 'x');
    expect(emit).not.toHaveBeenCalled();
  });

  it('a failed broadcast does not fail the reaction', async () => {
    const emit = jest.fn(() => Promise.reject(new Error('redis down')));
    const t = build({ events: stub<DomainEventService>({ emit }) });
    await expect(
      t.service.react('u1', 'college-1', 'x', 'love'),
    ).resolves.toMatchObject({ myReaction: 'love' });
  });
});

describe('ConfessionsService — sync', () => {
  it('returns newer confessions, fresh totals for those held, and which are gone', async () => {
    const t = build();
    t.profileFindUnique.mockResolvedValue({ id: 'me' });
    t.confessionFindMany
      .mockResolvedValueOnce([row('new1', 'other')]) // newer than the cursor
      .mockResolvedValueOnce([{ id: 'a' }] as unknown as ReturnType<
        typeof row
      >[]); // still visible
    t.relateFindMany.mockResolvedValue([
      { confessionId: 'a', reaction: ConfessionReactionType.FUNNY },
    ]);
    t.relateGroupBy.mockResolvedValue([
      {
        confessionId: 'a',
        reaction: ConfessionReactionType.FUNNY,
        _count: { _all: 2 },
      },
    ]);

    const out = await t.service.sync('u1', 'college-1', {
      after: `${NOW.toISOString()}|top`,
      ids: ['a', 'b', 'a'],
    });

    expect(t.confessionFindMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          collegeId: 'college-1',
          status: ConfessionStatus.VISIBLE,
          OR: [
            { createdAt: { gt: NOW } },
            { createdAt: NOW, id: { gt: 'top' } },
          ],
        },
        take: 51,
      }),
    );
    expect(t.confessionFindMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          collegeId: 'college-1',
          status: ConfessionStatus.VISIBLE,
          id: { in: ['a', 'b'] },
        },
      }),
    );
    expect(out.newer.map((c) => c.id)).toEqual(['new1']);
    expect(out.hasMoreNewer).toBe(false);
    expect(out.gone).toEqual(['b']);
    expect(out.states.a).toMatchObject({
      reactionCount: 2,
      myReaction: 'funny',
    });
    // One grouped count for new and held together.
    expect(t.relateGroupBy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(out)).not.toMatch(/profileId|userId/);
  });

  it('says to start again when more is new than one answer holds', async () => {
    const t = build();
    t.profileFindUnique.mockResolvedValue(null);
    t.confessionFindMany.mockResolvedValueOnce(
      Array.from({ length: 51 }, (_, i) => row(`n${i}`, 'other')),
    );
    const out = await t.service.sync('u1', 'c1', {
      after: `${NOW.toISOString()}|top`,
      ids: [],
    });
    expect(out.hasMoreNewer).toBe(true);
    expect(out.newer).toHaveLength(50);
  });

  it('without a cursor, asks for nothing newer', async () => {
    const t = build();
    t.profileFindUnique.mockResolvedValue(null);
    await t.service.sync('u1', 'c1', { ids: [] });
    expect(t.confessionFindMany).not.toHaveBeenCalled();
  });
});

describe('ConfessionsService — get one', () => {
  it('reads only a VISIBLE confession on the caller’s campus', async () => {
    const t = build();
    t.profileFindUnique.mockResolvedValue({ id: 'me' });
    t.confessionFindFirst.mockResolvedValue(row('x', 'other'));
    const { confession } = await t.service.get('u1', 'c1', 'x');
    expect(t.confessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'x', collegeId: 'c1', status: ConfessionStatus.VISIBLE },
      }),
    );
    expect(confession).toMatchObject({
      id: 'x',
      handle: 'NightOwl',
      isMine: false,
    });
    expect(JSON.stringify(confession)).not.toMatch(/profileId|userId|other/);
  });

  it('404s a hidden, removed, deleted or other-campus confession alike', async () => {
    const t = build();
    t.confessionFindFirst.mockResolvedValue(null);
    await expect(codeOf(t.service.get('u1', 'c1', 'x'))).resolves.toMatchObject(
      {
        code: 'confession_not_found',
      },
    );
  });
});

describe('ConfessionsService — reactions', () => {
  /** The n-th reaction statement as Postgres gets it: `$n` placeholders. */
  const statement = (t: ReturnType<typeof build>, n = 0) => {
    const [strings, ...values] = t.queryRaw.mock.calls[n];
    return Prisma.sql(strings, ...values);
  };
  const sqlOf = (t: ReturnType<typeof build>, n = 0) => statement(t, n).text;
  const valuesOf = (t: ReturnType<typeof build>, n = 0) =>
    statement(t, n).values;

  it('is one statement per tap: no transaction, no separate lookups', async () => {
    const t = build();
    await t.service.react('u1', 'c1', 'x', 'love');
    await t.service.unreact('u1', 'c1', 'x');
    await t.service.relate('u1', 'c1', 'x');
    expect(t.queryRaw).toHaveBeenCalledTimes(3);
    expect(t.profileFindUnique).not.toHaveBeenCalled();
    expect(t.confessionFindFirst).not.toHaveBeenCalled();
  });

  it('scopes every write to the caller’s profile and a VISIBLE confession on their campus', async () => {
    const t = build();
    await t.service.react('u1', 'c1', 'x', 'love');
    const sql = sqlOf(t);
    expect(sql).toMatch(/FROM "ConfessionProfile" WHERE "userId" = \$1/);
    expect(sql).toMatch(/"collegeId" = \$3\s+AND status = 'VISIBLE'/);
    expect(sql).toMatch(/FROM target, me/);
    expect(valuesOf(t).slice(0, 3)).toEqual(['u1', 'x', 'c1']);
    expect(valuesOf(t)).toContain(ConfessionReactionType.LOVE);
  });

  it('requires a profile, before saying anything about the confession', async () => {
    const t = build();
    t.queryRaw.mockResolvedValue([
      reactionRow({ hasProfile: false, visible: false }),
    ]);
    await expect(
      codeOf(t.service.react('u1', 'c1', 'x', 'love')),
    ).resolves.toMatchObject({ code: 'confession_profile_required' });
  });

  it('404s outside the campus or when not visible', async () => {
    const t = build();
    t.queryRaw.mockResolvedValue([reactionRow({ visible: false })]);
    await expect(
      codeOf(t.service.react('u1', 'c1', 'x', 'love')),
    ).resolves.toMatchObject({
      code: 'confession_not_found',
    });
    await expect(
      codeOf(t.service.unreact('u1', 'c1', 'x')),
    ).resolves.toMatchObject({
      code: 'confession_not_found',
    });
  });

  it('a first reaction adds one to its kind', async () => {
    const t = build();
    t.queryRaw.mockResolvedValue([reactionRow({ love: 3 })]);
    await expect(t.service.react('u1', 'c1', 'x', 'love')).resolves.toEqual({
      reactions: { love: 4, funny: 0, sad: 0, surprised: 0, relatable: 0 },
      reactionCount: 4,
      myReaction: 'love',
      relateCount: 4,
      relatedByMe: true,
    });
  });

  it('a change moves one count to another kind; the total stays', async () => {
    const t = build();
    t.queryRaw.mockResolvedValue([
      reactionRow({ previous: 'LOVE', love: 2, funny: 1 }),
    ]);
    await expect(
      t.service.react('u1', 'c1', 'x', 'funny'),
    ).resolves.toMatchObject({
      reactions: { love: 1, funny: 2 },
      reactionCount: 3,
      myReaction: 'funny',
    });
  });

  it('the same reaction again changes nothing', async () => {
    const t = build();
    t.queryRaw.mockResolvedValue([reactionRow({ previous: 'SAD', sad: 1 })]);
    await expect(
      t.service.react('u1', 'c1', 'x', 'sad'),
    ).resolves.toMatchObject({
      reactions: { sad: 1 },
      reactionCount: 1,
    });
    // The upsert only rewrites a row whose reaction differs, and only an
    // inserted row moves the stored total.
    expect(sqlOf(t)).toMatch(/IS DISTINCT FROM EXCLUDED\."reaction"/);
    expect(sqlOf(t)).toMatch(/EXISTS \(SELECT 1 FROM written WHERE added\)/);
  });

  it('removing takes one off the kind actually removed', async () => {
    const t = build();
    t.queryRaw.mockResolvedValue([
      reactionRow({ previous: 'RELATABLE', relatable: 5 }),
    ]);
    await expect(t.service.unreact('u1', 'c1', 'x')).resolves.toMatchObject({
      reactions: { relatable: 4 },
      myReaction: null,
      relatedByMe: false,
    });
    expect(sqlOf(t)).toMatch(/GREATEST\("relateCount" - 1, 0\)/);

    // Nothing to remove: nothing moves.
    t.queryRaw.mockResolvedValue([reactionRow({ relatable: 5 })]);
    await expect(t.service.unreact('u1', 'c1', 'x')).resolves.toMatchObject({
      reactions: { relatable: 5 },
    });
  });

  it('legacy relate adds Relatable but never overwrites a newer reaction', async () => {
    const t = build();
    t.queryRaw.mockResolvedValue([reactionRow()]);
    await expect(t.service.relate('u1', 'c1', 'x')).resolves.toMatchObject({
      myReaction: 'relatable',
      relatedByMe: true,
      relateCount: 1,
    });
    expect(sqlOf(t)).toMatch(
      /ON CONFLICT \("confessionId", "profileId"\) DO NOTHING/,
    );

    t.queryRaw.mockResolvedValue([reactionRow({ previous: 'LOVE', love: 1 })]);
    await expect(t.service.relate('u1', 'c1', 'x')).resolves.toMatchObject({
      myReaction: 'love',
      relatedByMe: true,
      relateCount: 1,
    });
  });

  it('legacy unrelate is unreact', async () => {
    const t = build();
    await t.service.unrelate('u1', 'c1', 'x');
    expect(sqlOf(t)).toMatch(/DELETE FROM "ConfessionRelate"/);
  });
});

describe('ConfessionsService — delete', () => {
  it('only the author may remove, whatever campus they are on now', async () => {
    const t = build();
    t.profileFindUnique.mockResolvedValue({ id: 'p1' });
    t.confessionUpdateMany.mockResolvedValue({ count: 0 });
    await expect(t.service.remove('u1', 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(t.confessionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'x',
        profileId: 'p1',
        status: { not: ConfessionStatus.REMOVED },
      },
      data: { status: ConfessionStatus.REMOVED },
    });
    t.confessionUpdateMany.mockResolvedValue({ count: 1 });
    await expect(t.service.remove('u1', 'x')).resolves.toEqual({
      ok: true,
    });
  });

  it('404s for a caller with no profile', async () => {
    const t = build();
    t.profileFindUnique.mockResolvedValue(null);
    await expect(t.service.remove('u1', 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(t.confessionUpdateMany).not.toHaveBeenCalled();
  });
});

describe('syncConfessionReports — auto-hide', () => {
  const run = (reporters: number) => {
    const updateMany = jest.fn(() => Promise.resolve({ count: 1 }));
    const findMany = jest.fn(() =>
      Promise.resolve(
        Array.from({ length: reporters }, (_, i) => ({ reporterId: `r${i}` })),
      ),
    );
    const prisma = stub<PrismaService>({
      report: { findMany },
      confession: { updateMany },
    });
    return { result: syncConfessionReports(prisma, 'x'), updateMany, findMany };
  };

  it('counts distinct reporters and does not hide below 5', async () => {
    const { result, updateMany, findMany } = run(4);
    await expect(result).resolves.toEqual({ reporters: 4, hidden: false });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ distinct: ['reporterId'] }),
    );
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'x' },
      data: { reportCount: 4 },
    });
  });

  it('hides a VISIBLE confession at 5 distinct reporters', async () => {
    const { result, updateMany } = run(5);
    await expect(result).resolves.toEqual({ reporters: 5, hidden: true });
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: 'x', status: ConfessionStatus.VISIBLE },
      data: { status: ConfessionStatus.HIDDEN },
    });
  });
});

describe('ReportTargetResolver — CONFESSION', () => {
  const build = (collegeId: string | null) => {
    const findFirst = jest.fn(() => Promise.resolve({ id: 'x' }));
    const resolver = new ReportTargetResolver(
      stub<PrismaService>({
        user: {
          findUnique: jest.fn(() =>
            Promise.resolve({ collegeAffiliation: affiliatedWith(collegeId) }),
          ),
        },
        confession: { findFirst },
      }),
      stub<ActivityAuthorizationService>({}),
    );
    return { resolver, findFirst };
  };

  it("scopes to the reporter's active campus and excludes REMOVED", async () => {
    const { resolver, findFirst } = build('college-a');
    await expect(
      resolver.exists(ReportTargetType.CONFESSION, 'x', 'reporter'),
    ).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'x',
        collegeId: 'college-a',
        status: { not: ConfessionStatus.REMOVED },
      },
      select: { id: true },
    });
  });

  it('answers not-found without an active affiliation', async () => {
    const { resolver, findFirst } = build(null);
    await expect(
      resolver.exists(ReportTargetType.CONFESSION, 'x', 'reporter'),
    ).resolves.toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe('syncConfessionReports — only open reports count', () => {
  it('asks for PENDING and UNDER_REVIEW reports only', async () => {
    const findMany = jest.fn(() => Promise.resolve([{ reporterId: 'r1' }]));
    const prisma = stub<PrismaService>({
      report: { findMany },
      confession: { updateMany: jest.fn(() => Promise.resolve({ count: 1 })) },
    });
    await syncConfessionReports(prisma, 'x');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          targetType: 'CONFESSION',
          targetId: 'x',
          status: { in: ['PENDING', 'UNDER_REVIEW'] },
        },
      }),
    );
  });
});

describe('ConfessionsService — moderate', () => {
  const setup = (exists = true) => {
    const findUnique = jest.fn(() =>
      Promise.resolve(exists ? { id: 'cf1' } : null),
    );
    const update = jest.fn(
      ({
        data,
      }: {
        data: { status: ConfessionStatus; reportCount?: number };
      }) =>
        Promise.resolve({
          id: 'cf1',
          status: data.status,
          reportCount: data.reportCount ?? 7,
        }),
    );
    const reportUpdateMany = jest.fn(() => Promise.resolve({ count: 7 }));
    const tx = {
      confession: { findUnique, update },
      report: { updateMany: reportUpdateMany },
    };
    const prisma = stub<PrismaService>({
      $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    });
    return {
      service: new ConfessionsService(prisma),
      update,
      reportUpdateMany,
    };
  };

  it('removes a confession without touching its reports', async () => {
    const t = setup();
    await expect(
      t.service.moderate('cf1', ConfessionStatus.REMOVED, 'admin-1'),
    ).resolves.toEqual({ id: 'cf1', status: 'REMOVED', reportCount: 7 });
    expect(t.reportUpdateMany).not.toHaveBeenCalled();
  });

  it('restoring closes the open reports so they cannot re-hide it', async () => {
    const t = setup();
    await expect(
      t.service.moderate('cf1', ConfessionStatus.VISIBLE, 'admin-1'),
    ).resolves.toEqual({ id: 'cf1', status: 'VISIBLE', reportCount: 0 });
    expect(t.reportUpdateMany).toHaveBeenCalledWith({
      where: {
        targetType: 'CONFESSION',
        targetId: 'cf1',
        status: { in: ['PENDING', 'UNDER_REVIEW'] },
      },
      data: expect.objectContaining({
        status: 'REJECTED',
        resolvedBy: 'admin-1',
      }) as unknown,
    });
  });

  it('404s an unknown confession', async () => {
    const t = setup(false);
    await expect(
      codeOf(t.service.moderate('nope', ConfessionStatus.HIDDEN, undefined)),
    ).resolves.toMatchObject({ code: 'confession_not_found' });
    expect(t.update).not.toHaveBeenCalled();
  });
});
