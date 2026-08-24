import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommunitiesService } from './communities.service';

/**
 * Role management.
 *
 * Two rules matter here, and one of them was not enforced. The endpoint
 * validated `role` only as "a string of at most 20 characters" and the
 * service wrote it with `as any`, so `role: "OWNER"` was accepted verbatim.
 * That row satisfies every `member?.role === 'OWNER'` check in this service —
 * so an owner could mint a second owner who could then edit the community,
 * delete it, and re-role anyone, with no way to undo it through the API.
 */
describe('CommunitiesService — member roles', () => {
  const COMMUNITY = 'c1';
  const OWNER = 'owner';

  let service: CommunitiesService;
  let prisma: any;
  let updates: any[];

  const setup = ({ requester = { role: 'OWNER' }, target = { role: 'MEMBER' }, ownerId = OWNER } = {} as any) => {
    updates = [];
    prisma = {
      community: { findUnique: jest.fn(async () => ({ ownerId })) },
      communityMember: {
        findUnique: jest.fn(async ({ where }: any) =>
          (where.userId_communityId.userId === OWNER ? requester : target)),
        update: jest.fn(async (args: any) => { updates.push(args); return { ...target, ...args.data }; }),
      },
    };
    service = new CommunitiesService(
      prisma,
      { emit: jest.fn() } as any,
      { getClient: () => null } as any,
      {} as any,
      { refFor: () => null } as any,
      { getExcludedUserIds: async () => [], isBlocked: async () => false, filterBlockedUsers: async (_u: any, ids: any) => ids, injectBlockFilter: async (_u: any, w: any) => w, invalidateBlockCache: async () => {} } as any,
      // Promotion notifications are covered in communities.moderator-promotion.spec.ts.
      { createNotification: async () => ({}) } as any,
      { createModeratorPromotion: () => null } as any,
    );
  };

  const setRole = (role: any, actor = OWNER) =>
    service.updateMemberRole(COMMUNITY, 'target', role, actor);

  describe('escalation', () => {
    it('refuses to grant OWNER through this endpoint', async () => {
      setup();
      await expect(setRole('OWNER')).rejects.toThrow(ForbiddenException);
      expect(updates).toHaveLength(0);
    });

    it('refuses any role outside the two it exists for', async () => {
      setup();
      for (const bad of ['ADMIN', 'owner', '', 'SUPERUSER', null, undefined]) {
        await expect(setRole(bad)).rejects.toThrow(ForbiddenException);
      }
      expect(updates).toHaveLength(0);
    });
  });

  describe('the two legitimate transitions', () => {
    it('promotes a member to moderator', async () => {
      setup();
      await setRole('MODERATOR');
      // Promotion also stamps the moment, which is what makes the one-time
      // welcome notice "once per promotion" rather than "once ever".
      expect(updates[0].data).toMatchObject({ role: 'MODERATOR' });
      expect(updates[0].data.moderatorPromotedAt).toBeInstanceOf(Date);
    });

    it('demotes a moderator back to member', async () => {
      setup({ target: { role: 'MODERATOR' } });
      await setRole('MEMBER');
      expect(updates[0].data).toEqual({ role: 'MEMBER' });
    });
  });

  describe('who may do it', () => {
    it('refuses a moderator', async () => {
      // Managing roles is owner-only; a moderator promoting peers would let
      // the moderator group grow without the owner's involvement.
      setup({ requester: { role: 'MODERATOR' }, ownerId: 'someone-else' });
      await expect(setRole('MODERATOR', OWNER)).rejects.toThrow(/only the community owner/i);
    });

    it('refuses a plain member', async () => {
      setup({ requester: { role: 'MEMBER' }, ownerId: 'someone-else' });
      await expect(setRole('MODERATOR', OWNER)).rejects.toThrow(ForbiddenException);
    });

    it('allows the owner by ownerId even without a member row', async () => {
      setup({ requester: null });
      await expect(setRole('MODERATOR')).resolves.toBeDefined();
    });
  });

  describe('the owner as a target', () => {
    it('cannot be re-roled', async () => {
      setup();
      await expect(service.updateMemberRole(COMMUNITY, OWNER, 'MEMBER', OWNER))
        .rejects.toThrow(/cannot modify the role of the community owner/i);
    });
  });

  it('404s for someone who is not in the community', async () => {
    setup({ target: null });
    await expect(setRole('MODERATOR')).rejects.toThrow(NotFoundException);
  });
});
