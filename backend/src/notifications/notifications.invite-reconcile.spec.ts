import { expect } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BlocksService } from '../users/blocks.service';
import { stringField } from '../common/utils/type-guards.util';
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
  /** The Prisma surface; the notification page is re-pointed per case. */
  let mockPrisma: {
    notification: {
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
    activityInvitation: { findMany: jest.Mock };
    user: { findUnique: jest.Mock };
    block: { findFirst: jest.Mock };
  };
  let invitationRows: ReturnType<typeof invitationRow>[];

  const future = new Date(Date.now() + 60 * 60 * 1000);
  const past = new Date(Date.now() - 60 * 60 * 1000);

  /** The row version this read saw; the repair is conditional on it. */
  const READ_VERSION = new Date('2026-11-13T09:00:00.000Z');
  const notifRow = (lifecycleStatus?: string) => ({
    id: 'notif-1',
    recipientId: 'user-1',
    type: 'ACTIVITY_INVITE',
    entityId: 'act-1',
    createdAt: new Date(),
    updatedAt: READ_VERSION,
    metadata: {
      activityId: 'act-1',
      invitationId: 'inv-1',
      ...(lifecycleStatus ? { lifecycleStatus } : {}),
    },
  });

  const invitationRow = (
    status: string,
    activity: { status?: string; startDate?: Date } = {},
  ) => ({
    activityId: 'act-1',
    status,
    revokedAt: null as Date | null,
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
        findMany: jest.fn(() => Promise.resolve([notifRow('PENDING')])),
        update: jest.fn(() => Promise.resolve({})),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        count: jest.fn(() => Promise.resolve(0)),
      },
      activityInvitation: {
        findMany: jest.fn(() => Promise.resolve(invitationRows)),
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
            filterBlockedUsers: jest.fn((_u: string, ids: string[]) =>
              Promise.resolve(ids),
            ),
            injectBlockFilter: jest.fn((_u: string, w: unknown) =>
              Promise.resolve(w),
            ),
            invalidateBlockCache: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  const statusOf = async () => {
    const res = await service.getNotifications('user-1', 20);
    return stringField(res.data[0].metadata, 'lifecycleStatus');
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

    // Only if the row is still the version this read judged: a re-invite or
    // a lifecycle change in between must not be overwritten with old values.
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'notif-1', updatedAt: READ_VERSION, deletedAt: null },
      data: {
        metadata: expect.objectContaining({ lifecycleStatus: 'ACCEPTED' }),
      },
    });
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });

  it('leaves a genuinely pending invite pending, and writes nothing', async () => {
    invitationRows = [invitationRow('PENDING')];
    expect(await statusOf()).toBe('PENDING');
    await new Promise((r) => setImmediate(r));
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
    expect(mockPrisma.notification.updateMany).not.toHaveBeenCalled();
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
    mockPrisma.notification.findMany = jest.fn(() =>
      Promise.resolve([notifRow(undefined)]),
    );
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
    mockPrisma.notification.findMany = jest.fn(() =>
      Promise.resolve([
        { id: 'n2', type: 'FOLLOW', recipientId: 'user-1', metadata: {} },
      ]),
    );
    await service.getNotifications('user-1', 20);
    expect(mockPrisma.activityInvitation.findMany).not.toHaveBeenCalled();
  });
});
