import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventService } from '../events/domain-event.service';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationType } from '@prisma/client';

/**
 * Which notification types reach the Notifications page and the bell badge.
 *
 * JOIN_REQUEST used to be filtered out of both, from when it meant "pending
 * approval" and had its own surface. Joining is direct now, so an activity-join
 * notification was being written and then hidden — the host never saw it. The
 * list filter and the count filter must also agree with each other, or the badge
 * shows a number the list can never clear.
 */
describe('NotificationsService — what reaches the notifications page', () => {
  let service: NotificationsService;

  const prisma: any = {
    notification: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    block: { findFirst: jest.fn() },
    post: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        EventEmitter2,
        { provide: PrismaService, useValue: prisma },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: RedisService, useValue: { getClient: jest.fn().mockReturnValue(null) } },
      ],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('lists activity-join notifications instead of filtering them out', async () => {
    await service.getNotifications('user-1');
    const where = prisma.notification.findMany.mock.calls[0][0].where;
    expect(where.type.notIn).not.toContain(NotificationType.JOIN_REQUEST);
  });

  it('counts activity-join notifications toward the bell', async () => {
    await service.getUnreadCount('user-1');
    const where = prisma.notification.count.mock.calls[0][0].where;
    expect(where.type.notIn).not.toContain(NotificationType.JOIN_REQUEST);
  });

  it('still keeps chat messages out of both — they have their own badge', async () => {
    await service.getNotifications('user-1');
    await service.getUnreadCount('user-1');
    expect(prisma.notification.findMany.mock.calls[0][0].where.type.notIn).toContain(NotificationType.MESSAGE);
    expect(prisma.notification.count.mock.calls[0][0].where.type.notIn).toContain(NotificationType.MESSAGE);
  });

  it('applies exactly the same type filter to the list and to the count', async () => {
    await service.getNotifications('user-1');
    await service.getUnreadCount('user-1');
    const listFilter = prisma.notification.findMany.mock.calls[0][0].where.type.notIn;
    const countFilter = prisma.notification.count.mock.calls[0][0].where.type.notIn;
    expect([...countFilter].sort()).toEqual([...listFilter].sort());
  });
});
