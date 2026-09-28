import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ActivitiesService } from './activities.service';
import { ActivityAuthorizationService } from './activity-authorization.service';
import { ActivityDiscussionService } from './discussion/activity-discussion.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { BlocksService } from '../users/blocks.service';
import { createBlocksServiceMock } from '../users/testing/blocks.service.mock';
import { DomainEventService } from '../events/domain-event.service';
import { RedisService } from '../redis/redis.service';
import { getQueueToken } from '@nestjs/bullmq';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor';
import { studentYearPolicyMockProvider } from '../common/student-year/testing/student-year-policy.mock';

/**
 * Endpoint-level enforcement: the same matrix as the policy spec, but driven
 * through the service methods a real request would hit, so a route that forgets
 * to consult the policy fails here.
 */
type InvitationRow = {
  inviteeId: string;
  status: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
};
type MemberRow = {
  userId: string;
  status: string;
  user?: Record<string, unknown>;
};

/** The activity row the fake serves; see `baseActivity`. */
type ActivityRow = {
  id: string;
  creatorId: string;
  collegeId: string;
  visibility: string;
  status: string;
  deletedAt: Date | null;
  members: MemberRow[];
  invitations: InvitationRow[];
  _count: { members: number };
  [column: string]: unknown;
};

type ActivityFindManyArgs = { where?: Prisma.CrewActivityWhereInput };
type MemberFindManyArgs = { where?: Prisma.CrewActivityMemberWhereInput };

type FindUniqueArgs = {
  where?: { id?: string; creatorId?: string };
  include?: {
    invitations?: { where?: { inviteeId?: string } };
    members?: {
      where?: { userId?: string };
      include?: { user?: { select?: Record<string, unknown> } };
    };
  };
};

/**
 * The PrismaService slice these tests drive. Members marked optional are
 * installed by individual tests; the mocks whose calls are inspected carry
 * Prisma's own argument types.
 */
type PrismaFake = {
  crewActivity: {
    findUnique: jest.Mock<Promise<ActivityRow | null>, [FindUniqueArgs]>;
    findFirst: jest.Mock;
    update: jest.Mock;
    findMany?: jest.Mock<Promise<unknown[]>, [ActivityFindManyArgs]>;
  };
  crewActivityMember: {
    findUnique: jest.Mock;
    findMany: jest.Mock<Promise<unknown[]>, [MemberFindManyArgs]>;
  };
  user: { findUnique: jest.Mock };
  activityInvitation: { count: jest.Mock; findMany: jest.Mock };
  activityDiscussionMessage: { findMany: jest.Mock; create: jest.Mock };
  $queryRaw: jest.Mock<Promise<unknown>, [TemplateStringsArray, ...unknown[]]>;
};

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
  let prisma: PrismaFake;
  /** Users the viewer is blocked with, per test. */
  let blockedIds: string[];
  let activityRow: ActivityRow | null;

  const baseActivity = (
    visibility: string,
    invitations: InvitationRow[] = [],
    members: MemberRow[] = [],
  ) => ({
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
    creator: {
      id: 'host-1',
      username: 'host',
      displayName: 'Host',
      avatar: null,
    },
    _count: { members: members.length || 1 },
  });

  beforeEach(async () => {
    activityRow = baseActivity('PUBLIC');

    prisma = {
      crewActivity: {
        findUnique: jest.fn(({ include, where }: FindUniqueArgs) => {
          if (!activityRow) return Promise.resolve(null);
          if (where?.creatorId && where.creatorId !== activityRow.creatorId)
            return Promise.resolve(null);
          // Emulate Prisma's per-relation `where` filtering for the caller's own rows.
          const row = { ...activityRow };
          const inviteeFilter = include?.invitations?.where?.inviteeId;
          if (inviteeFilter !== undefined) {
            row.invitations = row.invitations.filter(
              (i) => i.inviteeId === inviteeFilter,
            );
          }
          const memberFilter = include?.members?.where?.userId;
          if (memberFilter !== undefined) {
            row.members = row.members.filter((m) => m.userId === memberFilter);
          }
          // Like the database, return only the user columns the query selects.
          const userSelect = include?.members?.include?.user?.select;
          if (userSelect) {
            row.members = row.members.map((m) =>
              m.user
                ? {
                    ...m,
                    user: Object.fromEntries(
                      Object.entries(m.user).filter(([k]) => k in userSelect),
                    ),
                  }
                : m,
            );
          }
          return Promise.resolve(row);
        }),
        findFirst: jest.fn(() => Promise.resolve(activityRow)),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'act-1', ...data }),
        ),
      },
      crewActivityMember: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        findMany: jest.fn((_args: MemberFindManyArgs) => Promise.resolve([])),
      },
      user: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(USERS[where.id] ?? null),
        ),
      },
      activityInvitation: {
        count: jest.fn(() => Promise.resolve(0)),
        findMany: jest.fn(() => Promise.resolve([])),
      },
      activityDiscussionMessage: {
        findMany: jest.fn(() => Promise.resolve([])),
        create: jest.fn(({ data }: { data: { userId: string } }) =>
          Promise.resolve({
            id: 'msg-1',
            ...data,
            createdAt: new Date(),
            user: {
              id: data.userId,
              username: 'u',
              displayName: 'U',
              avatar: null,
            },
          }),
        ),
      },
      $queryRaw: jest.fn<
        Promise<unknown>,
        [TemplateStringsArray, ...unknown[]]
      >(() => Promise.resolve([{ inserted: true }])),
    };

    blockedIds = [];

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        studentYearPolicyMockProvider(),
        ActivitiesService,
        ActivityDiscussionService,
        ActivityAuthorizationService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: NotificationsService,
          useValue: {
            createNotification: jest.fn(),
            cancelNotificationByCriteria: jest.fn(),
            updateNotificationLifecycleStatus: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: NotificationFactory,
          useValue: { createActivityJoin: jest.fn() },
        },
        {
          provide: BlocksService,
          useValue: {
            ...createBlocksServiceMock(),
            // Driven by the per-test `blockedIds` holder rather than fixed rows.
            getExcludedUserIds: jest.fn(() => Promise.resolve(blockedIds)),
            filterBlockedUsers: jest.fn((_u: string, ids: string[]) =>
              Promise.resolve(ids.filter((id) => !blockedIds.includes(id))),
            ),
            injectBlockFilter: jest.fn(
              (_u: string, where: { AND?: unknown }, field = 'id') => {
                if (blockedIds.length === 0) return Promise.resolve(where);
                const existing = where.AND;
                const and: unknown[] = Array.isArray(existing)
                  ? [...(existing as unknown[])]
                  : existing
                    ? [existing]
                    : [];
                and.push({ [field]: { notIn: blockedIds } });
                return Promise.resolve({ ...where, AND: and });
              },
            ),
          },
        },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        { provide: RedisService, useValue: { getClient: () => null } },
        {
          provide: getQueueToken(NOTIFICATIONS_QUEUE),
          useValue: { add: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(ActivitiesService);
    discussion = module.get(ActivityDiscussionService);
  });

  const expectDenied = async (fn: () => Promise<unknown>, code: string) => {
    await expect(fn()).rejects.toBeInstanceOf(ForbiddenException);
    try {
      await fn();
    } catch (err: unknown) {
      const body = (err as HttpException).getResponse() as { code?: string };
      expect(body.code).toBe(code);
      // No restricted detail may ride along on the denial.
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('Secret rooftop dinner');
      expect(serialized).not.toContain('Rooftop, Block C');
      expect(serialized).not.toContain('host-1');
    }
  };

  describe('GET /api/activities/:id — attendees embedded in the detail (A15)', () => {
    const attendee = (id: string, lifecycle: Record<string, unknown>) => ({
      userId: id,
      status: 'MEMBER',
      user: {
        id,
        username: `real-${id}`,
        displayName: `Real Name ${id}`,
        avatar: `avatars/${id}.jpg`,
        isCampusRep: true,
        collegeId: GLA,
        college: { id: GLA, name: 'GLA' },
        ...lifecycle,
      },
    });

    it.each([
      ['DELETED', { accountStatus: 'DELETED', deletedAt: new Date() }],
      [
        'PENDING_DELETION',
        { accountStatus: 'PENDING_DELETION', deletedAt: null },
      ],
    ])(
      'shows a %s attendee as the tombstone, not their identity',
      async (_s, lifecycle) => {
        activityRow = baseActivity(
          'PUBLIC',
          [],
          [
            attendee('live', { accountStatus: 'ACTIVE', deletedAt: null }),
            attendee('gone', lifecycle),
          ],
        );

        const detail = (await service.getActivityById(
          'act-1',
          'user-same',
        )) as {
          members: { userId: string; user: Record<string, unknown> }[];
        };
        const shown = Object.fromEntries(
          detail.members.map((m) => [m.userId, m.user]),
        );

        expect(shown.live.displayName).toBe('Real Name live');
        expect(shown.gone.displayName).toBe('Deleted User');
        expect(shown.gone.avatar).toBeNull();
        expect(JSON.stringify(shown.gone)).not.toContain('real-gone');
      },
    );
  });

  describe('GET /api/activities/:id — blocked host', () => {
    it('404s for a non-attendee who has blocked the host', async () => {
      activityRow = baseActivity('PUBLIC');
      blockedIds = ['host-1'];
      await expect(
        service.getActivityById('act-1', 'user-other'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    /**
     * Attendance no longer earns an exception.
     *
     * This used to serve an attendee who had blocked the host the essentials —
     * when, where, what — with the host's identity withheld, so that blocking a
     * host did not cost you an event you were actually going to. The product
     * rule is now that a block means neither party sees the other's activities
     * at all, and the refusal is the ordinary "not found" so it cannot be told
     * apart from a deleted event.
     *
     * The membership row is untouched, so unblocking restores the event.
     */
    it('404s for an attendee who has blocked the host', async () => {
      activityRow = baseActivity('PUBLIC');
      blockedIds = ['host-1'];
      prisma.crewActivityMember.findUnique = jest.fn(() =>
        Promise.resolve({
          userId: 'user-other',
          status: 'MEMBER',
        }),
      );

      await expect(
        service.getActivityById('act-1', 'user-other'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('answers an attendee and a non-attendee identically', async () => {
      activityRow = baseActivity('PUBLIC');
      blockedIds = ['host-1'];

      prisma.crewActivityMember.findUnique = jest.fn(() =>
        Promise.resolve(null),
      );
      const nonAttendee = await service
        .getActivityById('act-1', 'user-other')
        .catch((e: unknown) => e);

      prisma.crewActivityMember.findUnique = jest.fn(() =>
        Promise.resolve({
          userId: 'user-other',
          status: 'MEMBER',
        }),
      );
      const attendee = await service
        .getActivityById('act-1', 'user-other')
        .catch((e: unknown) => e);

      // Differing answers would make attendance detectable from outside.
      expect((attendee as HttpException).message).toBe(
        (nonAttendee as HttpException).message,
      );
      expect((attendee as HttpException).getStatus()).toBe(
        (nonAttendee as HttpException).getStatus(),
      );
    });

    it('leaves the host visible when there is no block', async () => {
      activityRow = baseActivity('PUBLIC');
      prisma.crewActivityMember.findUnique = jest.fn(() =>
        Promise.resolve({
          userId: 'user-other',
          status: 'MEMBER',
        }),
      );

      const res: Record<string, unknown> = await service.getActivityById(
        'act-1',
        'user-other',
      );

      expect(res.creatorId).toBe('host-1');
      expect(res.hostUnavailable).toBeUndefined();
    });
  });

  describe('GET /api/activities/:id', () => {
    it('returns an Anyone activity to a viewer from another college', async () => {
      activityRow = baseActivity('PUBLIC');
      const res = await service.getActivityById('act-1', 'user-other');
      expect(res.title).toBe('Secret rooftop dinner');
    });

    it('denies a College activity to another college, with no details', async () => {
      activityRow = baseActivity('COLLEGE_ONLY');
      await expectDenied(
        () => service.getActivityById('act-1', 'user-other'),
        'COLLEGE_RESTRICTED',
      );
    });

    it('serves a College activity to the same college', async () => {
      activityRow = baseActivity('COLLEGE_ONLY');
      await expect(
        service.getActivityById('act-1', 'user-same'),
      ).resolves.toMatchObject({ id: 'act-1' });
    });

    it('serves a College activity to an invited outsider', async () => {
      activityRow = baseActivity('COLLEGE_ONLY', [
        {
          inviteeId: 'user-other',
          status: 'PENDING',
          revokedAt: null,
          expiresAt: null,
        },
      ]);
      await expect(
        service.getActivityById('act-1', 'user-other'),
      ).resolves.toMatchObject({ isInvited: true });
    });

    it('denies a College activity once the invitation is revoked', async () => {
      activityRow = baseActivity('COLLEGE_ONLY', [
        {
          inviteeId: 'user-other',
          status: 'PENDING',
          revokedAt: new Date(),
          expiresAt: null,
        },
      ]);
      await expectDenied(
        () => service.getActivityById('act-1', 'user-other'),
        'COLLEGE_RESTRICTED',
      );
    });

    it('404s a Private activity for an uninvited same-college viewer', async () => {
      activityRow = baseActivity('PRIVATE');
      // Existence itself is restricted, so the denial is indistinguishable
      // from a bad id — no code, no copy, no details.
      await expect(
        service.getActivityById('act-1', 'user-same'),
      ).rejects.toBeInstanceOf(NotFoundException);
      try {
        await service.getActivityById('act-1', 'user-same');
      } catch (err: unknown) {
        const serialized = JSON.stringify((err as HttpException).getResponse());
        expect(serialized).not.toContain('Secret rooftop dinner');
        expect(serialized).not.toContain('PRIVATE');
      }
    });

    it('gives the host full access to a Private activity', async () => {
      activityRow = baseActivity('PRIVATE');
      await expect(
        service.getActivityById('act-1', 'host-1'),
      ).resolves.toMatchObject({ id: 'act-1' });
    });

    it('never returns another user’s invitation rows', async () => {
      activityRow = baseActivity('PUBLIC', [
        {
          inviteeId: 'user-same',
          status: 'PENDING',
          revokedAt: null,
          expiresAt: null,
        },
      ]);
      const res: Record<string, unknown> = await service.getActivityById(
        'act-1',
        'user-other',
      );
      expect(res.invitations).toBeUndefined();
    });
  });

  describe('POST /api/activities/:id/join', () => {
    it('rejects a direct API join on a College activity from another college', async () => {
      activityRow = baseActivity('COLLEGE_ONLY');
      await expect(
        service.joinActivity('act-1', 'user-other'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('rejects a direct API join on a Private activity without confirming it exists', async () => {
      activityRow = baseActivity('PRIVATE');
      await expect(
        service.joinActivity('act-1', 'user-same'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('allows an invited outsider to join a Private activity', async () => {
      activityRow = baseActivity('PRIVATE', [
        {
          inviteeId: 'user-other',
          status: 'PENDING',
          revokedAt: null,
          expiresAt: null,
        },
      ]);
      await expect(
        service.joinActivity('act-1', 'user-other'),
      ).resolves.toEqual({ success: true });
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it('rejects an expired invitation', async () => {
      activityRow = baseActivity('PRIVATE', [
        {
          inviteeId: 'user-other',
          status: 'PENDING',
          revokedAt: null,
          expiresAt: new Date(Date.now() - 1000),
        },
      ]);
      // An expired invitation leaves the caller in the same position as someone
      // who was never invited, so they get the same 404.
      await expect(
        service.joinActivity('act-1', 'user-other'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets anyone join an Anyone activity, and is idempotent under repeats', async () => {
      activityRow = baseActivity('PUBLIC');
      await expect(
        service.joinActivity('act-1', 'user-other'),
      ).resolves.toEqual({ success: true });
      // The insert is an ON CONFLICT upsert, so a rapid repeat is a no-op rather
      // than a duplicate attendance row.
      prisma.$queryRaw.mockResolvedValueOnce([{ inserted: false }]);
      await expect(
        service.joinActivity('act-1', 'user-other'),
      ).resolves.toEqual({ success: true });
      const sql = String(prisma.$queryRaw.mock.calls[0][0].join(' '));
      expect(sql).toContain('ON CONFLICT');
    });

    it('rejects join when capacity is exceeded concurrently (0 rows returned by atomic query)', async () => {
      activityRow = baseActivity('PUBLIC');
      prisma.$queryRaw.mockResolvedValueOnce([]);
      await expect(service.joinActivity('act-1', 'user-other')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('POST /api/activities/:id/bookmark', () => {
    it('refuses to bookmark an activity the user may not view', async () => {
      activityRow = baseActivity('COLLEGE_ONLY');
      await expect(
        service.bookmarkActivity('act-1', 'user-other'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('activity discussion', () => {
    it('refuses to read the discussion of a private activity', async () => {
      activityRow = baseActivity('PRIVATE');
      prisma.crewActivity.findFirst.mockImplementation(() =>
        Promise.resolve(activityRow),
      );
      // Private denials are 404s everywhere the policy is applied, not just on
      // the detail endpoint — the discussion must not disclose what the detail
      // endpoint withholds.
      await expect(
        discussion.getMessages('act-1', 'user-other'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.activityDiscussionMessage.findMany).not.toHaveBeenCalled();
    });

    it('refuses to read the discussion of a college-restricted activity', async () => {
      activityRow = baseActivity('COLLEGE_ONLY');
      prisma.crewActivity.findFirst.mockImplementation(() =>
        Promise.resolve(activityRow),
      );
      await expect(
        discussion.getMessages('act-1', 'user-other'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.activityDiscussionMessage.findMany).not.toHaveBeenCalled();
    });

    it('refuses to post into the discussion of a restricted activity', async () => {
      activityRow = baseActivity('COLLEGE_ONLY');
      prisma.crewActivity.findFirst.mockImplementation(() =>
        Promise.resolve(activityRow),
      );
      await expect(
        discussion.sendMessage('act-1', 'user-other', 'hello'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.activityDiscussionMessage.create).not.toHaveBeenCalled();
    });

    it('allows a same-college member to read and post', async () => {
      activityRow = baseActivity('COLLEGE_ONLY');
      prisma.crewActivity.findFirst.mockImplementation(() =>
        Promise.resolve(activityRow),
      );
      await expect(
        discussion.getMessages('act-1', 'user-same'),
      ).resolves.toMatchObject({ messages: [] });
      await expect(
        discussion.sendMessage('act-1', 'user-same', 'hi'),
      ).resolves.toMatchObject({ text: 'hi' });
    });
  });

  describe('attendees', () => {
    it('lets a member beyond the embedded attendee page still open the activity', async () => {
      // The detail payload caps `members`; membership must be resolved by
      // primary key, not by scanning that capped slice, or a member who joined
      // late would be locked out of their own college-restricted activity.
      activityRow = baseActivity('COLLEGE_ONLY');
      prisma.crewActivityMember.findUnique = jest.fn(() =>
        Promise.resolve({
          userId: 'user-other',
          status: 'MEMBER',
        }),
      );
      await expect(
        service.getActivityById('act-1', 'user-other'),
      ).resolves.toMatchObject({ id: 'act-1' });
    });

    it('reports the authoritative attendee count alongside the capped page', async () => {
      activityRow = baseActivity('PUBLIC', [], []);
      activityRow._count = { members: 412 };
      const res: Record<string, unknown> = await service.getActivityById(
        'act-1',
        'user-same',
      );
      expect(res.memberCount).toBe(412);
      expect(res._count).toBeUndefined();
    });

    it('refuses the attendee list to an unauthorized viewer', async () => {
      activityRow = baseActivity('COLLEGE_ONLY');
      prisma.crewActivityMember.findMany = jest.fn(
        (_args: MemberFindManyArgs) => Promise.resolve([]),
      );
      await expect(
        service.getAttendees('act-1', 'user-other'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.crewActivityMember.findMany).not.toHaveBeenCalled();
    });

    it('pages attendees with a compound cursor', async () => {
      activityRow = baseActivity('PUBLIC');
      const joinedAt = new Date();
      prisma.crewActivityMember.findMany = jest.fn(
        (_args: MemberFindManyArgs) =>
          Promise.resolve(
            Array.from({ length: 31 }, (_, i) => ({
              userId: `u${i}`,
              status: 'MEMBER',
              joinedAt,
              user: {
                id: `u${i}`,
                username: `u${i}`,
                displayName: `U${i}`,
                avatar: null,
              },
            })),
          ),
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
      await expect(
        service.getInvitationStatuses('act-1', 'user-other'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a visibility change from a non-host', async () => {
      activityRow = baseActivity('PUBLIC');
      await expect(
        service.updateActivityVisibility('act-1', 'user-other', 'PRIVATE'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.crewActivity.update).not.toHaveBeenCalled();
    });

    it('rejects an unknown visibility value', async () => {
      activityRow = baseActivity('PUBLIC');
      await expect(
        service.updateActivityVisibility('act-1', 'host-1', 'EVERYONE'),
      ).rejects.toThrow();
    });

    it('applies a host visibility change and announces it for cache/socket eviction', async () => {
      activityRow = baseActivity('PUBLIC');
      const res = await service.updateActivityVisibility(
        'act-1',
        'host-1',
        'COLLEGE_ONLY',
      );
      expect(res).toMatchObject({
        success: true,
        visibility: 'COLLEGE_ONLY',
        shareToCampus: true,
      });
    });
  });

  describe('discovery filters reach the database', () => {
    it('applies the policy where-clause to the feed query rather than filtering in memory', async () => {
      prisma.crewActivity.findMany = jest.fn((_args: ActivityFindManyArgs) =>
        Promise.resolve([]),
      );
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
      prisma.crewActivity.findMany = jest.fn((_args: ActivityFindManyArgs) =>
        Promise.resolve([]),
      );
      await service.getAllActivities('user-other', 20, undefined, 'public');
      const where = JSON.stringify(
        prisma.crewActivity.findMany.mock.calls[0][0].where,
      );
      expect(where).not.toContain('user-other');
      expect(where).not.toContain('invitations');
      expect(where).not.toContain('members');
    });

    it('uses the full personal policy for a viewer holding a live invitation', async () => {
      prisma.activityInvitation.count.mockResolvedValueOnce(1);
      prisma.crewActivity.findMany = jest.fn((_args: ActivityFindManyArgs) =>
        Promise.resolve([]),
      );
      await service.getAllActivities('user-other', 20, undefined, 'public');
      const where = JSON.stringify(
        prisma.crewActivity.findMany.mock.calls[0][0].where,
      );
      expect(where).toContain('invitations');
      expect(where).toContain('user-other');
      expect(where).not.toContain('"PRIVATE"');
    });

    it('restricts the college scope to the viewer’s own college', async () => {
      prisma.crewActivity.findMany = jest.fn((_args: ActivityFindManyArgs) =>
        Promise.resolve([]),
      );
      await service.getAllActivities('user-same', 20, undefined, 'college');
      const where = JSON.stringify(
        prisma.crewActivity.findMany.mock.calls[0][0].where,
      );
      expect(where).toContain(GLA);
      expect(where).not.toContain(OTHER);
      // "Anyone" activities from that college are eligible in the college scope.
      expect(where).toContain('PUBLIC');
    });

    it('returns nothing in the college scope for a viewer with no college', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-nc',
        collegeId: null,
      });
      prisma.crewActivity.findMany = jest.fn((_args: ActivityFindManyArgs) =>
        Promise.resolve([]),
      );
      const res = await service.getAllActivities(
        'user-nc',
        20,
        undefined,
        'college',
      );
      expect(res).toEqual({ activities: [], nextCursor: undefined });
      expect(prisma.crewActivity.findMany).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/activities/:id/attendees — block filtering', () => {
    const memberWhere = () =>
      prisma.crewActivityMember.findMany.mock.calls[0]?.[0]?.where ?? {};

    beforeEach(() => {
      activityRow = baseActivity('PUBLIC');
      prisma.crewActivityMember.findUnique = jest.fn(() =>
        Promise.resolve({
          userId: 'user-other',
          status: 'MEMBER',
        }),
      );
      prisma.crewActivityMember.findMany = jest.fn(
        (_args: MemberFindManyArgs) => Promise.resolve([]),
      );
    });

    it('excludes blocked attendees in the query, not after the fact', async () => {
      blockedIds = ['blocked-guest'];

      await service.getAttendees('act-1', 'user-other');

      // Filtering after the query would return short pages and a cursor that
      // skips, so the exclusion has to be in the where clause.
      expect(JSON.stringify(memberWhere())).toContain('blocked-guest');
      expect(JSON.stringify(memberWhere())).toContain('notIn');
    });

    it('does not filter the list for the host', async () => {
      blockedIds = ['blocked-guest'];

      // host-1 is the creator of baseActivity: they must keep a complete guest
      // list even when two of their guests have blocked each other.
      await service.getAttendees('act-1', 'host-1');

      expect(JSON.stringify(memberWhere())).not.toContain('notIn');
    });

    it('adds no exclusion when the viewer has blocked nobody', async () => {
      blockedIds = [];

      await service.getAttendees('act-1', 'user-other');

      expect(JSON.stringify(memberWhere())).not.toContain('notIn');
    });
  });
});
