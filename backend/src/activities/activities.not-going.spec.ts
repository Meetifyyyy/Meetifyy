import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { ActivityAuthorizationService } from './activity-authorization.service';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { NotificationFactory } from '../notifications/notification.factory';
import type { BlocksService } from '../users/blocks.service';
import type { DomainEventService } from '../events/domain-event.service';

/**
 * "I'm out" on the activity page, and the "Going" / "Not going" split it
 * feeds.
 *
 * The answer is stored on the existing membership row as DECLINED (no new
 * table): a member who answers no leaves the attendee count, an invitee's
 * invitation is declined exactly as it is from Notifications, and "I'm in"
 * goes back through the ordinary join.
 */
describe('ActivitiesService — not going', () => {
  const HOST = 'host';
  const ME = 'me';
  const ACT = 'act-1';

  type Invitation = {
    id: string;
    inviterId: string;
    inviteeId: string;
    status: string;
    revokedAt: Date | null;
    expiresAt: Date | null;
  };
  type ActivityRow = {
    id: string;
    creatorId: string;
    collegeId: string | null;
    visibility: 'PUBLIC' | 'COLLEGE_ONLY' | 'PRIVATE';
    status: string;
    deletedAt: Date | null;
    startDate: Date | null;
    maxMembers: number | null;
    participationType: string;
    title: string;
    coverImage: string | null;
    coverColor: string | null;
    invitations: Invitation[];
    members: unknown[];
    creator: { id: string; username: string };
    _count: { members: number };
  };
  type MemberUpsertArgs = {
    where: { userId_activityId: { userId: string; activityId: string } };
    create: { userId: string; activityId: string; status: string };
    update: { status: string; joinedAt: Date };
  };
  type MemberFindManyArgs = {
    where: { status?: string; userId?: { notIn: string[] } };
  };

  let activity: ActivityRow;
  let membership: { userId: string; status: string } | null;
  let excluded: string[];
  let upsertRawResult: Array<{ inserted: boolean; becameMember?: boolean }>;

  const memberUpsert = jest.fn((args: MemberUpsertArgs) =>
    Promise.resolve({ ...args.create, status: args.update.status }),
  );
  const memberFindMany = jest.fn((_args: MemberFindManyArgs) =>
    Promise.resolve<unknown[]>([]),
  );
  const memberCount = jest.fn((_args: unknown) => Promise.resolve(0));
  const invitationUpdateMany = jest.fn((_args: unknown) =>
    Promise.resolve({ count: 1 }),
  );
  const updateNotificationLifecycleStatus = jest.fn((_args: unknown) =>
    Promise.resolve([]),
  );
  const createNotification = jest.fn((_dto: unknown) => Promise.resolve({}));
  const emit = jest.fn((_type: string, _data: unknown, _targets?: string[]) =>
    Promise.resolve(),
  );
  const queryRaw = jest.fn(() => Promise.resolve(upsertRawResult));

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  const makeService = () =>
    new ActivitiesService(
      stub<PrismaService>({
        crewActivity: {
          findUnique: jest.fn(() => Promise.resolve(activity)),
        },
        crewActivityMember: {
          findUnique: jest.fn(() => Promise.resolve(membership)),
          findMany: memberFindMany,
          count: memberCount,
          upsert: memberUpsert,
        },
        activityInvitation: { updateMany: invitationUpdateMany },
        user: {
          findUnique: jest.fn(({ where }: { where: { id: string } }) =>
            Promise.resolve({
              id: where.id,
              username: where.id,
              displayName: where.id,
              avatar: null,
              collegeAffiliation: null,
            }),
          ),
        },
        $queryRaw: queryRaw,
      }),
      stub<NotificationsService>({
        updateNotificationLifecycleStatus,
        createNotification,
      }),
      stub<NotificationFactory>({
        createActivityJoin: jest.fn(() => ({
          type: 'ACTIVITY_JOIN',
          recipientId: HOST,
          actorId: ME,
          title: 'joined',
          body: 'joined',
        })),
      }),
      stub<BlocksService>({
        isBlocked: jest.fn((a: string, b: string) =>
          Promise.resolve(excluded.includes(a === ME ? b : a)),
        ),
        getExcludedUserIds: jest.fn(() => Promise.resolve(excluded)),
        filterBlockedUsers: jest.fn((_me: string, ids: string[]) =>
          Promise.resolve(ids.filter((id) => !excluded.includes(id))),
        ),
        injectBlockFilter: jest.fn(<T extends object>(_me: string, where: T) =>
          Promise.resolve(where),
        ),
      }),
      stub<DomainEventService>({ emit }),
      new ActivityAuthorizationService(),
    );

  const invitation = (over: Partial<Invitation> = {}): Invitation => ({
    id: 'inv-1',
    inviterId: HOST,
    inviteeId: ME,
    status: 'PENDING',
    revokedAt: null,
    expiresAt: null,
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    excluded = [];
    membership = null;
    upsertRawResult = [{ inserted: true, becameMember: true }];
    activity = {
      id: ACT,
      creatorId: HOST,
      collegeId: 'college-a',
      visibility: 'PUBLIC',
      status: 'OPEN',
      deletedAt: null,
      startDate: new Date(Date.now() + 86_400_000),
      maxMembers: null,
      participationType: 'OPEN',
      title: 'Sunrise hike',
      coverImage: null,
      coverColor: null,
      invitations: [],
      members: [],
      creator: { id: HOST, username: HOST },
      _count: { members: 1 },
    };
  });

  describe('markNotGoing ("I\'m out")', () => {
    it('takes a member out of the activity and keeps the answer as DECLINED', async () => {
      membership = { userId: ME, status: 'MEMBER' };

      const res = await makeService().markNotGoing(ACT, ME);
      await flush();

      expect(res).toEqual({ success: true, lostAccess: false });
      expect(memberUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_activityId: { userId: ME, activityId: ACT } },
          create: { userId: ME, activityId: ACT, status: 'DECLINED' },
          update: expect.objectContaining({ status: 'DECLINED' }) as unknown,
        }),
      );
      // The attendee count drops through the existing realtime path.
      expect(emit).toHaveBeenCalledWith('activity.memberLeft', {
        activityId: ACT,
        userId: ME,
      });
    });

    it('records an undecided viewer as not going without a memberLeft', async () => {
      await makeService().markNotGoing(ACT, ME);
      await flush();

      expect(memberUpsert).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith('activity.updated', {
        id: ACT,
        activityId: ACT,
      });
      expect(emit).not.toHaveBeenCalledWith(
        'activity.memberLeft',
        expect.anything(),
      );
    });

    it('declines a pending invitation, re-states its notification and tells the inviter', async () => {
      activity.invitations = [invitation()];

      await makeService().markNotGoing(ACT, ME);

      expect(invitationUpdateMany).toHaveBeenCalledWith({
        where: {
          id: 'inv-1',
          status: { in: ['PENDING', 'ACCEPTED'] },
          revokedAt: null,
        },
        data: { status: 'DECLINED', respondedAt: expect.any(Date) as Date },
      });
      expect(updateNotificationLifecycleStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: ACT,
          status: 'DECLINED',
          recipientIds: [ME],
          onlyIfStatusIn: ['PENDING', 'ACCEPTED'],
        }),
      );
      expect(emit).toHaveBeenCalledWith(
        'invitation:updated',
        { invitationId: 'inv-1', status: 'DECLINED', activityId: ACT },
        [HOST, ME],
      );
    });

    it('declines an accepted invitation when an attendee changes their mind', async () => {
      membership = { userId: ME, status: 'MEMBER' };
      activity.invitations = [invitation({ status: 'ACCEPTED' })];

      await makeService().markNotGoing(ACT, ME);

      expect(invitationUpdateMany).toHaveBeenCalledTimes(1);
    });

    it('leaves a revoked invitation alone', async () => {
      activity.invitations = [invitation({ revokedAt: new Date() })];

      await makeService().markNotGoing(ACT, ME);

      expect(invitationUpdateMany).not.toHaveBeenCalled();
      expect(memberUpsert).toHaveBeenCalledTimes(1);
    });

    it('is idempotent once the answer is already no', async () => {
      membership = { userId: ME, status: 'DECLINED' };

      await expect(makeService().markNotGoing(ACT, ME)).resolves.toEqual({
        success: true,
        lostAccess: false,
      });
      expect(memberUpsert).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it('an invitee to a private activity keeps the page after answering no', async () => {
      activity.visibility = 'PRIVATE';
      activity.invitations = [invitation()];

      await expect(makeService().markNotGoing(ACT, ME)).resolves.toEqual({
        success: true,
        lostAccess: false,
      });
    });

    it('refuses the host', async () => {
      await expect(makeService().markNotGoing(ACT, HOST)).rejects.toThrow(
        BadRequestException,
      );
      expect(memberUpsert).not.toHaveBeenCalled();
    });

    it('refuses once the activity has started', async () => {
      activity.startDate = new Date(Date.now() - 60_000);
      await expect(makeService().markNotGoing(ACT, ME)).rejects.toThrow(
        /already started/,
      );
      expect(memberUpsert).not.toHaveBeenCalled();
    });

    it('refuses a cancelled activity', async () => {
      activity.status = 'CANCELLED';
      await expect(makeService().markNotGoing(ACT, ME)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('answers a private activity the caller cannot see with 404, writing nothing', async () => {
      activity.visibility = 'PRIVATE';
      await expect(makeService().markNotGoing(ACT, ME)).rejects.toThrow(
        NotFoundException,
      );
      expect(memberUpsert).not.toHaveBeenCalled();
    });

    it('answers 404 when the caller and host are blocked', async () => {
      excluded = [HOST];
      await expect(makeService().markNotGoing(ACT, ME)).rejects.toThrow(
        NotFoundException,
      );
      expect(memberUpsert).not.toHaveBeenCalled();
    });
  });

  describe('joinActivity after "I\'m out" ("I\'m in")', () => {
    it('tells the host again when a declined row becomes a member', async () => {
      membership = { userId: ME, status: 'DECLINED' };
      // The conflict path: not an insert, but the row did become MEMBER.
      upsertRawResult = [{ inserted: false, becameMember: true }];

      await expect(makeService().joinActivity(ACT, ME)).resolves.toEqual({
        success: true,
      });
      await flush();
      await flush();

      expect(createNotification).toHaveBeenCalledTimes(1);
    });

    it('stays quiet when the row was already a member', async () => {
      upsertRawResult = [{ inserted: false, becameMember: false }];
      await makeService().joinActivity(ACT, ME);
      await flush();
      await flush();
      expect(createNotification).not.toHaveBeenCalled();
    });

    it('turns a declined invitation back into an accepted one', async () => {
      membership = { userId: ME, status: 'DECLINED' };
      activity.invitations = [invitation({ status: 'DECLINED' })];

      await makeService().joinActivity(ACT, ME);

      expect(invitationUpdateMany).toHaveBeenCalledWith({
        where: {
          id: 'inv-1',
          status: { in: ['PENDING', 'DECLINED'] },
          revokedAt: null,
        },
        data: { status: 'ACCEPTED', respondedAt: expect.any(Date) as Date },
      });
      expect(updateNotificationLifecycleStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ACCEPTED',
          recipientIds: [ME],
          onlyIfStatusIn: ['PENDING', 'DECLINED'],
        }),
      );
    });

    it('does not touch the invitation when acceptInvitation drives the join', async () => {
      activity.invitations = [invitation()];
      await makeService().joinActivity(ACT, ME, { syncInvitation: false });
      expect(invitationUpdateMany).not.toHaveBeenCalled();
    });
  });

  describe('the Going / Not going lists', () => {
    const person = (id: string) => ({
      userId: id,
      status: 'DECLINED',
      joinedAt: new Date(),
      user: {
        id,
        username: id,
        displayName: id,
        avatar: null,
        isCampusRep: false,
        collegeId: null,
        college: null,
        accountStatus: 'ACTIVE',
        deletedAt: null,
      },
    });

    it('serves "Not going" alongside the unchanged attendee fields', async () => {
      memberFindMany.mockResolvedValueOnce([person('nope')]);
      memberCount.mockResolvedValueOnce(1);

      const detail = await makeService().getActivityById(ACT, ME);

      expect(detail.notGoing.map((m) => m.userId)).toEqual(['nope']);
      expect(detail.notGoingCount).toBe(1);
      expect(detail.hasMoreNotGoing).toBe(false);
      expect(detail.isNotGoing).toBe(false);
      expect(detail.notGoingRemovesAccess).toBe(false);
      // The fields an older installed app reads are still there.
      expect(detail).toHaveProperty('members');
      expect(detail).toHaveProperty('memberCount');
      expect(detail).toHaveProperty('isJoined', false);
      expect(memberFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { activityId: ACT, status: 'DECLINED' },
        }),
      );
    });

    it('marks the viewer as not going from their own row', async () => {
      membership = { userId: ME, status: 'DECLINED' };
      const detail = await makeService().getActivityById(ACT, ME);
      expect(detail.isNotGoing).toBe(true);
      expect(detail.myStatus).toBe('DECLINED');
      expect(detail.isJoined).toBe(false);
    });

    it('hides people the viewer is blocked with, as the attendee list does', async () => {
      excluded = ['blocked-guest'];
      await makeService().getActivityById(ACT, ME);
      expect(memberFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            activityId: ACT,
            status: 'DECLINED',
            userId: { notIn: ['blocked-guest'] },
          },
        }),
      );
    });

    it('never hides anyone from the host', async () => {
      excluded = ['blocked-guest'];
      await makeService().getActivityById(ACT, HOST);
      expect(memberFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { activityId: ACT, status: 'DECLINED' },
        }),
      );
    });

    it('shows a deleted person in "Not going" as the tombstone', async () => {
      const gone = person('gone');
      memberFindMany.mockResolvedValueOnce([
        {
          ...gone,
          user: {
            ...gone.user,
            accountStatus: 'DELETED',
            deletedAt: new Date(),
          },
        },
      ]);
      const detail = await makeService().getActivityById(ACT, ME);
      expect(detail.notGoing[0].user?.displayName).toBe('Deleted User');
    });

    it('does not warn an invitee: answering no keeps their page', async () => {
      activity.visibility = 'PRIVATE';
      activity.invitations = [invitation()];
      const detail = await makeService().getActivityById(ACT, ME);
      expect(detail.notGoingRemovesAccess).toBe(false);
    });

    it('pages the "Not going" list from the attendees endpoint', async () => {
      await makeService().getAttendees(ACT, ME, 30, undefined, 'not_going');
      expect(memberFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            activityId: ACT,
            status: 'DECLINED',
          }) as unknown,
        }),
      );
    });

    it('keeps the attendees endpoint on people going by default', async () => {
      await makeService().getAttendees(ACT, ME);
      expect(memberFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'MEMBER' }) as unknown,
        }),
      );
    });
  });
});
