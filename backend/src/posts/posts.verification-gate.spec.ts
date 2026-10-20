import { ForbiddenException } from '@nestjs/common';
import { PostsService } from './posts.service';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { NotificationFactory } from '../notifications/notification.factory';
import type { BlocksService } from '../users/blocks.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { RedisService } from '../redis/redis.service';
import type { MentionsService } from '../mentions/mentions.service';
import type { StorageService } from '../uploads/uploads.service';
import type { ContentDeletionAuthorizer } from './content-deletion.authorizer';
import type { VerificationAccessService } from '../common/verification/verification-access.service';

/**
 * @VerifiedOnly on the route is not the only line of defence: the service
 * refuses an ineligible author itself, before touching the database.
 */
describe('PostsService.createPost — service-level verification gate', () => {
  const create = jest.fn(() => Promise.resolve({ id: 'p1', media: [] }));

  const build = (
    assertUsersEligible: VerificationAccessService['assertUsersEligible'],
  ) =>
    new PostsService(
      stub<PrismaService>({ post: { create } }),
      stub<NotificationsService>(),
      stub<NotificationFactory>(),
      stub<BlocksService>(),
      stub<DomainEventService>({ emit: jest.fn() }),
      stub<RedisService>(),
      stub<MentionsService>({ sanitize: jest.fn(() => Promise.resolve([])) }),
      stub<StorageService>(),
      stub<ContentDeletionAuthorizer>(),
      undefined,
      stub<VerificationAccessService>({ assertUsersEligible }),
    );

  beforeEach(() => create.mockClear());

  it('refuses an unverified author and writes nothing', async () => {
    const assertUsersEligible = jest.fn(() =>
      Promise.reject(
        new ForbiddenException('Account verification is required'),
      ),
    );
    const service = build(assertUsersEligible);

    await expect(service.createPost('u1', 'hello')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(assertUsersEligible).toHaveBeenCalledWith(['u1'], 'u1');
    expect(create).not.toHaveBeenCalled();
  });
});
