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
 * Crew discovery: the personalized "For You" ranking and the three-section
 * "All" payload behind it.
 */
describe('Crew discovery', () => {
  /** Users the viewer is blocked with, per test. */
  let blockedIds: string[] = [];
  const GLA = 'college-gla';
  const ME = 'me';
  const day = 24 * 60 * 60 * 1000;

  let service: ActivitiesService;
  let prisma: any;
  let pool: any[];
  let follows: { followerId: string; followingId: string }[];
  let friendMemberships: { activityId: string; userId: string }[];

  const act = (id: string, over: Partial<any> = {}) => ({
    id,
    creatorId: `host-${id}`,
    collegeId: null,
    title: id,
    description: '',
    location: '',
    startDate: new Date(Date.now() + 10 * day),
    maxMembers: null,
    _count: { members: 1 },
    deletedAt: null,
    status: 'OPEN',
    ...over,
  });

  beforeEach(async () => {
    pool = [];
    follows = [];
    friendMemberships = [];
    blockedIds = [];

    prisma = {
      crewActivity: {
        findMany: jest.fn(async ({ take, select }: any) => {
          const rows = pool.slice(0, take ?? pool.length);
          // The hydration query asks for CARD_SELECT (which includes members);
          // the ranking query does not. Both just echo the pool here.
          return select?.members ? rows.map(r => ({ ...r, members: [] })) : rows;
        }),
      },
      crewActivityMember: {
        findMany: jest.fn(async ({ where }: any) => {
          if (where?.userId && where.userId.in) return friendMemberships;
          if (where?.userId === ME && where?.status === 'MEMBER' && !where.activityId) return [];
          return [];
        }),
      },
      user: {
        findUnique: jest.fn(async () => ({ id: ME, collegeId: GLA, interests: [], college: { name: 'GLA' } })),
      },
      follow: {
        findMany: jest.fn(async ({ where }: any) =>
          where.followerId === ME
            ? follows.filter(f => f.followerId === ME)
            : follows.filter(f => f.followingId === ME),
        ),
      },
      conversationParticipant: { findMany: jest.fn(async () => []) },
      activityInvitation: { count: jest.fn(async () => 0) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        ActivityAuthorizationService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: {} },
        { provide: NotificationFactory, useValue: {} },
        { provide: BlocksService, useValue: { getExcludedUserIds: jest.fn(async () => blockedIds) } },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        { provide: RedisService, useValue: { getClient: () => null } },
        { provide: getQueueToken(NOTIFICATIONS_QUEUE), useValue: { add: jest.fn() } },
      ],
    }).compile();

    service = module.get(ActivitiesService);
  });

  const order = async () => (await service.getForYouFeed(ME, 50)).activities.map((a: any) => a.id);

  describe('For You ranking', () => {
    it('ranks an activity hosted by a mutual above an unrelated one', async () => {
      pool = [act('plain'), act('mutual')];
      follows = [
        { followerId: ME, followingId: 'host-mutual' },
        { followerId: 'host-mutual', followingId: ME },
      ];
      expect(await order()).toEqual(['mutual', 'plain']);
    });

    it('ranks a mutual host above a one-way follow', async () => {
      pool = [act('oneway'), act('mutual')];
      follows = [
        { followerId: ME, followingId: 'host-oneway' },
        { followerId: ME, followingId: 'host-mutual' },
        { followerId: 'host-mutual', followingId: ME },
      ];
      expect(await order()).toEqual(['mutual', 'oneway']);
    });

    it('lifts an activity friends are already attending', async () => {
      pool = [act('quiet'), act('friends')];
      follows = [
        { followerId: ME, followingId: 'friend-1' },
        { followerId: ME, followingId: 'friend-2' },
      ];
      friendMemberships = [
        { activityId: 'friends', userId: 'friend-1' },
        { activityId: 'friends', userId: 'friend-2' },
      ];
      expect(await order()).toEqual(['friends', 'quiet']);
    });

    it('lifts an activity from the user’s own college', async () => {
      pool = [act('elsewhere'), act('mycollege', { collegeId: GLA })];
      expect(await order()).toEqual(['mycollege', 'elsewhere']);
    });

    it('lifts an activity matching a stated interest', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: ME, collegeId: GLA, interests: ['badminton'], college: { name: 'GLA' },
      });
      pool = [act('other'), act('sport', { title: 'Evening Badminton doubles' })];
      expect(await order()).toEqual(['sport', 'other']);
    });

    it('falls back to soonest-first when no personal signal applies', async () => {
      pool = [
        act('later', { startDate: new Date(Date.now() + 12 * day) }),
        act('sooner', { startDate: new Date(Date.now() + 1 * day) }),
      ];
      expect(await order()).toEqual(['sooner', 'later']);
    });

    it('is deterministic for two activities with identical signals', async () => {
      const at = new Date(Date.now() + 3 * day);
      pool = [act('bbb', { startDate: at }), act('aaa', { startDate: at })];
      expect(await order()).toEqual(['aaa', 'bbb']);
      expect(await order()).toEqual(['aaa', 'bbb']);
    });

    it('builds its candidate pool through the discovery policy', async () => {
      pool = [act('a')];
      await service.getForYouFeed(ME, 20);
      const where = JSON.stringify(prisma.crewActivity.findMany.mock.calls[0][0].where);
      expect(where).not.toContain('"PRIVATE"');
      expect(where).toContain('COLLEGE_ONLY');
      // Only activities that have not started yet are eligible.
      expect(where).toContain('startDate');
    });

    it('re-applies the policy and the not-started rule when hydrating a page', async () => {
      pool = [act('a')];
      await service.getForYouFeed(ME, 20);
      const hydrationWhere = JSON.stringify(prisma.crewActivity.findMany.mock.calls[1][0].where);
      expect(hydrationWhere).not.toContain('"PRIVATE"');
      expect(hydrationWhere).toContain('startDate');
      expect(hydrationWhere).toContain('"OPEN"');
    });

    it('re-applies the block filter when hydrating, not just when ranking', async () => {
      // The ranking is cached, so its ids can predate a block. Every other
      // rule is re-checked on hydration for exactly that reason; the block
      // filter was not, which let a "For You" page keep serving an activity
      // whose host had blocked this viewer since the ranking was built.
      blockedIds = ['blocked-host'];
      pool = [act('a')];
      await service.getForYouFeed(ME, 20);

      const hydrationWhere = JSON.stringify(prisma.crewActivity.findMany.mock.calls[1][0].where);
      expect(hydrationWhere).toContain('blocked-host');
      expect(hydrationWhere).toContain('notIn');
    });

    it('caps the candidate pool', async () => {
      pool = Array.from({ length: 400 }, (_, i) => act(`a${i}`));
      await service.getForYouFeed(ME, 20);
      expect(prisma.crewActivity.findMany.mock.calls[0][0].take).toBe(120);
    });
  });

  describe('For You pagination', () => {
    beforeEach(() => {
      pool = Array.from({ length: 12 }, (_, i) =>
        act(`a${String(i).padStart(2, '0')}`, { startDate: new Date(Date.now() + (i + 1) * day) }),
      );
    });

    it('pages by ranked offset and stops at the end', async () => {
      const p1 = await service.getForYouFeed(ME, 5);
      expect(p1.activities).toHaveLength(5);
      expect(p1.nextCursor).toBe('off:5');

      const p2 = await service.getForYouFeed(ME, 5, p1.nextCursor);
      expect(p2.nextCursor).toBe('off:10');

      const p3 = await service.getForYouFeed(ME, 5, p2.nextCursor);
      expect(p3.activities).toHaveLength(2);
      expect(p3.nextCursor).toBeUndefined();
    });

    it('never repeats an activity across pages', async () => {
      const p1 = await service.getForYouFeed(ME, 5);
      const p2 = await service.getForYouFeed(ME, 5, p1.nextCursor);
      const ids = [...p1.activities, ...p2.activities].map((a: any) => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('ignores a malformed cursor instead of failing', async () => {
      const res = await service.getForYouFeed(ME, 5, 'off:not-a-number');
      expect(res.activities).toHaveLength(5);
    });
  });

  describe('the "All" tab payload', () => {
    it('returns the three subsections, each capped at five with a hasMore flag', async () => {
      pool = Array.from({ length: 9 }, (_, i) => act(`a${i}`, { collegeId: GLA, maxMembers: 2 }));
      const res: any = await service.getCrewDiscover(ME);

      expect(Object.keys(res)).toEqual(
        expect.arrayContaining(['forYou', 'college', 'oneOnOne', 'collegeName', 'collegeId']),
      );
      for (const key of ['forYou', 'college', 'oneOnOne']) {
        expect(res[key].items.length).toBeLessThanOrEqual(5);
      }
      expect(res.forYou.hasMore).toBe(true);
    });

    it('does not repeat an activity across subsections', async () => {
      pool = Array.from({ length: 6 }, (_, i) => act(`a${i}`, { collegeId: GLA, maxMembers: 2 }));
      const res: any = await service.getCrewDiscover(ME);
      const ids = [...res.forYou.items, ...res.college.items, ...res.oneOnOne.items].map((a: any) => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('scopes each section correctly and to not-yet-started activities', async () => {
      pool = [act('a', { collegeId: GLA, maxMembers: 2 })];
      await service.getCrewDiscover(ME);
      const wheres = prisma.crewActivity.findMany.mock.calls.map((c: any) => JSON.stringify(c[0].where));
      const collegeWhere = wheres.find((w: string) => w.includes(`"collegeId":"${GLA}"`) && !w.includes('maxMembers'));
      const oneOnOneWhere = wheres.find((w: string) => w.includes('"maxMembers":2'));
      expect(collegeWhere).toBeDefined();
      expect(oneOnOneWhere).toBeDefined();
      for (const w of wheres) {
        expect(w).toContain('startDate');
        expect(w).not.toContain('"PRIVATE"');
      }
    });
  });
});
