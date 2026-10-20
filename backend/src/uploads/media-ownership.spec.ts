import { ForbiddenException } from '@nestjs/common';
import {
  assertMediaIdOwnedBy,
  assertMediaRefsOwnedBy,
} from './media-ownership.util';
import { MediaCleanupService } from './media-cleanup.service';
import { CommunitiesService } from '../communities/communities.service';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageProvider } from './providers/storage-provider.interface';
import type { DomainEventService } from '../events/domain-event.service';
import type { RedisService } from '../redis/redis.service';
import type { PresenceService } from '../presence/presence.service';
import type { DefaultAssetsService } from './default-assets.service';
import type { BlocksService } from '../users/blocks.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { NotificationFactory } from '../notifications/notification.factory';
import type { CampusAccessService } from '../common/campus/campus-access.service';

const prismaWithOwners = (owners: Record<string, string | null>) =>
  stub<PrismaService>({
    media: {
      findMany: jest.fn((args: { where: { objectKey: { in: string[] } } }) =>
        Promise.resolve(
          args.where.objectKey.in
            .filter((k) => k in owners)
            .map((k) => ({ objectKey: k, ownerId: owners[k] })),
        ),
      ),
      findUnique: jest.fn(() => Promise.resolve(null)),
    },
  });

describe('assertMediaRefsOwnedBy', () => {
  it('accepts the caller’s own upload', async () => {
    await expect(
      assertMediaRefsOwnedBy(prismaWithOwners({ 'a/mine.webp': 'me' }), 'me', [
        '/api/media/a/mine.webp',
      ]),
    ).resolves.toBeUndefined();
  });

  it('refuses another user’s upload', async () => {
    await expect(
      assertMediaRefsOwnedBy(prismaWithOwners({ 'a/his.webp': 'him' }), 'me', [
        '/api/media/a/his.webp',
      ]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a row with no recorded owner', async () => {
    await expect(
      assertMediaRefsOwnedBy(prismaWithOwners({ 'a/x.webp': null }), 'me', [
        '/api/media/a/x.webp',
      ]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('skips shared defaults / presets, external URLs, gradients and unchanged refs', async () => {
    const prisma = prismaWithOwners({ 'a/his.webp': 'him' });
    await assertMediaRefsOwnedBy(
      prisma,
      'me',
      [
        '/api/media/defaults/avatar.webp',
        '/api/media/presets/preset-1.webp',
        'https://cdn.example/x.png',
        'linear-gradient(red, blue)',
        '/api/media/a/his.webp',
        null,
        undefined,
      ],
      ['/api/media/a/his.webp'],
    );
    expect(prisma.media.findMany).not.toHaveBeenCalled();
  });
});

describe('assertMediaIdOwnedBy', () => {
  const prismaWithRow = (row: { ownerId: string | null; objectKey: string }) =>
    stub<PrismaService>({
      media: { findUnique: jest.fn(() => Promise.resolve(row)) },
    });

  it('refuses a cover id owned by someone else', async () => {
    await expect(
      assertMediaIdOwnedBy(
        prismaWithRow({ ownerId: 'him', objectKey: 'a/x.webp' }),
        'me',
        'm1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts the caller’s own and shared presets', async () => {
    await assertMediaIdOwnedBy(
      prismaWithRow({ ownerId: 'me', objectKey: 'a/x.webp' }),
      'me',
      'm1',
    );
    await assertMediaIdOwnedBy(
      prismaWithRow({ ownerId: null, objectKey: 'presets/preset-1.webp' }),
      'me',
      'm1',
    );
  });
});

describe('CommunitiesService — attaching images (H-23)', () => {
  const build = (owner: string) => {
    const update = jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'c1', avatarKey: null, coverKey: null, ...data }),
    );
    const service = new CommunitiesService(
      stub<PrismaService>({
        community: {
          findUnique: jest.fn(() =>
            Promise.resolve({ ownerId: 'me', avatarKey: null, coverKey: null }),
          ),
          update,
        },
        communityMember: {
          findUnique: jest.fn(() => Promise.resolve({ role: 'OWNER' })),
        },
        media: {
          findMany: jest.fn(() =>
            Promise.resolve([{ objectKey: 'covers/x.webp', ownerId: owner }]),
          ),
        },
      }),
      stub<DomainEventService>({ emit: jest.fn(() => Promise.resolve()) }),
      stub<RedisService>({ getClient: () => null }),
      stub<PresenceService>(),
      stub<DefaultAssetsService>(),
      stub<BlocksService>(),
      stub<NotificationsService>(),
      stub<NotificationFactory>(),
      stub<CampusAccessService>(),
    );
    return { service, update };
  };

  it('refuses a cover another user uploaded', async () => {
    const { service, update } = build('someone-else');
    await expect(
      service.updateCommunity(
        'c1',
        { coverKey: '/api/media/covers/x.webp' },
        'me',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('accepts the owner’s own cover', async () => {
    const { service, update } = build('me');
    await service.updateCommunity(
      'c1',
      { coverKey: '/api/media/covers/x.webp' },
      'me',
    );
    expect(update).toHaveBeenCalled();
  });
});

describe('MediaCleanupService — never deletes another user’s file on replace', () => {
  const build = (rowOwner: string | null) => {
    const del = jest.fn().mockResolvedValue(true);
    const prisma = {
      media: {
        // First lookup is the ownership check; any later one (is the key
        // still referenced elsewhere?) finds nothing.
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ ownerId: rowOwner })
          .mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: { findFirst: jest.fn().mockResolvedValue(null) },
      community: { findFirst: jest.fn().mockResolvedValue(null) },
      conversation: { findFirst: jest.fn().mockResolvedValue(null) },
      crewActivity: { findFirst: jest.fn().mockResolvedValue(null) },
      campusEvent: { findFirst: jest.fn().mockResolvedValue(null) },
      college: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new MediaCleanupService(
      stub<PrismaService>(prisma),
      stub<StorageProvider>({
        delete: del,
        list: jest.fn().mockResolvedValue([]),
      }),
    );
    return { service, del };
  };

  it('skips an old avatar that someone else uploaded', async () => {
    const { service, del } = build('victim');
    const res = await service.handleMediaReplacement(
      'USER_AVATAR',
      'attacker',
      '/api/media/avatars/victim.webp',
      '/api/media/avatars/new.webp',
      'attacker',
    );
    expect(del).not.toHaveBeenCalled();
    expect(res.skippedKeys[0].reason).toBe('Owned by a different user');
  });

  it('still deletes the user’s own replaced avatar', async () => {
    const { service, del } = build('attacker');
    await service.handleMediaReplacement(
      'USER_AVATAR',
      'attacker',
      '/api/media/avatars/old.webp',
      '/api/media/avatars/new.webp',
      'attacker',
    );
    expect(del).toHaveBeenCalled();
  });
});
