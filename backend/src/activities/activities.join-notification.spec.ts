import { Test, TestingModule } from '@nestjs/testing';
import { ActivitiesService } from './activities.service';
import { ActivityAuthorizationService } from './activity-authorization.service';
import { ActivityDiscussionService } from './discussion/activity-discussion.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotificationFactory,
  type CreateNotificationDto,
} from '../notifications/notification.factory';
import { BlocksService } from '../users/blocks.service';
import { DomainEventService } from '../events/domain-event.service';
import { RedisService } from '../redis/redis.service';
import { getQueueToken } from '@nestjs/bullmq';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor';
import { studentYearPolicyMockProvider } from '../common/student-year/testing/student-year-policy.mock';

/**
 * Joining an activity is direct — there is no approval queue — and the host is
 * told about it. These cover the delivery contract: exactly once per real
 * membership transition, never to yourself, and carrying enough for the card to
 * render without a second fetch.
 */
describe('Activity join → host notification', () => {
  const COLLEGE = 'college-gla';
  const HOST = 'host-1';
  const JOINER = 'user-2';

  /** The activity row the join path reads. */
  type ActivityRow = {
    id: string;
    creatorId: string;
    collegeId: string;
    visibility: string;
    status: string;
    deletedAt: Date | null;
    startDate: Date;
    title: string;
    coverImage: string | null;
    coverColor: string | null;
    maxMembers: number | null;
    participationType: string;
    members: unknown[];
    invitations: unknown[];
    _count: { members: number };
  };

  let service: ActivitiesService;
  let prisma: ReturnType<typeof makePrisma>;
  let notifications: {
    createNotification: jest.Mock<Promise<unknown>, [CreateNotificationDto]>;
  };
  let factory: NotificationFactory;
  let activityRow: ActivityRow;

  // Lets the assertions run after the setImmediate the join schedules its
  // notification on, without coupling them to a timer.
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  const makePrisma = () => ({
    crewActivity: {
      findUnique: jest.fn(() => Promise.resolve(activityRow)),
      findFirst: jest.fn(() => Promise.resolve(activityRow)),
    },
    crewActivityMember: {
      findUnique: jest.fn(() => Promise.resolve(null)),
      findMany: jest.fn(() => Promise.resolve([])),
      deleteMany: jest.fn(() => Promise.resolve({ count: 1 })),
    },
    user: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({
          id: where.id,
          collegeId: COLLEGE,
          username: where.id === JOINER ? 'ananya' : 'host',
          displayName: where.id === JOINER ? 'Ananya S' : 'Host',
          avatar: 'avatars/ananya.webp',
        }),
      ),
    },
    activityInvitation: {
      count: jest.fn(() => Promise.resolve(0)),
      findMany: jest.fn(() => Promise.resolve([])),
    },
    // xmax = 0 → the row was genuinely INSERTed, i.e. a real join.
    $queryRaw: jest.fn(() => Promise.resolve([{ inserted: true }])),
  });

  beforeEach(async () => {
    activityRow = {
      id: 'act-1',
      creatorId: HOST,
      collegeId: COLLEGE,
      visibility: 'PUBLIC',
      status: 'OPEN',
      deletedAt: null,
      startDate: new Date(Date.now() + 86_400_000),
      title: 'Sunset badminton',
      coverImage: 'activities/cover.webp',
      coverColor: null,
      maxMembers: null,
      participationType: 'OPEN',
      members: [],
      invitations: [],
      _count: { members: 1 },
    };

    prisma = makePrisma();

    notifications = {
      createNotification: jest.fn<Promise<unknown>, [CreateNotificationDto]>(
        () => Promise.resolve({}),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        studentYearPolicyMockProvider(),
        ActivitiesService,
        ActivityDiscussionService,
        ActivityAuthorizationService,
        NotificationFactory,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        {
          provide: BlocksService,
          useValue: { getExcludedUserIds: jest.fn(() => Promise.resolve([])) },
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
    factory = module.get(NotificationFactory);
  });

  it('tells the host, naming the joiner by username', async () => {
    await service.joinActivity('act-1', JOINER);
    await flush();

    expect(notifications.createNotification).toHaveBeenCalledTimes(1);
    const dto = notifications.createNotification.mock.calls[0][0];
    expect(dto.recipientId).toBe(HOST);
    expect(dto.actorId).toBe(JOINER);
    expect(dto.body).toBe('ananya joined your activity.');
  });

  it('carries the activity name and cover so the card needs no second fetch', async () => {
    await service.joinActivity('act-1', JOINER);
    await flush();

    const dto = notifications.createNotification.mock.calls[0][0];
    expect(dto.entityId).toBe('act-1');
    expect(dto.metadata).toMatchObject({
      activityId: 'act-1',
      activityName: 'Sunset badminton',
      activityImage: 'activities/cover.webp',
      actorUsername: 'ananya',
      actorAvatar: 'avatars/ananya.webp',
    });
  });

  it('says nothing when the join was not a real membership transition', async () => {
    // Concurrent joins both pass the pre-check; only the INSERT reports xmax = 0,
    // which is what makes the notification exactly-once at the database level.
    prisma.$queryRaw.mockResolvedValueOnce([{ inserted: false }]);
    await service.joinActivity('act-1', JOINER);
    await flush();
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });

  it('does not notify the host about their own join', async () => {
    await service.joinActivity('act-1', HOST);
    await flush();
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });

  it('never reports a join as a pending request', () => {
    const dto = factory.createActivityJoin(
      { id: JOINER, username: 'ananya', displayName: 'Ananya S', avatar: null },
      { id: 'act-1', title: 'Sunset badminton', coverImage: null },
      HOST,
    );
    expect(dto.body).not.toMatch(/request/i);
    expect(dto.body).toBe('ananya joined your activity.');

    return Promise.resolve();
  });

  // Probes for members that must NOT exist, so the service is viewed as a
  // plain record: its own type cannot name them.
  it('has no request-to-join entry point left on the service', () => {
    expect(
      (service as unknown as Record<string, unknown>).requestToJoinActivity,
    ).toBeUndefined();
    expect(
      (service as unknown as Record<string, unknown>).acceptJoinRequest,
    ).toBeUndefined();
    expect(
      (service as unknown as Record<string, unknown>).rejectJoinRequest,
    ).toBeUndefined();
  });
});
