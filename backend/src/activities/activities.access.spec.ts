import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { ActivityAuthorizationService } from './activity-authorization.service';
import { ActivityDiscussionService } from './discussion/activity-discussion.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { BlocksService } from '../users/blocks.service';
import { DomainEventService } from '../events/domain-event.service';
import { RedisService } from '../redis/redis.service';
import { getQueueToken } from '@nestjs/bullmq';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor';

/**
 * Endpoint-level enforcement: the same matrix as the policy spec, but driven
 * through the service methods a real request would hit, so a route that forgets
 * to consult the policy fails here.
 */
describe('Activity access enforcement (service level)', () => {
  const GLA = 'college-gla';
  const OTHER = 'college-other';

  const USERS: Record<string, { id: string; collegeId: string | null }> = {
    'host-1': { id: 'host-1', collegeId: GLA },
    'user-same': { id: 'user-same', collegeId: GLA },
    'user-other': { id: 'user-other', collegeId: OTHER },
  };

  let service: ActivitiesService;
  let discussion: ActivityDiscussionService;
  let prisma: any;
  let activityRow: any;

  const baseActivity = (visibility: string, invitations: any[] = [], members: any[] = []) => ({
    id: 'act-1',
    creatorId: 'host-1',
    collegeId: GLA,
    visibility,
    status: 'OPEN',
    deletedAt: null,
    startDate: new Date(Date.now() + 86_400_000),
    endDate: null,
    title: 'Secret rooftop dinner',
    description: 'A very private thing',
    location: 'Rooftop, Block C',
    maxMembers: null,
    participationType: 'OPEN',
    members,
    invitations,
    creator: { id: 'host-1', username: 'host', displayName: 'Host', avatar: null },
    _count: { members: members.length || 1 },
  });

  beforeEach(async () => {
    activityRow = baseActivity('PUBLIC');

    prisma = {
      crewActivity: {
        findUnique: jest.fn(async ({ include, where }: any) => {
          if (!activityRow) return null;
          if (where?.creatorId && where.creatorId !== activityRow.creatorId) return null;
          // Emulate Prisma's per-relation `where` filtering for the caller's own rows.
          const row = { ...activityRow };
          const inviteeFilter = include?.invitations?.where?.inviteeId;
          if (inviteeFilter !== undefined) {
            row.invitations = row.invitations.filter((i: any) => i.inviteeId === inviteeFilter);
          }
          const memberFilter = include?.members?.where?.userId;
          if (memberFilter !== undefined) {
            row.members = row.members.filter((m: any) => m.userId === memberFilter);
          }
          return row;
        }),
        findFirst: jest.fn(async () => activityRow),
        update: jest.fn(async ({ data }: any) => ({ id: 'act-1', ...data })),
      },
      crewActivityMember: {
        findUnique: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
      },
      user: {
        findUnique: jest.fn(async ({ where }: any) => USERS[where.id] ?? null),
      },
      activityInvitation: {
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => []),
      },
      activityDiscussionMessage: {
        findMany: jest.fn(async () => []),
        create: jest.fn(async ({ data }: any) => ({
          id: 'msg-1',
          ...data,
          createdAt: new Date(),
          user: { id: data.userId, username: 'u', displayName: 'U', avatar: null },
        })),
      },
      $queryRaw: jest.fn(async () => [{ inserted: true }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        ActivityDiscussionService,
        ActivityAuthorizationService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { createNotification: jest.fn(), cancelNotificationByCriteria: jest.fn() } },
        { provide: NotificationFactory, useValue: { createActivityJoin: jest.fn() } },
        { provide: BlocksService, useValue: { getExcludedUserIds: jest.fn(async () => []) } },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        { provide: RedisService, useValue: { getClient: () => null } },
        { provide: getQueueToken(NOTIFICATIONS_QUEUE), useValue: { add: jest.fn() } },
      ],
    }).compile();

    service = module.get(ActivitiesService);
    discussion = module.get(ActivityDiscussionService);
  });

  const expectDenied = async (fn: () => Promise<any>, code: string) => {
    await expect(fn()).rejects.toBeInstanceOf(ForbiddenException);
    try {
      await fn();
    } catch (err: any) {
      const body = err.getResponse();
      expect(body.code).toBe(code);
      // No restricted detail may ride along on the denial.
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('Secret rooftop dinner');
      expect(serialized).not.toContain('Rooftop, Block C');
      expect(serialized).not.toContain('host-1');
    }
  };

  describe('GET /api/activities/:id', () => {
    it('returns an Anyone activity to a viewer from another college', async () => {
      activityRow = baseActivity('PUBLIC');
      const res = await service.getActivityById('act-1', 'user-other');
      expect(res.title).toBe('Secret rooftop dinner');
    });

    it('denies a College activity to another college, with no details', async () => {
      activityRow = baseActivity('COLLEGE_ONLY');
      await expectDenied(() => service.getActivityById('act-1', 'user-other'), 'COLLEGE_RESTRICTED');
    });

    it('serves a College activity to the same college', async () => {
      activityRow = baseActivity('COLLEGE_ONLY');
      await expect(service.getActivityById('act-1', 'user-same')).resolves.toMatchObject({ id: 'act-1' });
    });

    it('serves a College activity to an invited outsider', async () => {
      activityRow = baseActivity('COLLEGE_ONLY', [
        { inviteeId: 'user-other', status: 'PENDING', revokedAt: null, expiresAt: null },
      ]);
      await expect(service.getActivityById('act-1', 'user-other')).resolves.toMatchObject({ isInvited: true });
    });

    it('denies a College activity once the invitation is revoked', async () => {
      activityRow = baseActivity('COLLEGE_ONLY', [
        { inviteeId: 'user-other', status: 'PENDING', revokedAt: new Date(), expiresAt: null },
      ]);
      await expectDenied(() => service.getActivityById('act-1', 'user-other'), 'COLLEGE_RESTRICTED');
    });

    it('denies a Private activity to an uninvited same-college viewer', async () => {
      activityRow = baseActivity('PRIVATE');
      await expectDenied(() => service.getActivityById('act-1', 'user-same'), 'PRIVATE');
    });

    it('gives the host full access to a Private activity', async () => {
      activityRow = baseActivity('PRIVATE');
      await expect(service.getActivityById('act-1', 'host-1')).resolves.toMatchObject({ id: 'act-1' });
    });

    it('never returns another user’s invitation rows', async () => {
      activityRow = baseActivity('PUBLIC', [
        { inviteeId: 'user-same', status: 'PENDING', revokedAt: null, expiresAt: null },
      ]);
      const res: any = await service.getActivityById('act-1', 'user-other');
      expect(res.invitations).toBeUndefined();
    });
  });

  describe('POST /api/activities/:id/join', () => {
    it('rejects a direct API join on a College activity from another college', async () => {
      activityRow = baseActivity('COLLEGE_ONLY');
      await expect(service.joinActivity('act-1', 'user-other')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('rejects a direct API join on a Private activity', async () => {
      activityRow = baseActivity('PRIVATE');
      await expect(service.joinActivity('act-1', 'user-same')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('allows an invited outsider to join a Private activity', async () => {
      activityRow = baseActivity('PRIVATE', [
        { inviteeId: 'user-other', status: 'PENDING', revokedAt: null, expiresAt: null },
      ]);
      await expect(service.joinActivity('act-1', 'user-other')).resolves.toEqual({ success: true });
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it('rejects an expired invitation', async () => {
      activityRow = baseActivity('PRIVATE', [
        { inviteeId: 'user-other', status: 'PENDING', revokedAt: null, expiresAt: new Date(Date.now() - 1000) },
      ]);
      await expect(service.joinActivity('act-1', 'user-other')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets anyone join an Anyone activity, and is idempotent under repeats', async () => {
      activityRow = baseActivity('PUBLIC');
      await expect(service.joinActivity('act-1', 'user-other')).resolves.toEqual({ success: true });
      // The insert is an ON CONFLICT upsert, so a rapid repeat is a no-op rather
      // than a duplicate attendance row.
      prisma.$queryRaw.mockResolvedValueOnce([{ inserted: false }]);
      await expect(service.joinActivity('act-1', 'user-other')).resolves.toEqual({ success: true });
      const sql = String(prisma.$queryRaw.mock.calls[0][0].join(' '));
      expect(sql).toContain('ON CONFLICT');
    });
  });

  describe('POST /api/activities/:id/bookmark', () => {
    it('refuses to bookmark an activity the user may not view', async () => {
      activityRow = baseActivity('COLLEGE_ONLY');
      await expect(service.bookmarkActivity('act-1', 'user-other')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('activity discussion', () => {
    it('refuses to read the discussion of a restricted activity', async () => {
      activityRow = baseActivity('PRIVATE');
      prisma.crewActivity.findFirst.mockImplementation(async () => activityRow);
      await expect(discussion.getMessages('act-1', 'user-other')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.activityDiscussionMessage.findMany).not.toHaveBeenCalled();
    });

    it('refuses to post into the discussion of a restricted activity', async () => {
      activityRow = baseActivity('COLLEGE_ONLY');
      prisma.crewActivity.findFirst.mockImplementation(async () => activityRow);
      await expect(discussion.sendMessage('act-1', 'user-other', 'hello')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.activityDiscussionMessage.create).not.toHaveBeenCalled();
    });

    it('allows a same-college member to read and post', async () => {
      activityRow = baseActivity('COLLEGE_ONLY');
      prisma.crewActivity.findFirst.mockImplementation(async () => activityRow);
      await expect(discussion.getMessages('act-1', 'user-same')).resolves.toMatchObject({ messages: [] });
      await expect(discussion.sendMessage('act-1', 'user-same', 'hi')).resolves.toMatchObject({ text: 'hi' });
    });
  });

  describe('attendees', () => {
    it('lets a member beyond the embedded attendee page still open the activity', async () => {
      // The detail payload caps `members`; membership must be resolved by
      // primary key, not by scanning that capped slice, or a member who joined
      // late would be locked out of their own college-restricted activity.
      activityRow = baseActivity('COLLEGE_ONLY');
      prisma.crewActivityMember.findUnique = jest.fn(async () => ({
        userId: 'user-other',
        status: 'MEMBER',
      }));
      await expect(service.getActivityById('act-1', 'user-other')).resolves.toMatchObject({ id: 'act-1' });
    });

    it('reports the authoritative attendee count alongside the capped page', async () => {
      activityRow = baseActivity('PUBLIC', [], []);
      activityRow._count = { members: 412 };
      const res: any = await service.getActivityById('act-1', 'user-same');
      expect(res.memberCount).toBe(412);
      expect(res._count).toBeUndefined();
    });

    it('refuses the attendee list to an unauthorized viewer', async () => {
      activityRow = baseActivity('COLLEGE_ONLY');
      prisma.crewActivityMember.findMany = jest.fn(async () => []);
      await expect(service.getAttendees('act-1', 'user-other')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.crewActivityMember.findMany).not.toHaveBeenCalled();
    });

    it('pages attendees with a compound cursor', async () => {
      activityRow = baseActivity('PUBLIC');
      const joinedAt = new Date();
      prisma.crewActivityMember.findMany = jest.fn(async () =>
        Array.from({ length: 31 }, (_, i) => ({
          userId: `u${i}`,
          status: 'MEMBER',
          joinedAt,
          user: { id: `u${i}`, username: `u${i}`, displayName: `U${i}`, avatar: null },
        })),
      );
      const res = await service.getAttendees('act-1', 'user-same', 30);
      expect(res.attendees).toHaveLength(30);
      expect(res.hasMore).toBe(true);
      // joinedAt alone is not unique, so the cursor carries the userId too.
      expect(res.nextCursor).toBe(`${joinedAt.toISOString()}|u29`);
    });
  });

  describe('host-only management', () => {
    it('hides invitation status from a non-host', async () => {
      activityRow = baseActivity('PUBLIC');
      await expect(service.getInvitationStatuses('act-1', 'user-other')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a visibility change from a non-host', async () => {
      activityRow = baseActivity('PUBLIC');
      await expect(service.updateActivityVisibility('act-1', 'user-other', 'PRIVATE')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.crewActivity.update).not.toHaveBeenCalled();
    });

    it('rejects an unknown visibility value', async () => {
      activityRow = baseActivity('PUBLIC');
      await expect(service.updateActivityVisibility('act-1', 'host-1', 'EVERYONE')).rejects.toThrow();
    });

    it('applies a host visibility change and announces it for cache/socket eviction', async () => {
      activityRow = baseActivity('PUBLIC');
      const res = await service.updateActivityVisibility('act-1', 'host-1', 'COLLEGE_ONLY');
      expect(res).toMatchObject({ success: true, visibility: 'COLLEGE_ONLY', shareToCampus: true });
    });
  });

  describe('discovery filters reach the database', () => {
    it('applies the policy where-clause to the feed query rather than filtering in memory', async () => {
      prisma.crewActivity.findMany = jest.fn(async () => []);
      await service.getAllActivities('user-other', 20, undefined, 'public');
      const where = prisma.crewActivity.findMany.mock.calls[0][0].where;
      expect(JSON.stringify(where)).not.toContain('"PRIVATE"');
      expect(JSON.stringify(where)).toContain('COLLEGE_ONLY');
      expect(JSON.stringify(where)).toContain(OTHER);
    });

    it('builds a shareable page from college-derived clauses only', async () => {
      // No blocks and no live invitations → this page is eligible for the cache
      // shared across the viewer's college, so it must not be built from any
      // clause keyed to this individual user.
      prisma.crewActivity.findMany = jest.fn(async () => []);
      await service.getAllActivities('user-other', 20, undefined, 'public');
      const where = JSON.stringify(prisma.crewActivity.findMany.mock.calls[0][0].where);
      expect(where).not.toContain('user-other');
      expect(where).not.toContain('invitations');
      expect(where).not.toContain('members');
    });

    it('uses the full personal policy for a viewer holding a live invitation', async () => {
      prisma.activityInvitation.count.mockResolvedValueOnce(1);
      prisma.crewActivity.findMany = jest.fn(async () => []);
      await service.getAllActivities('user-other', 20, undefined, 'public');
      const where = JSON.stringify(prisma.crewActivity.findMany.mock.calls[0][0].where);
      expect(where).toContain('invitations');
      expect(where).toContain('user-other');
      expect(where).not.toContain('"PRIVATE"');
    });

    it('restricts the college scope to the viewer’s own college', async () => {
      prisma.crewActivity.findMany = jest.fn(async () => []);
      await service.getAllActivities('user-same', 20, undefined, 'college');
      const where = JSON.stringify(prisma.crewActivity.findMany.mock.calls[0][0].where);
      expect(where).toContain(GLA);
      expect(where).not.toContain(OTHER);
      // "Anyone" activities from that college are eligible in the college scope.
      expect(where).toContain('PUBLIC');
    });

    it('returns nothing in the college scope for a viewer with no college', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ id: 'user-nc', collegeId: null });
      prisma.crewActivity.findMany = jest.fn(async () => []);
      const res = await service.getAllActivities('user-nc', 20, undefined, 'college');
      expect(res).toEqual({ activities: [], nextCursor: undefined });
      expect(prisma.crewActivity.findMany).not.toHaveBeenCalled();
    });
  });
});
