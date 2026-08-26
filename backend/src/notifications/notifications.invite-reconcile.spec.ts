import { Test, TestingModule } from '@nestjs/testing';
import { BlocksService } from '../users/blocks.service';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventService } from '../events/domain-event.service';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * The invitation row is the authority on what an invite notification says.
 *
 * `metadata.lifecycleStatus` is a denormalised copy, so a swallowed write, a
 * row created before the field existed, or an invitation settled by a path
 * that missed the notification all leave it stale — and a stale PENDING is a
 * row still offering Accept/Decline for an invite that was already answered.
 */
describe('invite notification reconciliation on read', () => {
  let service: NotificationsService;
  let mockPrisma: any;
  let invitationRows: any[];

  const future = new Date(Date.now() + 60 * 60 * 1000);
  const past = new Date(Date.now() - 60 * 60 * 1000);

  const notifRow = (lifecycleStatus?: string) => ({
    id: 'notif-1',
    recipientId: 'user-1',
    type: 'ACTIVITY_INVITE',
    entityId: 'act-1',
    createdAt: new Date(),
    metadata: {
      activityId: 'act-1',
      invitationId: 'inv-1',
      ...(lifecycleStatus ? { lifecycleStatus } : {}),
    },
  });

  const invitationRow = (status: string, activity: any = {}) => ({
    activityId: 'act-1',
    status,
    revokedAt: null,
    activity: {
      status: 'OPEN',
      startDate: future,
      deletedAt: null,
      ...activity,
    },
  });

  beforeEach(async () => {
    invitationRows = [];
    mockPrisma = {
      notification: {
        findMany: jest.fn(async () => [notifRow('PENDING')]),
        update: jest.fn(async () => ({})),
        count: jest.fn(async () => 0),
      },
      activityInvitation: {
        findMany: jest.fn(async () => invitationRows),
      },
      user: { findUnique: jest.fn() },
      block: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        EventEmitter2,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
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

  const statusOf = async () => {
    const res = await service.getNotifications('user-1', 20);
    return res.data[0].metadata.lifecycleStatus;
  };

  it('reports Accepted when the notification copy is stale at Pending', async () => {
    invitationRows = [invitationRow('ACCEPTED')];
    expect(await statusOf()).toBe('ACCEPTED');
  });

  it('reports Declined from the invitation row', async () => {
    invitationRows = [invitationRow('DECLINED')];
    expect(await statusOf()).toBe('DECLINED');
  });

  it('repairs the stored copy so the drift does not recur', async () => {
    invitationRows = [invitationRow('ACCEPTED')];
    await service.getNotifications('user-1', 20);
    await new Promise((r) => setImmediate(r));

    expect(mockPrisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notif-1' },
        data: {
          metadata: expect.objectContaining({ lifecycleStatus: 'ACCEPTED' }),
        },
      }),
    );
  });

  it('leaves a genuinely pending invite pending, and writes nothing', async () => {
    invitationRows = [invitationRow('PENDING')];
    expect(await statusOf()).toBe('PENDING');
    await new Promise((r) => setImmediate(r));
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });

  it('expires a pending invite whose activity has already started', async () => {
    invitationRows = [invitationRow('PENDING', { startDate: past })];
    expect(await statusOf()).toBe('EXPIRED');
  });

  it('reports Cancelled when the activity was cancelled', async () => {
    invitationRows = [invitationRow('PENDING', { status: 'CANCELLED' })];
    expect(await statusOf()).toBe('CANCELLED');
  });

  it('reports Cancelled when the host revoked the invitation', async () => {
    invitationRows = [{ ...invitationRow('PENDING'), revokedAt: new Date() }];
    expect(await statusOf()).toBe('CANCELLED');
  });

  it('fills in a legacy row that never had a lifecycle status', async () => {
    mockPrisma.notification.findMany = jest.fn(async () => [
      notifRow(undefined),
    ]);
    invitationRows = [invitationRow('ACCEPTED')];
    expect(await statusOf()).toBe('ACCEPTED');
  });

  it('leaves the stored copy alone when there is no invitation row to judge by', async () => {
    invitationRows = [];
    expect(await statusOf()).toBe('PENDING');
    await new Promise((r) => setImmediate(r));
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });

  it('does not query invitations when the page holds no invite notifications', async () => {
    mockPrisma.notification.findMany = jest.fn(async () => [
      { id: 'n2', type: 'FOLLOW', recipientId: 'user-1', metadata: {} },
    ]);
    await service.getNotifications('user-1', 20);
    expect(mockPrisma.activityInvitation.findMany).not.toHaveBeenCalled();
  });
});
