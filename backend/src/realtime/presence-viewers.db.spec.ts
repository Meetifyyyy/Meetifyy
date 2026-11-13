import { PrismaService } from '../prisma/prisma.service';
import { presenceViewerIds } from './presence-viewers';

/**
 * The presence audience, against a real Postgres: the one-query DISTINCT join
 * must name exactly the people the old per-membership read did.
 *
 * Needs a disposable database with every migration applied (the PGlite rig,
 * or a local Postgres), named in BOTH `DATABASE_URL` and
 * `PRESENCE_TEST_DATABASE_URL`, on localhost. Skipped otherwise, so it can
 * never run against a shared database.
 */
const TEST_URL = process.env.PRESENCE_TEST_DATABASE_URL ?? '';
const runnable =
  TEST_URL !== '' &&
  process.env.DATABASE_URL === TEST_URL &&
  /@(127\.0\.0\.1|localhost):\d+\//.test(TEST_URL);
const describeDb = runnable ? describe : describe.skip;

let seq = 0;
const uuid = () => {
  seq += 1;
  const n = (Date.now() % 1e8).toString(16).padStart(8, '0');
  return `${n}-0000-4000-9000-${seq.toString(16).padStart(12, '0')}`;
};

describeDb('presence audience (database)', () => {
  let prisma: PrismaService;

  /** The read this replaced, verbatim, as the oracle. */
  const oldViewerIds = async (userId: string): Promise<string[]> => {
    const sharedConvs = await prisma.conversationParticipant.findMany({
      where: {
        conversation: {
          participants: {
            some: { userId: userId, deletedAt: null, leftAt: null },
          },
        },
        deletedAt: null,
        leftAt: null,
      },
      select: { userId: true },
    });
    return [
      ...new Set(
        sharedConvs.map((p) => p.userId).filter((id) => id !== userId),
      ),
    ];
  };

  const users = async (n: number): Promise<string[]> => {
    const ids = Array.from({ length: n }, () => uuid());
    await prisma.user.createMany({
      data: ids.map((id) => ({
        id,
        username: `p_${id.slice(-8)}`,
        displayName: 'P',
        email: `p_${id.slice(-8)}@example.test`,
      })),
    });
    return ids;
  };

  type Member = { userId: string; left?: boolean; hidden?: boolean };
  const conversation = async (type: 'GROUP' | 'DM', members: Member[]) => {
    const id = uuid();
    await prisma.conversation.create({
      data: { id, publicId: `p${id.slice(-10)}`, type },
    });
    await prisma.conversationParticipant.createMany({
      data: members.map((m) => ({
        userId: m.userId,
        conversationId: id,
        leftAt: m.left ? new Date() : null,
        deletedAt: m.hidden ? new Date() : null,
      })),
    });
  };

  const sorted = (ids: string[]) => [...ids].sort();

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('counts only conversations both people are still in, and never the user', async () => {
    const [me, a, b, c, d, e, f, g] = await users(8);
    await conversation('GROUP', [
      { userId: me },
      { userId: a },
      { userId: b, left: true },
      { userId: c, hidden: true },
    ]);
    // The user hid this one, and left that one: neither shares anything.
    await conversation('GROUP', [{ userId: me, hidden: true }, { userId: d }]);
    await conversation('GROUP', [{ userId: me, left: true }, { userId: e }]);
    await conversation('DM', [{ userId: me }, { userId: f }]);
    // Not the user's at all; `a` appears twice overall and is named once.
    await conversation('GROUP', [{ userId: g }, { userId: a }]);
    await conversation('DM', [{ userId: me }, { userId: a }]);

    expect(sorted(await presenceViewerIds(prisma, me))).toEqual(sorted([a, f]));
    expect(sorted(await presenceViewerIds(prisma, me))).toEqual(
      sorted(await oldViewerIds(me)),
    );
  });

  it('matches the old read for someone in many overlapping groups', async () => {
    const people = await users(120);
    const me = people[0];
    let state = 7;
    const next = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    for (let g = 0; g < 12; g += 1) {
      const members: Member[] = [
        { userId: me, left: next() < 0.15, hidden: next() < 0.1 },
      ];
      const picked = new Set<string>();
      while (picked.size < 30) {
        picked.add(people[1 + Math.floor(next() * (people.length - 1))]);
      }
      for (const userId of picked) {
        members.push({ userId, left: next() < 0.15, hidden: next() < 0.1 });
      }
      await conversation('GROUP', members);
    }
    const viewers = await presenceViewerIds(prisma, me);
    expect(new Set(viewers).size).toBe(viewers.length);
    expect(viewers).not.toContain(me);
    expect(sorted(viewers)).toEqual(sorted(await oldViewerIds(me)));
    // And for a few of the others, whose view of the same rows differs.
    for (const other of people.slice(1, 6)) {
      expect(sorted(await presenceViewerIds(prisma, other))).toEqual(
        sorted(await oldViewerIds(other)),
      );
    }
  });
});
