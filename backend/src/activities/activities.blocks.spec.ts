import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { ActivitiesService } from './activities.service';
import { ActivityAuthorizationService } from './activity-authorization.service';
import { ActivityDiscussionService } from './discussion/activity-discussion.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { BlocksService } from '../users/blocks.service';
import { DomainEventService } from '../events/domain-event.service';
import { RedisService } from '../redis/redis.service';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor';

/**
 * A block between a user and an activity's host closes the activity to them
 * (join, attendee list, save, accept an invitation, discussion), answered like
 * a missing activity so the block is not disclosed.
 */
describe('Activities — blocks (H-21) and card presentation (M-19)', () => {
  const HOST = 'host';
  const ME = 'me';
  let blockedWithHost: boolean;
  let service: ActivitiesService;
  let discussion: ActivityDiscussionService;
  let prisma: ReturnType<typeof makePrisma>;
  let injectCalls: Array<{ where: unknown; field?: string }>;

  const activity = {
    id: 'act-1',
    creatorId: HOST,
    collegeId: null,
    visibility: 'PUBLIC',
    status: 'OPEN',
    deletedAt: null,
    startDate: new Date(Date.now() + 86_400_000),
    participationType: 'OPEN',
    maxMembers: null,
    hostCollege: null,
    members: [],
    invitations: [],
    _count: { members: 1 },
  };

  const makePrisma = () => ({
    crewActivity: {
      findUnique: jest.fn(() => Promise.resolve(activity)),
      findFirst: jest.fn(() => Promise.resolve(activity)),
      findMany: jest.fn(() => Promise.resolve([])),
    },
    crewActivityMember: {
      findUnique: jest.fn(() => Promise.resolve(null)),
      findMany: jest.fn(() => Promise.resolve([])),
    },
    user: {
      findUnique: jest.fn(() =>
        Promise.resolve({ id: ME, collegeAffiliation: null }),
      ),
    },
    activityBookmark: {
      upsert: jest.fn(() => Promise.resolve({})),
      findMany: jest.fn(),
      findFirst: jest.fn(() => Promise.resolve(null)),
    },
    activityInvitation: {
      findUnique: jest.fn(),
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      count: jest.fn(() => Promise.resolve(0)),
    },
    activityDiscussionMessage: {
      findMany: jest.fn(() => Promise.resolve([])),
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    $queryRaw: jest.fn(() => Promise.resolve([{ inserted: true }])),
  });

  beforeEach(async () => {
    blockedWithHost = true;
    injectCalls = [];
    prisma = makePrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        ActivityDiscussionService,
        ActivityAuthorizationService,
        NotificationFactory,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: {} },
        {
          provide: BlocksService,
          useValue: {
            getExcludedUserIds: jest.fn(() => Promise.resolve([])),
            isBlocked: jest.fn((_a: string, b: string) =>
              Promise.resolve(blockedWithHost && b === HOST),
            ),
            injectBlockFilter: jest.fn(
              (_u: string, where: unknown, field?: string) => {
                injectCalls.push({ where, field });
                return Promise.resolve(where);
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

  it('refuses to join an activity hosted by someone blocked', async () => {
    await expect(service.joinActivity('act-1', ME)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('refuses the attendee list', async () => {
    await expect(service.getAttendees('act-1', ME)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses to save the activity', async () => {
    await expect(service.bookmarkActivity('act-1', ME)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.activityBookmark.upsert).not.toHaveBeenCalled();
  });

  it('refuses to accept an invitation to it, without touching the invitation', async () => {
    prisma.activityInvitation.findUnique.mockResolvedValue({
      id: 'inv-1',
      inviteeId: ME,
      inviterId: 'x',
      activityId: 'act-1',
      status: 'PENDING',
      revokedAt: null,
      expiresAt: null,
      respondedAt: null,
      activity,
    });
    await expect(service.acceptInvitation('inv-1', ME)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.activityInvitation.updateMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('refuses the discussion (read and write) when blocked with the host', async () => {
    await expect(discussion.getMessages('act-1', ME)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      discussion.sendMessage('act-1', ME, 'hello'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.activityDiscussionMessage.create).not.toHaveBeenCalled();
  });

  it('filters blocked authors out of the discussion in the query', async () => {
    blockedWithHost = false;
    await discussion.getMessages('act-1', ME);
    expect(injectCalls).toHaveLength(1);
    expect(injectCalls[0].field).toBe('userId');
    expect(injectCalls[0].where).toMatchObject({ activityId: 'act-1' });
  });

  it('lists only real members in a saved activity’s avatar stack', async () => {
    blockedWithHost = false;
    prisma.activityBookmark.findMany.mockResolvedValue([]);
    await service.getSavedActivities(ME, 5);
    const args = prisma.activityBookmark.findMany.mock.calls[0] as unknown as [
      { include: { activity: { include: { members: { where: unknown } } } } },
    ];
    expect(args[0].include.activity.include.members.where).toEqual({
      status: 'MEMBER',
    });
  });

  it('saved activities: pages join with no bookmark lost', async () => {
    blockedWithHost = false;
    const all = Array.from({ length: 5 }, (_, i) => ({
      activityId: `a${5 - i}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 5 - i)),
      activity: {
        id: `a${5 - i}`,
        creatorId: HOST,
        members: [],
        _count: { members: 0 },
      },
    }));
    prisma.activityBookmark.findFirst.mockImplementation(((args: {
      where: { activityId: string };
    }) =>
      Promise.resolve(
        all.find((b) => b.activityId === args.where.activityId) ?? null,
      )) as never);
    prisma.activityBookmark.findMany.mockImplementation(((args: {
      take: number;
      where: { createdAt?: { lt: Date } };
    }) =>
      Promise.resolve(
        all
          .filter(
            (b) =>
              !args.where.createdAt ||
              b.createdAt.getTime() < args.where.createdAt.lt.getTime(),
          )
          .slice(0, args.take),
      )) as never);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const res = await service.getSavedActivities(ME, 2, cursor);
      seen.push(...res.activities.map((a) => a.id));
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }
    expect(seen).toEqual(all.map((b) => b.activityId));
  });

  it('my activities: a deleted member is shown as the tombstone', async () => {
    blockedWithHost = false;
    prisma.crewActivity.findMany.mockResolvedValue([
      {
        id: 'act-1',
        creatorId: ME,
        _count: { members: 1 },
        members: [
          {
            userId: 'gone',
            status: 'MEMBER',
            user: {
              id: 'gone',
              username: 'realname',
              displayName: 'Real Name',
              avatar: 'avatars/real.jpg',
              accountStatus: 'PENDING_DELETION',
              deletedAt: new Date(),
            },
          },
        ],
      },
    ] as never);
    const out = await service.getMyActivities(ME);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('Real Name');
    expect(serialized).not.toContain('realname');
    expect(serialized).not.toContain('avatars/real.jpg');
  });

  it('feed: the cursor is the last activity returned, not the look-ahead row', async () => {
    blockedWithHost = false;
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `f${3 - i}`,
      creatorId: HOST,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 3 - i)),
      members: [],
    }));
    prisma.crewActivity.findMany.mockResolvedValue(rows as never);
    const res = await service.getAllActivities(ME, 2);
    expect(res.activities.map((a) => a.id)).toEqual(['f3', 'f2']);
    expect(res.nextCursor).toBe(`${rows[1].createdAt.toISOString()}|f2`);
  });
});
