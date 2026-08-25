import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { ActivityAuthorizationService } from './activity-authorization.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { BlocksService } from '../users/blocks.service';
import { DomainEventService } from '../events/domain-event.service';
import { RedisService } from '../redis/redis.service';
import { getQueueToken } from '@nestjs/bullmq';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor';

/**
 * Accept → join → answer recorded → caller may navigate.
 *
 * The ordering matters: the membership must exist before this method resolves,
 * because the client redirects to the activity on the strength of that resolve.
 */
describe('acceptInvitation', () => {
  const ME = 'me';
  const ACT = 'act-1';
  const INV = 'inv-1';

  let service: ActivitiesService;
  let prisma: any;
  let invitation: any;
  let membership: any;
  let joinCalls: number;
  let notifications: any;

  beforeEach(async () => {
    joinCalls = 0;
    notifications = { updateNotificationLifecycleStatus: jest.fn(async () => []) };
    membership = null;
    invitation = {
      id: INV,
      activityId: ACT,
      inviteeId: ME,
      inviterId: 'host',
      status: 'PENDING',
      revokedAt: null,
      expiresAt: null,
      respondedAt: null,
      activity: { id: ACT },
    };

    prisma = {
      activityInvitation: {
        findUnique: jest.fn(async () => invitation),
        // The service writes conditionally (updateMany with a status guard) so
        // a concurrent cancellation cannot be overwritten.
        updateMany: jest.fn(async ({ where, data }: any) => {
          const allowed = where?.status?.in ?? (where?.status ? [where.status] : null);
          if (allowed && !allowed.includes(invitation.status)) return { count: 0 };
          invitation = { ...invitation, ...data };
          return { count: 1 };
        }),
        update: jest.fn(async ({ data }: any) => {
          invitation = { ...invitation, ...data };
          return invitation;
        }),
      },
      crewActivityMember: {
        findUnique: jest.fn(async () => membership),
      },
      // Not started yet, so the invitation is still answerable.
      crewActivity: {
        findUnique: jest.fn(async () => ({
          id: ACT,
          deletedAt: null,
          startDate: new Date(Date.now() + 60 * 60 * 1000),
        })),
      },
      user: { findUnique: jest.fn(async () => ({ id: ME, collegeId: null })) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        ActivityAuthorizationService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: NotificationFactory, useValue: {} },
        { provide: BlocksService, useValue: { getExcludedUserIds: jest.fn(async () => []) } },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        { provide: RedisService, useValue: { getClient: () => null } },
        { provide: getQueueToken(NOTIFICATIONS_QUEUE), useValue: { add: jest.fn() } },
      ],
    }).compile();

    service = module.get(ActivitiesService);

    // joinActivity is exercised by its own tests; here we only care that accept
    // calls it, waits for it, and treats its failure as fatal.
    jest.spyOn(service as any, 'joinActivity').mockImplementation(async () => {
      joinCalls += 1;
      membership = { status: 'MEMBER' };
      return { success: true };
    });
  });

  it('joins the activity before recording the answer and returns the activity id', async () => {
    const res = await service.acceptInvitation(INV, ME);

    expect(joinCalls).toBe(1);
    expect(membership?.status).toBe('MEMBER');
    expect(invitation.status).toBe('ACCEPTED');
    expect(res).toMatchObject({ success: true, activityId: ACT });
  });

  it('does not record acceptance when the join is refused', async () => {
    (service as any).joinActivity.mockRejectedValueOnce(new Error('Activity is full'));

    await expect(service.acceptInvitation(INV, ME)).rejects.toThrow('Activity is full');
    expect(invitation.status).toBe('PENDING');
    expect(prisma.activityInvitation.updateMany).not.toHaveBeenCalled();
  });

  it('is idempotent: a retry of an accepted invite succeeds without joining twice', async () => {
    await service.acceptInvitation(INV, ME);
    const second = await service.acceptInvitation(INV, ME);

    expect(joinCalls).toBe(1);
    expect(second).toMatchObject({ success: true, activityId: ACT, alreadyJoined: true });
  });

  it('still settles the notification on the already-joined fast path', async () => {
    // The path every retry takes. If it skipped the notification update, a
    // first attempt that failed to advance the row could never be repaired by
    // a later one — the row would keep offering Accept/Decline forever.
    invitation = { ...invitation, status: 'ACCEPTED' };
    membership = { status: 'MEMBER' };
    notifications.updateNotificationLifecycleStatus.mockClear();

    await service.acceptInvitation(INV, ME);

    expect(notifications.updateNotificationLifecycleStatus).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: ACT, status: 'ACCEPTED', recipientIds: [ME] }),
    );
  });

  it('marks the notification accepted on the normal path', async () => {
    await service.acceptInvitation(INV, ME);
    expect(notifications.updateNotificationLifecycleStatus).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: ACT, status: 'ACCEPTED', recipientIds: [ME] }),
    );
  });

  it('completes a join that a previous attempt left half-done', async () => {
    invitation = { ...invitation, status: 'ACCEPTED' };
    membership = null; // accepted, but the membership write never landed

    const res = await service.acceptInvitation(INV, ME);

    expect(joinCalls).toBe(1);
    expect(res).toMatchObject({ success: true, activityId: ACT });
  });

  it('refuses an invitation belonging to somebody else', async () => {
    await expect(service.acceptInvitation(INV, 'someone-else')).rejects.toThrow(NotFoundException);
    expect(joinCalls).toBe(0);
  });

  it('refuses a revoked invitation', async () => {
    invitation = { ...invitation, revokedAt: new Date() };
    await expect(service.acceptInvitation(INV, ME)).rejects.toThrow(NotFoundException);
    expect(joinCalls).toBe(0);
  });

  it('refuses an expired invitation', async () => {
    invitation = { ...invitation, expiresAt: new Date(Date.now() - 1000) };
    await expect(service.acceptInvitation(INV, ME)).rejects.toThrow(NotFoundException);
    expect(joinCalls).toBe(0);
  });

  describe('once the activity has started', () => {
    beforeEach(() => {
      prisma.crewActivity.findUnique = jest.fn(async () => ({
        id: ACT,
        deletedAt: null,
        startDate: new Date(Date.now() - 60 * 1000),
      }));
    });

    it('refuses the accept and settles the invitation as expired', async () => {
      await expect(service.acceptInvitation(INV, ME)).rejects.toThrow(/already started/i);
      expect(joinCalls).toBe(0);
      // Settled, not left PENDING: the row must stop offering a choice that the
      // join endpoint would refuse anyway.
      expect(invitation.status).toBe('EXPIRED');
    });

    it('refuses the decline too, so both buttons agree', async () => {
      await expect(service.declineInvitation(INV, ME)).rejects.toThrow(/already started/i);
      expect(invitation.status).toBe('EXPIRED');
    });

    it('marks the invite notification expired rather than deleting it', async () => {
      await expect(service.acceptInvitation(INV, ME)).rejects.toThrow(/already started/i);
      expect(notifications.updateNotificationLifecycleStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: ACT,
          status: 'EXPIRED',
          recipientIds: [ME],
          onlyIfStatusIn: ['PENDING'],
        }),
      );
    });
  });

  it('does not record acceptance when a cancellation already settled the invite', async () => {
    // The cancellation lands while the join is in flight: the conditional write
    // finds no PENDING row and the cancellation stands.
    (service as any).joinActivity.mockImplementation(async () => {
      joinCalls += 1;
      invitation = { ...invitation, status: 'CANCELLED' };
      return { success: true };
    });

    await service.acceptInvitation(INV, ME);
    expect(invitation.status).toBe('CANCELLED');
  });

  it('refuses a declined invitation rather than silently re-joining', async () => {
    invitation = { ...invitation, status: 'DECLINED' };
    await expect(service.acceptInvitation(INV, ME)).rejects.toThrow(NotFoundException);
    expect(joinCalls).toBe(0);
  });
});

/**
 * A host must not be able to re-invite someone who already accepted: a fresh
 * invite upserts the notification back to PENDING, which would wipe the record
 * of their answer and put Accept/Decline buttons back in front of them.
 */
describe('inviteFriends — already-accepted invitees', () => {
  const HOST = 'host';
  const ACT = 'act-1';
  const INVITEE = 'friend';

  let service: ActivitiesService;
  let prisma: any;
  let existingInvitation: any;
  let activityMembers: Array<{ userId: string }>;

  beforeEach(async () => {
    activityMembers = [];
    existingInvitation = null;

    prisma = {
      crewActivity: {
        findUnique: jest.fn(async () => ({
          id: ACT,
          creatorId: HOST,
          status: 'OPEN',
          deletedAt: null,
          visibility: 'PUBLIC',
          collegeId: null,
          title: 'Coffee',
          startDate: new Date(Date.now() + 60 * 60 * 1000),
          endDate: null,
          members: activityMembers,
        })),
      },
      activityInvitation: {
        findMany: jest.fn(async () => (existingInvitation ? [existingInvitation] : [])),
        createMany: jest.fn(async () => ({ count: 1 })),
      },
      user: { findUnique: jest.fn(async () => ({ id: HOST, displayName: 'Host', username: 'host' })) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        ActivityAuthorizationService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { createActivityInviteNotifications: jest.fn() } },
        { provide: NotificationFactory, useValue: {} },
        { provide: BlocksService, useValue: { getExcludedUserIds: jest.fn(async () => []) } },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        { provide: RedisService, useValue: { getClient: () => null } },
        { provide: getQueueToken(NOTIFICATIONS_QUEUE), useValue: { add: jest.fn(async () => ({})) } },
      ],
    }).compile();

    service = module.get(ActivitiesService);
  });

  it('refuses to re-invite someone whose invitation is ACCEPTED', async () => {
    existingInvitation = { inviteeId: INVITEE, activityId: ACT, status: 'ACCEPTED', respondedAt: new Date() };

    const res = await service.inviteFriends(ACT, HOST, [INVITEE]);

    expect(res.results).toEqual([
      expect.objectContaining({ inviteeId: INVITEE, status: 'ACCEPTED' }),
    ]);
    // No new invitation row, so the answered notification is never reset.
    expect(prisma.activityInvitation.createMany).not.toHaveBeenCalled();
  });

  it('refuses to re-invite a current participant', async () => {
    activityMembers = [{ userId: INVITEE }];

    const res = await service.inviteFriends(ACT, HOST, [INVITEE]);

    expect(res.results).toEqual([
      expect.objectContaining({ inviteeId: INVITEE, status: 'MEMBER' }),
    ]);
    expect(prisma.activityInvitation.createMany).not.toHaveBeenCalled();
  });

  it('still allows inviting somebody with no prior invitation', async () => {
    prisma.activityInvitation.findMany = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'inv-new', inviteeId: INVITEE }]);

    const res = await service.inviteFriends(ACT, HOST, [INVITEE]);

    expect(res.results).toEqual([
      expect.objectContaining({ inviteeId: INVITEE, status: 'INVITED' }),
    ]);
    expect(prisma.activityInvitation.createMany).toHaveBeenCalled();
  });
});
