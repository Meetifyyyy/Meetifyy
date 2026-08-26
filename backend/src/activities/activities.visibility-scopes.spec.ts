import { Test, TestingModule } from '@nestjs/testing';
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
 * The College and Campus surfaces are COLLEGE_ONLY surfaces, and that has to be
 * true in the DATABASE QUERY — not in a frontend filter — or a client that calls
 * the endpoint directly sees a different set than the UI shows.
 */
describe('Activity feed scopes', () => {
  const ME = 'me';
  const MY_COLLEGE = 'college-a';

  let service: ActivitiesService;
  let prisma: any;
  let lastWhere: any;

  beforeEach(async () => {
    lastWhere = undefined;
    prisma = {
      crewActivity: {
        findMany: jest.fn(async ({ where }: any) => {
          lastWhere = where;
          return [];
        }),
      },
      crewActivityMember: { findMany: jest.fn(async () => []) },
      user: {
        findUnique: jest.fn(async () => ({ id: ME, collegeId: MY_COLLEGE })),
      },
      activityInvitation: { count: jest.fn(async () => 0) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        ActivityAuthorizationService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: {} },
        { provide: NotificationFactory, useValue: {} },
        {
          provide: BlocksService,
          useValue: { getExcludedUserIds: jest.fn(async () => []) },
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
  });

  /** The scope's own filter clause (the policy filter is the second AND term). */
  const scopeFilterFor = async (scope: any) => {
    await service.getAllActivities(ME, 20, undefined, scope);
    return lastWhere?.AND?.[0];
  };

  it('restricts the College section to COLLEGE_ONLY activities of my college', async () => {
    const filter = await scopeFilterFor('college');
    expect(filter.visibility).toBe('COLLEGE_ONLY');
    expect(filter.collegeId).toBe(MY_COLLEGE);
  });

  it('applies the identical rule to the Campus surface', async () => {
    const filter = await scopeFilterFor('campus');
    expect(filter.visibility).toBe('COLLEGE_ONLY');
    expect(filter.collegeId).toBe(MY_COLLEGE);
  });

  it('does not pin visibility on the All feed, so "Anyone" activities show there', async () => {
    const filter = await scopeFilterFor('public');
    expect(filter.visibility).toBeUndefined();
    expect(filter.collegeId).toBeUndefined();
  });

  it('never lets a scope filter stand alone — the policy is AND-composed', async () => {
    await service.getAllActivities(ME, 20, undefined, 'college');
    expect(Array.isArray(lastWhere.AND)).toBe(true);
    expect(lastWhere.AND).toHaveLength(2);
    // PRIVATE is excluded structurally by the policy clause, never by the scope.
    expect(JSON.stringify(lastWhere.AND[1])).not.toContain('PRIVATE');
  });

  it('returns nothing for the college surfaces when the viewer has no college', async () => {
    prisma.user.findUnique = jest.fn(async () => ({ id: ME, collegeId: null }));
    const res = await service.getAllActivities(ME, 20, undefined, 'campus');
    expect(res).toEqual({ activities: [], nextCursor: undefined });
    expect(prisma.crewActivity.findMany).not.toHaveBeenCalled();
  });
});
