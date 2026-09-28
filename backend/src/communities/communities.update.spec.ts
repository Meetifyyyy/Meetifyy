import { CommunitiesService } from './communities.service';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { RedisService } from '../redis/redis.service';
import type { PresenceService } from '../presence/presence.service';
import type { DefaultAssetsService } from '../uploads/default-assets.service';
import type { BlocksService } from '../users/blocks.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { NotificationFactory } from '../notifications/notification.factory';

/**
 * Saving a community edit (pending item A16).
 *
 * CommunityAdminModal always sends `{ name, description, avatarKey, coverKey }`.
 * Every new community gets the default avatar (a `/api/media/…` reference, so
 * the relation branch: `avatarMedia: { connect }`) and no cover (`''`, so the
 * clear branch). The clear branch wrote the raw `coverMediaId: null`, and
 * Prisma rejects a mix of relation and raw-foreign-key input in one update —
 * confirmed against the development database with an update on an id that
 * cannot exist. So saving any edit to such a community failed with a 500.
 */
describe('CommunitiesService.updateCommunity', () => {
  const ID = 'comm-1';
  const OWNER = 'owner-1';

  const build = () => {
    const update = jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: ID, avatarKey: null, coverKey: null, ...data }),
    );
    const service = new CommunitiesService(
      stub<PrismaService>({
        community: {
          findUnique: jest.fn(() =>
            Promise.resolve({
              ownerId: OWNER,
              avatarKey: '/api/media/defaults/community-avatar.webp',
              coverKey: null,
            }),
          ),
          update,
        },
        communityMember: {
          findUnique: jest.fn(() => Promise.resolve({ role: 'OWNER' })),
        },
      }),
      stub<DomainEventService>({ emit: jest.fn(() => Promise.resolve()) }),
      stub<RedisService>({ getClient: () => null }),
      stub<PresenceService>(),
      stub<DefaultAssetsService>(),
      stub<BlocksService>(),
      stub<NotificationsService>(),
      stub<NotificationFactory>(),
    );
    return { service, update };
  };

  it("saves the modal's payload for a community with the default avatar and no cover", async () => {
    const { service, update } = build();

    await service.updateCommunity(
      ID,
      {
        name: 'Chess Club',
        description: 'We play chess.',
        avatarKey: '/api/media/defaults/community-avatar.webp',
        coverKey: '',
      },
      OWNER,
    );

    const { data } = update.mock.calls[0][0];
    expect(data).toMatchObject({
      name: 'Chess Club',
      description: 'We play chess.',
      avatarMedia: {
        connect: { objectKey: 'defaults/community-avatar.webp' },
      },
      coverKey: null,
      coverMedia: { disconnect: true },
    });
    // One input style: never the raw foreign keys.
    expect(data).not.toHaveProperty('avatarMediaId');
    expect(data).not.toHaveProperty('coverMediaId');
  });

  it('clears an avatar through the relation too', async () => {
    const { service, update } = build();

    await service.updateCommunity(ID, { avatarKey: '' }, OWNER);

    const { data } = update.mock.calls[0][0];
    expect(data).toMatchObject({
      avatarKey: null,
      avatarMedia: { disconnect: true },
    });
    expect(data).not.toHaveProperty('avatarMediaId');
  });

  it('leaves the description alone when it is sent empty, as it always has', async () => {
    const { service, update } = build();

    await service.updateCommunity(ID, { name: 'X', description: '' }, OWNER);

    // Prisma treats an undefined field as "leave unchanged".
    expect(update.mock.calls[0][0].data.description).toBeUndefined();
  });
});
