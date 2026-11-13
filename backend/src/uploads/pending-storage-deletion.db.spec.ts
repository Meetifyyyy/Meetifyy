import { randomUUID } from 'crypto';
import { stub } from '../common/testing/stub';
import { PrismaService } from '../prisma/prisma.service';
import type { StorageProvider } from './providers/storage-provider.interface';
import { MediaCleanupService } from './media-cleanup.service';
import { AccountDeletionPurgeService } from '../account-deletion/account-deletion.purge.service';
import type { RedisService } from '../redis/redis.service';
import type { PresenceService } from '../presence/presence.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { UserSessionService } from '../auth/session/user-session.service';

/**
 * Owed storage deletes against a real Postgres (ID-4): an account purge
 * records its objects in its own transaction, so a storage outage or a restart
 * before the deletes finish leaves them on record, and the next drain (from a
 * fresh service, as after a restart) deletes them.
 *
 * Needs a disposable database with every migration applied (the PGlite rig,
 * or a local Postgres), named in BOTH `DATABASE_URL` and
 * `MEDIA_CLEANUP_TEST_DATABASE_URL`, on localhost. Skipped otherwise, so it
 * can never run against a shared database.
 */
const TEST_URL = process.env.MEDIA_CLEANUP_TEST_DATABASE_URL ?? '';
const runnable =
  TEST_URL !== '' &&
  process.env.DATABASE_URL === TEST_URL &&
  /@(127\.0\.0\.1|localhost):\d+\//.test(TEST_URL);
const describeDb = runnable ? describe : describe.skip;

describeDb('owed storage deletes (database)', () => {
  let prisma: PrismaService;

  /** A bucket that can be switched off, recording what it was asked to delete. */
  const bucket = () => {
    const state = { up: true, deleted: [] as string[] };
    const provider = stub<StorageProvider>({
      delete: jest.fn((key: string) => {
        if (!state.up) return Promise.reject(new Error('R2 unavailable'));
        state.deleted.push(key);
        return Promise.resolve(true);
      }),
    });
    return { state, provider };
  };
  const cleanupWith = (provider: StorageProvider) =>
    new MediaCleanupService(prisma, provider);

  const owed = async (keys: string[]) =>
    prisma.pendingStorageDeletion.findMany({
      where: { objectKey: { in: keys } },
      orderBy: { objectKey: 'asc' },
    });

  const newUser = async (avatar: string | null = null) => {
    const id = randomUUID();
    await prisma.user.create({
      data: {
        id,
        username: `u_${id.slice(0, 8)}`,
        displayName: 'U',
        email: `${id}@example.test`,
        avatar,
      },
    });
    return id;
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('records nothing when the transaction rolls back, and each key once when it commits', async () => {
    const service = cleanupWith(bucket().provider);
    const a = `posts/${randomUUID()}.jpg`;
    const b = `uploads/${randomUUID()}.png`;

    await expect(
      prisma.$transaction(async (tx) => {
        await service.recordPendingDeletions([a, b], tx);
        throw new Error('the deletes it belonged to failed');
      }),
    ).rejects.toThrow('failed');
    expect(await owed([a, b])).toEqual([]);

    const recorded = await prisma.$transaction((tx) =>
      service.recordPendingDeletions([a, b, a, null, 'blob:x'], tx),
    );
    expect(recorded.sort()).toEqual([a, b].sort());
    // Recording again is harmless.
    await service.recordPendingDeletions([a]);
    expect((await owed([a, b])).map((r) => r.objectKey)).toEqual([a, b].sort());
  });

  it('deletes owed objects and forgets them; a failure stays, with its next attempt pushed back', async () => {
    const { state, provider } = bucket();
    const service = cleanupWith(provider);
    const good = `posts/${randomUUID()}.jpg`;
    const bad = `posts/${randomUUID()}.jpg`;
    await service.recordPendingDeletions([good, bad]);

    // Only `good` gets through.
    const before = Date.now();
    jest
      .mocked(provider.delete)
      .mockImplementation((key: string) =>
        key === bad
          ? Promise.reject(new Error('R2 unavailable'))
          : Promise.resolve(Boolean(state.deleted.push(key))),
      );
    await expect(service.drainPendingDeletions([good, bad])).resolves.toEqual({
      done: 1,
      failed: 1,
    });
    expect(state.deleted).toEqual([good]);
    const [left] = await owed([good, bad]);
    expect(left.objectKey).toBe(bad);
    expect(left.attempts).toBe(1);
    expect(left.lastError).toContain('R2 unavailable');
    expect(left.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(
      before + 60_000,
    );

    // Not due yet: a sweep leaves it alone.
    jest.mocked(provider.delete).mockClear();
    await service.drainPendingDeletions();
    expect(provider.delete).not.toHaveBeenCalledWith(bad);
  });

  it('forgets a key that is still in use elsewhere, without deleting the object', async () => {
    const { state, provider } = bucket();
    const service = cleanupWith(provider);
    const shared = `avatars/${randomUUID()}.webp`;
    await newUser(shared);
    await service.recordPendingDeletions([shared]);
    await service.drainPendingDeletions([shared]);
    expect(state.deleted).not.toContain(shared);
    expect(await owed([shared])).toEqual([]);
  });

  describe('an account purge', () => {
    const purgeWith = (cleanup: MediaCleanupService) => {
      const purge = new AccountDeletionPurgeService(
        prisma,
        stub<RedisService>({ getClient: () => null }),
        stub<PresenceService>({ removePresence: jest.fn(async () => {}) }),
        stub<DomainEventService>({ emit: jest.fn(async () => {}) }),
        stub<UserSessionService>({
          revokeAllForUser: jest.fn(() => Promise.resolve(0)),
        }),
        cleanup,
      );
      // Never reach a real auth provider from a test.
      purge['deleteSupabaseIdentity'] = jest.fn();
      return purge;
    };

    /** An account with an avatar, a post with an image, and a stray upload. */
    const account = async () => {
      const avatar = `avatars/${randomUUID()}.webp`;
      const postImage = `posts/${randomUUID()}.jpg`;
      const stray = `uploads/${randomUUID()}.png`;
      const userId = await newUser(avatar);
      const post = await prisma.post.create({
        data: { authorId: userId, text: 'hello' },
      });
      await prisma.media.createMany({
        data: [
          { objectKey: avatar, ownerId: userId },
          { objectKey: postImage, ownerId: userId, postId: post.id },
          { objectKey: stray, ownerId: userId },
        ],
      });
      return { userId, keys: [avatar, postImage, stray].sort() };
    };

    it('keeps every object on record through a storage outage, and a later drain deletes them', async () => {
      const outage = bucket();
      outage.state.up = false;
      const { userId, keys } = await account();

      await expect(
        purgeWith(cleanupWith(outage.provider)).purgeUser(userId),
      ).resolves.toEqual({ purged: true });
      // Let the post-commit drain run and fail.
      await new Promise((resolve) => setTimeout(resolve, 200));

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.accountStatus).toBe('DELETED');
      expect(await prisma.media.count({ where: { ownerId: userId } })).toBe(0);
      expect(outage.state.deleted).toEqual([]);
      const waiting = await owed(keys);
      expect(waiting.map((r) => r.objectKey)).toEqual(keys);
      expect(waiting.every((r) => r.attempts === 1)).toBe(true);

      // "After a restart": a new service, storage back, the retry now due.
      await prisma.pendingStorageDeletion.updateMany({
        where: { objectKey: { in: keys } },
        data: { nextAttemptAt: new Date(Date.now() - 1000) },
      });
      const restored = bucket();
      await cleanupWith(restored.provider).drainPendingDeletions();
      expect(restored.state.deleted.sort()).toEqual(keys);
      expect(await owed(keys)).toEqual([]);
    });

    it('deletes the objects right after the purge when storage is up', async () => {
      const { state, provider } = bucket();
      const { userId, keys } = await account();
      await purgeWith(cleanupWith(provider)).purgeUser(userId);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(state.deleted.sort()).toEqual(keys);
      expect(await owed(keys)).toEqual([]);
    });

    it('records nothing when the purge itself rolls back', async () => {
      const { state, provider } = bucket();
      const { userId, keys } = await account();
      const purge = purgeWith(cleanupWith(provider));
      // Fail the step after the keys are recorded.
      purge['purgeUserRelations'] = jest.fn(() =>
        Promise.reject(new Error('purge step failed')),
      );
      await expect(purge.purgeUser(userId)).rejects.toThrow(
        'purge step failed',
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(await owed(keys)).toEqual([]);
      expect(state.deleted).toEqual([]);
      expect(await prisma.media.count({ where: { ownerId: userId } })).toBe(3);
    });
  });
});
