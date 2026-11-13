import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Prisma } from '@prisma/client';
import { stub } from '../common/testing/stub';
import { PrismaService } from '../prisma/prisma.service';
import type { MessagesService } from '../messages/messages.service';
import type { BlocksService } from '../users/blocks.service';
import type { StorageProvider } from '../uploads/providers/storage-provider.interface';
import { MediaCleanupService } from '../uploads/media-cleanup.service';
import { createVerificationAccessMock } from '../common/verification/testing/verification-access.mock';
import {
  InstantMatchService,
  setRealtimeGatewayRef,
} from './instant-match.service';
import { createEmitterMock } from './testing/prisma-fake';

/**
 * Instant Match against a real Postgres (E-7a): the SQL the in-memory fake
 * cannot vouch for. The advisory locks, the "holds a live match" filter, the
 * stored requests cleared to SQL NULL, a closed chat's photos recorded and
 * deleted, and migration 41 on rows written before it.
 *
 * Needs a disposable database with every migration applied, named in BOTH
 * `DATABASE_URL` and `INSTANT_MATCH_TEST_DATABASE_URL`, on localhost. Skipped
 * otherwise, so it can never run against a shared database.
 */
const TEST_URL = process.env.INSTANT_MATCH_TEST_DATABASE_URL ?? '';
const runnable =
  TEST_URL !== '' &&
  process.env.DATABASE_URL === TEST_URL &&
  /@(127\.0\.0\.1|localhost):\d+\//.test(TEST_URL);
const describeDb = runnable ? describe : describe.skip;

describeDb('Instant Match (database)', () => {
  let prisma: PrismaService;
  let service: InstantMatchService;
  const deleted: string[] = [];

  const users = async (n: number) => {
    const ids = Array.from({ length: n }, () => randomUUID());
    await prisma.user.createMany({
      data: ids.map((id) => ({
        id,
        username: `im_${id.slice(0, 8)}`,
        displayName: 'IM',
        email: `${id}@example.test`,
        verificationStatus: 'VERIFIED',
      })),
    });
    return ids;
  };
  const queue = (userId: string) =>
    prisma.matchQueueEntry.create({
      data: {
        userId,
        campus: 'campus-a',
        activity: 'study',
        timePreference: 'now',
        latitude: 12.97,
        longitude: 77.59,
        joinedAt: new Date(Date.now() - 10 * 60_000),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    setRealtimeGatewayRef(createEmitterMock());
    const storage = stub<StorageProvider>({
      delete: jest.fn((key: string) => {
        deleted.push(key);
        return Promise.resolve(true);
      }),
    });
    service = new InstantMatchService(
      prisma,
      stub<MessagesService>({
        registerInstantMatchGuard: jest.fn(),
        createInstantMatchConversation: jest.fn(
          async (a: string, b: string) => {
            const expiresAt = new Date(Date.now() + 24 * 3_600_000);
            const conv = await prisma.conversation.create({
              data: {
                publicId: `im${randomUUID().slice(0, 10)}`,
                type: 'INSTANT_MATCH',
                isInstantMatch: true,
                expiresAt,
                participants: {
                  create: [{ userId: a }, { userId: b }],
                },
              },
            });
            return {
              id: conv.publicId ?? conv.id,
              internalId: conv.id,
              expiresAt: expiresAt.getTime(),
            };
          },
        ),
      }),
      stub<BlocksService>({
        getExcludedUserIds: () => Promise.resolve([]),
        isBlocked: () => Promise.resolve(false),
      }),
      createVerificationAccessMock(),
      undefined,
      undefined,
      new MediaCleanupService(prisma, storage),
    );
    service.rankingOptions = { deterministic: true };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Each test pairs only the people it queues itself.
  beforeEach(async () => {
    await prisma.matchQueueEntry.deleteMany({});
  });

  it('pairs, accepts under the advisory locks, links the chat and clears the stored requests', async () => {
    const [a, b] = await users(2);
    await queue(a);
    await queue(b);

    await service.tryMatch(a);
    const [session] = await prisma.matchSession.findMany({
      where: { userAId: { in: [a, b] } },
    });
    expect(session.status).toBe('PENDING');
    expect(session.snapshotA).toMatchObject({ gps: { latitude: 12.97 } });

    await service.respondToMatch(a, session.id, 'accept');
    await service.respondToMatch(b, session.id, 'accept');

    const accepted = await prisma.matchSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(accepted).toMatchObject({
      status: 'ACCEPTED',
      chatStatus: 'ACTIVE',
    });
    expect(accepted.conversationId).not.toBeNull();
    // SQL NULL, not a JSON null: the location is gone.
    const raw = await prisma.$queryRaw<
      Array<{ a: boolean; b: boolean }>
    >`SELECT "snapshotA" IS NULL AS a, "snapshotB" IS NULL AS b FROM "MatchSession" WHERE "id" = ${session.id}`;
    expect(raw[0]).toEqual({ a: true, b: true });
  });

  it('will not pair someone who already holds a match, and removes their leftover row', async () => {
    const [a, b, c] = await users(3);
    await prisma.matchSession.create({
      data: {
        userAId: a,
        userBId: b,
        activity: 'study',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await queue(a); // a leftover row
    await queue(c);

    await service.tryMatch(c);

    expect(
      await prisma.matchSession.count({
        where: { OR: [{ userAId: c }, { userBId: c }] },
      }),
    ).toBe(0);
    expect(
      await prisma.matchQueueEntry.findUnique({ where: { userId: a } }),
    ).toBeNull();
    expect(
      await prisma.matchQueueEntry.findUnique({ where: { userId: c } }),
    ).not.toBeNull();
  });

  it('leaving a chat deletes its messages, records its photos and deletes them', async () => {
    const [a, b] = await users(2);
    await queue(a);
    await queue(b);
    await service.tryMatch(a);
    const [s] = await prisma.matchSession.findMany({
      where: { userAId: { in: [a, b] } },
    });
    await service.respondToMatch(a, s.id, 'accept');
    await service.respondToMatch(b, s.id, 'accept');
    const { conversationId } = await prisma.matchSession.findUniqueOrThrow({
      where: { id: s.id },
    });
    const key = `chat/${randomUUID()}.jpg`;
    const photo = await prisma.media.create({
      data: { objectKey: key, ownerId: a },
    });
    await prisma.message.createMany({
      data: [
        {
          conversationId: conversationId!,
          senderId: a,
          payload: { text: 'hi' },
        },
        {
          conversationId: conversationId!,
          senderId: a,
          payload: {},
          attachmentMediaId: photo.id,
        },
      ],
    });

    const result = await service.leaveChatSession(b);
    expect(result.ended).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(
      await prisma.message.count({
        where: { conversationId: conversationId! },
      }),
    ).toBe(0);
    expect(deleted).toContain(key);
    expect(await prisma.media.count({ where: { objectKey: key } })).toBe(0);
    expect(
      await prisma.pendingStorageDeletion.count({ where: { objectKey: key } }),
    ).toBe(0);
  });

  it('queue stats from one grouped query match the queue', async () => {
    const [a, b, c, d] = await users(4);
    const t = Date.now();
    await prisma.matchQueueEntry.createMany({
      data: [
        {
          userId: a,
          campus: 'x',
          activity: 'chat',
          timePreference: 'now',
          joinedAt: new Date(t - 120_000),
          expiresAt: new Date(t + 60_000),
        },
        {
          userId: b,
          campus: 'x',
          activity: 'chat',
          timePreference: 'now',
          joinedAt: new Date(t - 60_000),
          expiresAt: new Date(t + 60_000),
        },
        {
          userId: c,
          campus: 'x',
          activity: 'gaming',
          timePreference: 'now',
          joinedAt: new Date(t - 300_000),
          expiresAt: new Date(t + 60_000),
        },
        // Expired: not counted.
        {
          userId: d,
          campus: 'x',
          activity: 'gaming',
          timePreference: 'now',
          joinedAt: new Date(t - 900_000),
          expiresAt: new Date(t - 1_000),
        },
      ],
    });

    const stats = await service.getQueueStats('chat');
    expect(stats).toMatchObject({ count: 3, sameActivity: 2 });
    // (120 + 60 + 300) / 3 = 160 s, give or take the time the test takes.
    expect(stats.avgWaitSecs).toBeGreaterThanOrEqual(159);
    expect(stats.avgWaitSecs).toBeLessThanOrEqual(163);
  });

  it('migration 41 clears stored requests of answered matches and keeps pending ones', async () => {
    const [a, b, c, d] = await users(4);
    const withGps = {
      campus: 'x',
      activity: 'study',
      timePreference: 'now',
      gps: { latitude: 1, longitude: 2 },
    };
    const declined = await prisma.matchSession.create({
      data: {
        userAId: a,
        userBId: b,
        activity: 'study',
        expiresAt: new Date(),
        status: 'DECLINED',
        snapshotA: withGps,
        snapshotB: withGps,
      },
    });
    const request = await prisma.matchSession.create({
      data: {
        userAId: a,
        userBId: c,
        activity: 'study',
        expiresAt: new Date(),
        status: 'EXPIRED',
        snapshotA: { ...withGps, requested: true },
        snapshotB: withGps,
      },
    });
    const stillPending = await prisma.matchSession.create({
      data: {
        userAId: c,
        userBId: d,
        activity: 'study',
        expiresAt: new Date(Date.now() + 60_000),
        snapshotA: withGps,
        snapshotB: withGps,
      },
    });

    const sql = readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/00000000000041_scrub_match_snapshots/migration.sql',
      ),
      'utf8',
    );
    await prisma.$executeRawUnsafe(sql);

    const read = (id: string) =>
      prisma.matchSession.findUniqueOrThrow({
        where: { id },
        select: { snapshotA: true, snapshotB: true },
      });
    expect(await read(declined.id)).toEqual({
      snapshotA: null,
      snapshotB: null,
    });
    expect(await read(request.id)).toEqual({
      snapshotA: { requested: true },
      snapshotB: null,
    });
    expect(await read(stillPending.id)).toEqual({
      snapshotA: withGps,
      snapshotB: withGps,
    });
    expect(Prisma.DbNull).toBeDefined();
  });
});
