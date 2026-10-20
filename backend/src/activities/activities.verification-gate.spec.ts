import { ForbiddenException } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { NotificationFactory } from '../notifications/notification.factory';
import type { BlocksService } from '../users/blocks.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { ActivityAuthorizationService } from './activity-authorization.service';
import type { VerificationAccessService } from '../common/verification/verification-access.service';
import type { CreateActivityDto } from './dto/activity.dto';

/**
 * @VerifiedOnly on the route is not the only line of defence: the service
 * refuses an ineligible creator itself, before any validation or write.
 */
describe('ActivitiesService.createActivity — service-level verification gate', () => {
  it('refuses an unverified creator and writes nothing', async () => {
    const create = jest.fn();
    const assertUsersEligible = jest.fn(() =>
      Promise.reject(
        new ForbiddenException('Account verification is required'),
      ),
    );
    const service = new ActivitiesService(
      stub<PrismaService>({ crewActivity: { create } }),
      stub<NotificationsService>(),
      stub<NotificationFactory>(),
      stub<BlocksService>(),
      stub<DomainEventService>(),
      stub<ActivityAuthorizationService>(),
      undefined,
      undefined,
      undefined,
      stub<VerificationAccessService>({ assertUsersEligible }),
    );

    await expect(
      service.createActivity(stub<CreateActivityDto>({ title: 'Hike' }), 'u1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(assertUsersEligible).toHaveBeenCalledWith(['u1'], 'u1');
    expect(create).not.toHaveBeenCalled();
  });
});
