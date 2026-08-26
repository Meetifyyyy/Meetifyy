import { Test, TestingModule } from '@nestjs/testing';
import { BlocksService } from '../users/blocks.service';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventService } from '../events/domain-event.service';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * An activity invite notification is a record of what happened, so answering it
 * — or the activity being cancelled / ending underneath it — must re-state the
 * SAME row rather than delete it or add a second one.
 */
describe('NotificationsService - activity invite lifecycle', () => {
  let service: NotificationsService;

  const mockPrisma: any = {
    notification: {
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    user: { findUnique: jest.fn() },
    block: { findFirst: jest.fn() },
  };

  const mockDomainEventService = { emit: jest.fn() };

  const row = (overrides: any = {}) => ({
    id: 'notif-1',
    recipientId: 'user-1',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    entityId: 'act-1',
    type: 'ACTIVITY_INVITE',
    readAt: new Date(),
    metadata: { lifecycleStatus: 'PENDING', invitationId: 'inv-1' },
    actor: {
      id: 'host-1',
      username: 'host',
      displayName: 'Host',
      avatar: null,
    },
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // The service compare-and-swaps via updateMany, then re-reads the row.
    let lastWrite: any = null;
    mockPrisma.notification.updateMany.mockImplementation(({ data }: any) => {
      lastWrite = data;
      return Promise.resolve({ count: 1 });
    });
    mockPrisma.notification.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve({
        id: where.id,
        recipientId: 'user-1',
        ...(lastWrite || {}),
      }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        EventEmitter2,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DomainEventService, useValue: mockDomainEventService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: RedisService,
          useValue: { getClient: jest.fn().mockReturnValue(null) },
        },
        {
          provide: BlocksService,
          useValue: {
            getExcludedUserIds: jest.fn().mockResolvedValue([]),
            isBlocked: jest.fn().mockResolvedValue(false),
            filterBlockedUsers: jest.fn(async (_u: any, ids: any) => ids),
            injectBlockFilter: jest.fn(async (_u: any, w: any) => w),
            invalidateBlockCache: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('updates the existing row in place and never soft-deletes it', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([row()]);

    await service.updateNotificationLifecycleStatus({
      type: 'ACTIVITY_INVITE',
      entityId: 'act-1',
      recipientIds: ['user-1'],
      status: 'ACCEPTED',
    });

    expect(mockPrisma.notification.updateMany).toHaveBeenCalledTimes(1);
    const call = mockPrisma.notification.updateMany.mock.calls[0][0];
    // Scoped to the exact row version that was judged — the CAS guard.
    expect(call.where).toMatchObject({ id: 'notif-1', deletedAt: null });
    expect(call.where.updatedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(call.data.metadata.lifecycleStatus).toBe('ACCEPTED');
    // The invite's own identity is preserved, so no duplicate can be created.
    expect(call.data.metadata.invitationId).toBe('inv-1');
    expect(call.data.deletedAt).toBeUndefined();
    expect(mockPrisma.notification.create).not.toHaveBeenCalled();
  });

  it('emits notification:updated to the recipient for realtime clients', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([row()]);

    await service.updateNotificationLifecycleStatus({
      type: 'ACTIVITY_INVITE',
      entityId: 'act-1',
      status: 'DECLINED',
    });

    expect(mockDomainEventService.emit).toHaveBeenCalledWith(
      'notification:updated',
      expect.objectContaining({ id: 'notif-1' }),
      ['user-1'],
    );
  });

  it('does not overwrite an answered invite when the activity later ends', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([
      row({ metadata: { lifecycleStatus: 'ACCEPTED', invitationId: 'inv-1' } }),
    ]);

    await service.updateNotificationLifecycleStatus({
      type: 'ACTIVITY_INVITE',
      entityId: 'act-1',
      status: 'EXPIRED',
      onlyIfStatusIn: ['PENDING'],
    });

    expect(mockPrisma.notification.updateMany).not.toHaveBeenCalled();
    expect(mockDomainEventService.emit).not.toHaveBeenCalled();
  });

  it('moves an unanswered invite to CANCELLED when the host cancels', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([row()]);

    await service.updateNotificationLifecycleStatus({
      type: 'ACTIVITY_INVITE',
      entityId: 'act-1',
      status: 'CANCELLED',
      onlyIfStatusIn: ['PENDING'],
    });

    expect(
      mockPrisma.notification.updateMany.mock.calls[0][0].data.metadata
        .lifecycleStatus,
    ).toBe('CANCELLED');
  });

  it('stands down when a concurrent write already changed the row', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([row()]);
    mockPrisma.notification.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await service.updateNotificationLifecycleStatus({
      type: 'ACTIVITY_INVITE',
      entityId: 'act-1',
      status: 'ACCEPTED',
    });

    // The other writer won; no event is emitted for a write that did not happen.
    expect(res).toEqual([]);
    expect(mockDomainEventService.emit).not.toHaveBeenCalled();
  });

  it('leaves read state alone so a status change does not re-badge the bell', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([row()]);

    await service.updateNotificationLifecycleStatus({
      type: 'ACTIVITY_INVITE',
      entityId: 'act-1',
      status: 'ACCEPTED',
    });

    expect(
      mockPrisma.notification.updateMany.mock.calls[0][0].data.readAt,
    ).toBeUndefined();
  });
});
