import { NotFoundException } from '@nestjs/common';
import { ConfessionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfessionsService } from './confessions.service';

/**
 * Reactions against a real Postgres: one row per profile per confession under
 * concurrent taps, exact per-kind counts, the stored total that installed
 * builds read, and the visibility rule a shared link depends on.
 *
 * Needs a disposable database with the migrations applied, named in BOTH
 * `DATABASE_URL` and `CONFESSIONS_TEST_DATABASE_URL`, on localhost. Skipped
 * otherwise, so it can never run against a shared database.
 */
const TEST_URL = process.env.CONFESSIONS_TEST_DATABASE_URL ?? '';
const runnable =
  TEST_URL !== '' &&
  process.env.DATABASE_URL === TEST_URL &&
  /@(127\.0\.0\.1|localhost):\d+\//.test(TEST_URL);
const describeDb = runnable ? describe : describe.skip;

let seq = 0;
const uuid = () => {
  seq += 1;
  const n = (Date.now() % 1e8).toString(16).padStart(8, '0');
  return `${n}-0000-4000-8000-${seq.toString(16).padStart(12, '0')}`;
};

describeDb('confession reactions (database)', () => {
  let prisma: PrismaService;
  let service: ConfessionsService;
  let campus: string;
  let otherCampus: string;

  const newUser = async (): Promise<string> => {
    const id = uuid();
    await prisma.user.create({
      data: {
        id,
        username: `u${seq}${Date.now() % 1e6}`,
        displayName: 'Test',
        email: `${id}@test.local`,
      },
    });
    return id;
  };

  const withHandle = async (): Promise<string> => {
    const userId = await newUser();
    await service.createProfile(userId, `h${seq}x${Date.now() % 1e5}`);
    return userId;
  };

  const confess = async (): Promise<string> => {
    const author = await withHandle();
    const { confession } = await service.create(
      author,
      campus,
      `a confession long enough ${uuid()}`,
    );
    return confession.id;
  };

  const storedTotal = async (id: string) =>
    (
      await prisma.confession.findUniqueOrThrow({
        where: { id },
        select: { relateCount: true },
      })
    ).relateCount;

  beforeAll(async () => {
    prisma = new PrismaService();
    service = new ConfessionsService(prisma);
    campus = (await prisma.college.create({ data: { name: 'A' } })).id;
    otherCampus = (await prisma.college.create({ data: { name: 'B' } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('keeps one reaction per person through concurrent changes', async () => {
    const id = await confess();
    const me = await withHandle();
    await Promise.all([
      service.react(me, campus, id, 'love'),
      service.react(me, campus, id, 'sad'),
      service.react(me, campus, id, 'funny'),
      service.react(me, campus, id, 'love'),
    ]);
    const rows = await prisma.confessionReaction.findMany({
      where: { confessionId: id },
    });
    expect(rows).toHaveLength(1);
    expect(await storedTotal(id)).toBe(1);
  });

  it('counts each kind exactly and moves the stored total with rows only', async () => {
    const id = await confess();
    const a = await withHandle();
    const b = await withHandle();
    const c = await withHandle();
    await service.react(a, campus, id, 'love');
    await service.react(b, campus, id, 'love');
    await service.react(c, campus, id, 'relatable');
    // Changing is not adding.
    const changed = await service.react(c, campus, id, 'surprised');
    expect(changed).toEqual({
      reactions: { love: 2, funny: 0, sad: 0, surprised: 1, relatable: 0 },
      reactionCount: 3,
      myReaction: 'surprised',
      relateCount: 3,
      relatedByMe: true,
    });
    expect(await storedTotal(id)).toBe(3);

    const removed = await service.unreact(a, campus, id);
    expect(removed).toMatchObject({ myReaction: null, reactionCount: 2 });
    // Removing twice is a no-op, not a second decrement.
    await service.unreact(a, campus, id);
    expect(await storedTotal(id)).toBe(2);

    const { confession } = await service.get(b, campus, id);
    expect(confession).toMatchObject({
      myReaction: 'love',
      reactions: { love: 1, surprised: 1 },
      reactionCount: 2,
    });
  });

  it('legacy relate maps to Relatable and leaves a newer reaction alone', async () => {
    const id = await confess();
    const me = await withHandle();
    await expect(service.relate(me, campus, id)).resolves.toMatchObject({
      myReaction: 'relatable',
      relateCount: 1,
    });
    await service.react(me, campus, id, 'love');
    await expect(service.relate(me, campus, id)).resolves.toMatchObject({
      myReaction: 'love',
      relatedByMe: true,
      relateCount: 1,
    });
    await service.unrelate(me, campus, id);
    expect(await storedTotal(id)).toBe(0);
  });

  it('serves a confession only while visible, and only on its campus', async () => {
    const id = await confess();
    const viewer = await newUser();
    await expect(service.get(viewer, campus, id)).resolves.toBeDefined();
    await expect(service.get(viewer, otherCampus, id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.react(await withHandle(), otherCampus, id, 'love'),
    ).rejects.toBeInstanceOf(NotFoundException);

    for (const status of [ConfessionStatus.HIDDEN, ConfessionStatus.REMOVED]) {
      await prisma.confession.update({ where: { id }, data: { status } });
      await expect(service.get(viewer, campus, id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    }
  });

  /** The stored total, the rows and every answer must always agree. */
  const expectConsistent = async (id: string, viewer: string) => {
    const rows = await prisma.confessionReaction.count({
      where: { confessionId: id },
    });
    expect(await storedTotal(id)).toBe(rows);
    const { confession } = await service.get(viewer, campus, id);
    expect(confession.reactionCount).toBe(rows);
  };

  it('answers with the counts a fresh read would give, after every kind of change', async () => {
    const id = await confess();
    const me = await withHandle();
    const other = await withHandle();
    await service.react(other, campus, id, 'sad');
    for (const step of [
      () => service.react(me, campus, id, 'love'),
      () => service.react(me, campus, id, 'love'), // the same again: no-op
      () => service.react(me, campus, id, 'funny'),
      () => service.unreact(me, campus, id),
      () => service.unreact(me, campus, id), // nothing to remove
      () => service.relate(me, campus, id),
      () => service.react(me, campus, id, 'surprised'),
    ]) {
      const answered = await step();
      const { confession } = await service.get(me, campus, id);
      expect(answered).toEqual({
        reactions: confession.reactions,
        reactionCount: confession.reactionCount,
        myReaction: confession.myReaction,
        relateCount: confession.relateCount,
        relatedByMe: confession.relatedByMe,
      });
      await expectConsistent(id, me);
    }
  });

  it('stays consistent through a burst of rapid, out-of-order taps', async () => {
    const id = await confess();
    const me = await withHandle();
    const kinds = ['love', 'funny', 'sad', 'surprised', 'relatable'] as const;
    const burst: Array<Promise<unknown>> = [];
    for (let i = 0; i < 40; i += 1) {
      burst.push(
        i % 3 === 2
          ? service.unreact(me, campus, id)
          : service.react(me, campus, id, kinds[i % kinds.length]),
      );
    }
    await Promise.all(burst);
    const rows = await prisma.confessionReaction.count({
      where: { confessionId: id },
    });
    expect(rows).toBeLessThanOrEqual(1);
    await expectConsistent(id, me);
  });

  it('writes nothing without a profile, or for another campus', async () => {
    const id = await confess();
    const noHandle = await newUser();
    await expect(
      service.react(noHandle, campus, id, 'love'),
    ).rejects.toMatchObject({
      response: { code: 'confession_profile_required' },
    });
    await expect(
      service.react(await withHandle(), otherCampus, id, 'love'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      await prisma.confessionReaction.count({ where: { confessionId: id } }),
    ).toBe(0);
    expect(await storedTotal(id)).toBe(0);
  });
});
