import { CommunitiesService } from './communities.service';
import { NotificationFactory } from '../notifications/notification.factory';
import {
  moderatorPermissions,
  permissionsForRole,
  roleCan,
  COMMUNITY_CAPABILITIES,
} from './moderator-permissions';

describe('Moderator permission registry', () => {
  it('is the same table the code enforces with', () => {
    // The whole point of the registry: if these ever diverge, the owner
    // confirms a promotion against one list while the services apply another,
    // and the person we misled is the one being handed the power.
    moderatorPermissions().forEach((p) => {
      expect(roleCan('MODERATOR', p.id as any)).toBe(true);
    });

    Object.values(COMMUNITY_CAPABILITIES)
      .filter((c) => !c.roles.includes('MODERATOR'))
      .forEach((c) => {
        expect(moderatorPermissions().some((p) => p.id === c.id)).toBe(false);
      });
  });

  it('grants a member nothing', () => {
    expect(permissionsForRole('MEMBER')).toEqual([]);
    expect(roleCan('MEMBER', 'REMOVE_MEMBERS')).toBe(false);
    expect(roleCan('MEMBER', 'DELETE_MEMBER_CONTENT')).toBe(false);
    expect(roleCan(null, 'REVIEW_JOIN_REQUESTS')).toBe(false);
  });

  it('gives the owner everything a moderator has', () => {
    const ownerIds = permissionsForRole('OWNER').map((p) => p.id);
    moderatorPermissions().forEach((p) => expect(ownerIds).toContain(p.id));
  });

  it('states the limit on every capability that has one', () => {
    // "Remove members" without "not the owner, not other moderators" reads as
    // a bigger power than it is, and the limits are really enforced.
    const byId = Object.fromEntries(
      moderatorPermissions().map((p) => [p.id, p]),
    );
    expect(byId.REMOVE_MEMBERS.limit).toMatch(/not other moderators/i);
    expect(byId.DELETE_MEMBER_CONTENT.limit).toMatch(/moderators/i);
  });

  it('describes every capability it lists', () => {
    moderatorPermissions().forEach((p) => {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    });
  });
});

describe('CommunitiesService — moderator promotion notice', () => {
  const COMMUNITY = 'c1';
  const OWNER = 'owner-1';
  const MEMBER = 'member-1';

  let prisma: any;
  let service: CommunitiesService;
  let created: any[];
  let updates: any[];

  const setup = (member: any) => {
    created = [];
    updates = [];
    prisma = {
      community: {
        findUnique: jest.fn(async () => ({
          id: COMMUNITY,
          ownerId: OWNER,
          name: 'Chess Club',
          avatarKey: null,
        })),
      },
      communityMember: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.userId_communityId.userId === OWNER
            ? { role: 'OWNER' }
            : member,
        ),
        update: jest.fn(async ({ data }: any) => {
          updates.push(data);
          return { ...member, ...data };
        }),
      },
      user: {
        findUnique: jest.fn(async () => ({
          id: OWNER,
          username: 'own',
          displayName: 'Owner',
        })),
      },
    };
    service = new CommunitiesService(
      prisma,
      { emit: jest.fn() } as any,
      { getClient: () => null } as any,
      {} as any,
      {} as any,
      {} as any,
      {
        createNotification: jest.fn(async (dto: any) => {
          created.push(dto);
        }),
      } as any,
      new NotificationFactory(),
    );
    (service as any).invalidateCommunityCache = jest.fn(async () => {});
  };

  const settle = () => new Promise((r) => setImmediate(r));

  describe('promoting', () => {
    it('stamps the promotion and notifies the new moderator', async () => {
      setup({ role: 'MEMBER', userId: MEMBER });
      await service.updateMemberRole(COMMUNITY, MEMBER, 'MODERATOR', OWNER);
      await settle();

      expect(updates[0].moderatorPromotedAt).toBeInstanceOf(Date);
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        recipientId: MEMBER,
        title: "You're now a moderator",
      });
      expect(created[0].metadata).toMatchObject({
        kind: 'moderator_promotion',
        communityId: COMMUNITY,
      });
    });

    it('pushes a targeted realtime event so an open community reacts at once', async () => {
      // Without this the promoted member sees nothing until they navigate away
      // and back — and they are the likeliest person to be looking at the
      // community, since the owner has probably just told them.
      setup({ role: 'MEMBER', userId: MEMBER });
      await service.updateMemberRole(COMMUNITY, MEMBER, 'MODERATOR', OWNER);

      const emit = (service as any).domainEventService.emit;
      const promoted = emit.mock.calls.find(
        ([type]: any[]) => type === 'community:moderator_promoted',
      );
      expect(promoted).toBeDefined();
      expect(promoted[1]).toEqual({ communityId: COMMUNITY });
      // Targeted at the promoted member, not broadcast: the welcome modal is
      // theirs alone. The room still gets community.roleUpdated for the
      // member-list refresh everyone needs.
      expect(promoted[2]).toEqual([MEMBER]);
      expect(
        emit.mock.calls.some(
          ([type]: any[]) => type === 'community.roleUpdated',
        ),
      ).toBe(true);
    });

    it('pushes no promotion event on demotion or a no-op re-promotion', async () => {
      setup({ role: 'MODERATOR', userId: MEMBER });
      await service.updateMemberRole(COMMUNITY, MEMBER, 'MODERATOR', OWNER);
      await service.updateMemberRole(COMMUNITY, MEMBER, 'MEMBER', OWNER);

      const emit = (service as any).domainEventService.emit;
      expect(
        emit.mock.calls.filter(
          ([type]: any[]) => type === 'community:moderator_promoted',
        ),
      ).toHaveLength(0);
    });

    it('does not re-arm or re-notify someone who is already a moderator', async () => {
      // An owner tapping twice, or a retried request, must not pester them.
      setup({ role: 'MODERATOR', userId: MEMBER });
      await service.updateMemberRole(COMMUNITY, MEMBER, 'MODERATOR', OWNER);
      await settle();

      expect(updates[0].moderatorPromotedAt).toBeUndefined();
      expect(created).toHaveLength(0);
    });

    it('does not notify on demotion', async () => {
      setup({ role: 'MODERATOR', userId: MEMBER });
      await service.updateMemberRole(COMMUNITY, MEMBER, 'MEMBER', OWNER);
      await settle();
      expect(created).toHaveLength(0);
    });

    it('still promotes when the notification fails', async () => {
      // The role change has committed; a notification failure must not read to
      // the owner as a promotion that did not take.
      setup({ role: 'MEMBER', userId: MEMBER });
      (service as any).notificationsService.createNotification = jest.fn(
        async () => {
          throw new Error('queue down');
        },
      );
      await expect(
        service.updateMemberRole(COMMUNITY, MEMBER, 'MODERATOR', OWNER),
      ).resolves.toBeDefined();
      await settle();
    });
  });

  describe('the one-time notice', () => {
    const noticeFor = (member: any) => {
      setup(member);
      return service.getModeratorNotice(COMMUNITY, MEMBER);
    };

    it('is pending for a fresh promotion, with the live permission list', async () => {
      const notice = await noticeFor({
        role: 'MODERATOR',
        moderatorPromotedAt: new Date('2026-01-02'),
        moderatorNoticeAckedAt: null,
      });
      expect(notice).not.toBeNull();
      expect(notice?.permissions).toEqual(moderatorPermissions());
    });

    it('is gone once acknowledged', async () => {
      const notice = await noticeFor({
        role: 'MODERATOR',
        moderatorPromotedAt: new Date('2026-01-02'),
        moderatorNoticeAckedAt: new Date('2026-01-03'),
      });
      expect(notice).toBeNull();
    });

    it('returns once per PROMOTION, not once ever', async () => {
      // Demoted, then promoted again: they are being handed the role a second
      // time and should be told again. A boolean "seen" flag would stay set.
      const notice = await noticeFor({
        role: 'MODERATOR',
        moderatorPromotedAt: new Date('2026-02-01'),
        moderatorNoticeAckedAt: new Date('2026-01-03'),
      });
      expect(notice).not.toBeNull();
    });

    it('is never shown to a plain member', async () => {
      const notice = await noticeFor({
        role: 'MEMBER',
        moderatorPromotedAt: new Date('2026-01-02'),
        moderatorNoticeAckedAt: null,
      });
      expect(notice).toBeNull();
    });

    it('is null for a non-member and for an anonymous viewer', async () => {
      setup(null);
      await expect(
        service.getModeratorNotice(COMMUNITY, MEMBER),
      ).resolves.toBeNull();
      await expect(
        service.getModeratorNotice(COMMUNITY, ''),
      ).resolves.toBeNull();
    });

    it('is acknowledged idempotently', async () => {
      setup({ role: 'MODERATOR' });
      await service.acknowledgeModeratorNotice(COMMUNITY, MEMBER);
      await service.acknowledgeModeratorNotice(COMMUNITY, MEMBER);
      expect(updates).toHaveLength(2);
      updates.forEach((u) =>
        expect(u.moderatorNoticeAckedAt).toBeInstanceOf(Date),
      );
    });
  });
});
