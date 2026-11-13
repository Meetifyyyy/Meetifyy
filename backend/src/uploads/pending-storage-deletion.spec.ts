import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageProvider } from './providers/storage-provider.interface';
import {
  MediaCleanupService,
  pendingDeletionRetryDelayMs,
} from './media-cleanup.service';

/**
 * Deletes after a post, community or event goes (ID-4): recorded first, then
 * drained; only when recording itself fails does the old in-process retry
 * run. The real-Postgres behaviour is in pending-storage-deletion.db.spec.ts.
 */
describe('queueMediaDeletion', () => {
  const build = (recordFails: boolean) => {
    const createMany = jest.fn(
      (_args: { data: { objectKey: string }[]; skipDuplicates: boolean }) =>
        recordFails
          ? Promise.reject(new Error('database unavailable'))
          : Promise.resolve({ count: 1 }),
    );
    const findMany = jest.fn((_args: unknown) =>
      Promise.resolve([] as { objectKey: string; attempts: number }[]),
    );
    const remove = jest.fn((key: string) => Promise.resolve(Boolean(key)));
    const service = new MediaCleanupService(
      stub<PrismaService>({
        pendingStorageDeletion: { createMany, findMany },
        // Nothing references anything: every object is free to go.
        user: { findFirst: jest.fn(() => Promise.resolve(null)) },
        community: { findFirst: jest.fn(() => Promise.resolve(null)) },
        conversation: { findFirst: jest.fn(() => Promise.resolve(null)) },
        crewActivity: { findFirst: jest.fn(() => Promise.resolve(null)) },
        campusEvent: { findFirst: jest.fn(() => Promise.resolve(null)) },
        college: { findFirst: jest.fn(() => Promise.resolve(null)) },
        media: {
          findFirst: jest.fn(() => Promise.resolve(null)),
          deleteMany: jest.fn(() => Promise.resolve({ count: 1 })),
        },
      }),
      stub<StorageProvider>({ delete: remove }),
    );
    return { service, createMany, findMany, remove };
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('records the keys, once each and normalised, then drains exactly those', async () => {
    const { service, createMany, findMany, remove } = build(false);
    await service.queueMediaDeletion([
      'posts/a.jpg',
      '/api/media/posts/a.jpg',
      null,
      'blob:local',
      'posts/b.jpg',
    ]);
    expect(createMany).toHaveBeenCalledWith({
      data: [{ objectKey: 'posts/a.jpg' }, { objectKey: 'posts/b.jpg' }],
      skipDuplicates: true,
    });
    await flush();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { objectKey: { in: ['posts/a.jpg', 'posts/b.jpg'] } },
      }),
    );
    // Deleting is the drain's job, from what was recorded.
    expect(remove).not.toHaveBeenCalled();
  });

  it('falls back to deleting in process when the keys cannot be recorded', async () => {
    const { service, remove, findMany } = build(true);
    await expect(
      service.queueMediaDeletion(['posts/a.jpg']),
    ).resolves.toBeUndefined();
    await flush();
    await flush();
    expect(remove).toHaveBeenCalledWith('posts/a.jpg');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('records nothing for keys that are not ours to delete', async () => {
    const { service, createMany } = build(false);
    await service.queueMediaDeletion([null, '', 'data:image/png;base64,x']);
    expect(createMany).not.toHaveBeenCalled();
  });
});

describe('pendingDeletionRetryDelayMs', () => {
  it('waits a minute, doubles, and stops growing at six hours', () => {
    expect(pendingDeletionRetryDelayMs(1)).toBe(60_000);
    expect(pendingDeletionRetryDelayMs(2)).toBe(120_000);
    expect(pendingDeletionRetryDelayMs(5)).toBe(16 * 60_000);
    expect(pendingDeletionRetryDelayMs(9)).toBe(256 * 60_000);
    expect(pendingDeletionRetryDelayMs(10)).toBe(6 * 60 * 60_000);
    expect(pendingDeletionRetryDelayMs(40)).toBe(6 * 60 * 60_000);
  });
});
