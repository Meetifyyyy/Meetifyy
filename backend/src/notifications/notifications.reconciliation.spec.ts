import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventService } from '../events/domain-event.service';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('NotificationsService - Event Driven Reconciliation', () => {
  let service: NotificationsService;
  let eventEmitter: EventEmitter2;

  const mockPrisma: any = {
    notification: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    user: {
      findUnique: jest.fn(),
    },
    block: {
      findFirst: jest.fn(),
    },
    post: {
      findUnique: jest.fn(),
    },
  };

  const mockDomainEventService = {
    emit: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockRedisService = {
    getClient: jest.fn().mockReturnValue(null),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        EventEmitter2,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DomainEventService, useValue: mockDomainEventService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
    service.onModuleInit();
  });

  it('should cancel existing notification when follow.deleted event is emitted', async () => {
    const existingNotif = { id: 'notif-100', readAt: null };
    mockPrisma.notification.findFirst.mockResolvedValue(existingNotif);
    mockPrisma.notification.update.mockResolvedValue({ ...existingNotif, deletedAt: new Date() });

    eventEmitter.emit('follow.deleted', {
      type: 'follow.deleted',
      timestamp: new Date().toISOString(),
      data: { followerId: 'user-A', followingId: 'user-B' }
    });

    // Wait microtasks for async handler
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith({
      where: {
        recipientId: 'user-B',
        actorId: 'user-A',
        entityId: 'user-A',
        type: 'FOLLOW',
        deletedAt: null,
      }
    });
    expect(mockPrisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'notif-100' },
      data: { deletedAt: expect.any(Date) }
    });
    expect(mockDomainEventService.emit).toHaveBeenCalledWith('notification:cancelled', {
      notificationId: 'notif-100',
      recipientId: 'user-B',
    }, ['user-B']);
  });

  it('should cancel existing post like notification when post.unliked event is emitted', async () => {
    mockPrisma.post.findUnique.mockResolvedValue({ authorId: 'author-1' });
    const existingNotif = { id: 'notif-200', readAt: null };
    mockPrisma.notification.findFirst.mockResolvedValue(existingNotif);
    mockPrisma.notification.update.mockResolvedValue({ ...existingNotif, deletedAt: new Date() });

    eventEmitter.emit('post.unliked', {
      type: 'post.unliked',
      timestamp: new Date().toISOString(),
      data: { postId: 'post-99', userId: 'user-liker' }
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith({
      where: {
        recipientId: 'author-1',
        actorId: 'user-liker',
        entityId: 'post-99',
        type: 'LIKE',
        deletedAt: null,
      }
    });
    expect(mockPrisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'notif-200' },
      data: { deletedAt: expect.any(Date) }
    });
  });
});
