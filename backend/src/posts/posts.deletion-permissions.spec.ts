import { ForbiddenException } from '@nestjs/common';
import { ContentDeletionAuthorizer } from './content-deletion.authorizer';

/**
 * Who may delete whose posts and comments inside a community.
 *
 * Written against the authorizer directly because this is an authorization
 * boundary: it has to hold for anything that reaches the API, not just for
 * what the UI offers a button for. The same rule governs posts and comments,
 * so the matrix is run once and both delete paths are wired to it.
 *
 * The cases that matter most are the refusals between staff — a moderator
 * must not be able to remove the owner's content or a peer moderator's.
 * Collapsing "owner or moderator" into one `isStaff` check would pass every
 * happy-path test here and still get those three wrong.
 */
describe('Content deletion permissions', () => {
  const COMMUNITY = 'c1';
  const OWNER = 'owner-1';

  let prisma: any;
  let authorizer: ContentDeletionAuthorizer;

  /** roles: userId -> role row, or absent for "no membership row". */
  /**
   * One fixture, both code paths.
   *
   * `resolveAuthority` (the enforced rule) reads through findUnique and
   * `canDeleteEach` (the answer given to the client) reads through findMany.
   * Backing both with the same `roles` map is what makes comparing their
   * answers meaningful — with separate fixtures the equivalence test would
   * only prove the two mocks agreed.
   */
  const setup = (roles: Record<string, 'OWNER' | 'MODERATOR' | 'MEMBER'>, commOver: any = {}) => {
    const comm = { id: COMMUNITY, ownerId: OWNER, deletedAt: null, name: 'Chess Club', ...commOver };
    prisma = {
      community: {
        findUnique: jest.fn(async () => comm),
        findMany: jest.fn(async () => (comm.deletedAt ? [] : [{ id: comm.id, ownerId: comm.ownerId }])),
      },
      communityMember: {
        findUnique: jest.fn(async ({ where }: any) => {
          const role = roles[where.userId_communityId.userId];
          return role ? { role } : null;
        }),
        findMany: jest.fn(async ({ where }: any) => {
          const wanted: string[] = where.userId?.in ?? (where.userId ? [where.userId] : Object.keys(roles));
          return wanted
            .filter((uid) => roles[uid])
            .map((uid) => ({ communityId: COMMUNITY, userId: uid, role: roles[uid] }));
        }),
      },
    };
    authorizer = new ContentDeletionAuthorizer(prisma);
  };

  const may = (actorId: string, authorId: string, communityId: string | null = COMMUNITY) =>
    authorizer.resolveAuthority({ actorId, authorId, communityId });

  const ROLES = { [OWNER]: 'OWNER', mod: 'MODERATOR', mod2: 'MODERATOR', member: 'MEMBER', member2: 'MEMBER' } as const;

  describe('the owner', () => {
    beforeEach(() => setup({ ...ROLES }));

    it("deletes a member's content", async () => {
      await expect(may(OWNER, 'member')).resolves.toBe('owner');
    });

    it("deletes a moderator's content", async () => {
      await expect(may(OWNER, 'mod')).resolves.toBe('owner');
    });

    it('deletes their own content', async () => {
      await expect(may(OWNER, OWNER)).resolves.toBe('author');
    });
  });

  describe('a moderator', () => {
    beforeEach(() => setup({ ...ROLES }));

    it("deletes a member's content", async () => {
      await expect(may('mod', 'member')).resolves.toBe('moderator');
    });

    it("is refused another moderator's content", async () => {
      await expect(may('mod', 'mod2')).resolves.toBeNull();
    });

    it("is refused the owner's content", async () => {
      await expect(may('mod', OWNER)).resolves.toBeNull();
    });

    it('deletes their own content', async () => {
      await expect(may('mod', 'mod')).resolves.toBe('author');
    });
  });

  describe('a member', () => {
    beforeEach(() => setup({ ...ROLES }));

    it("is refused another member's content", async () => {
      await expect(may('member', 'member2')).resolves.toBeNull();
    });

    it("is refused a moderator's content", async () => {
      await expect(may('member', 'mod')).resolves.toBeNull();
    });

    it("is refused the owner's content", async () => {
      await expect(may('member', OWNER)).resolves.toBeNull();
    });

    it('deletes their own content', async () => {
      await expect(may('member', 'member')).resolves.toBe('author');
    });
  });

  describe('an outsider with no membership row', () => {
    beforeEach(() => setup({ ...ROLES }));

    it('is refused', async () => {
      await expect(may('stranger', 'member')).resolves.toBeNull();
    });
  });

  describe('the owner without a membership row', () => {
    // Owners can legitimately have no CommunityMember row — see the repair
    // routine in CommunitiesService. Reading only the membership table would
    // demote them to MEMBER, and a moderator could then delete the owner's
    // posts. `ownerId` on the community row is the authority.
    beforeEach(() => setup({ mod: 'MODERATOR' }));

    it('still deletes anything', async () => {
      await expect(may(OWNER, 'mod')).resolves.toBe('owner');
    });

    it('is still protected from their own moderators', async () => {
      await expect(may('mod', OWNER)).resolves.toBeNull();
    });
  });

  describe('an author who has left the community', () => {
    // No membership row: treated as MEMBER, the least privilege. Leaving must
    // not promote your old content out of a moderator's reach.
    beforeEach(() => setup({ mod: 'MODERATOR' }));

    it('has their content moderatable', async () => {
      await expect(may('mod', 'ex-member')).resolves.toBe('moderator');
    });
  });

  describe('outside a community', () => {
    beforeEach(() => setup({ ...ROLES }));

    it('has no moderation at all — only the author may delete', async () => {
      // A personal post has no owner and no moderators.
      await expect(may(OWNER, 'member', null)).resolves.toBeNull();
      await expect(may('mod', 'member', null)).resolves.toBeNull();
      await expect(may('member', 'member', null)).resolves.toBe('author');
    });
  });

  describe('a community that is gone', () => {
    beforeEach(() => setup({ ...ROLES }, { deletedAt: new Date() }));

    it('moderates nothing, but the author keeps their own content', async () => {
      await expect(may('mod', 'member')).resolves.toBeNull();
      await expect(may(OWNER, 'member')).resolves.toBeNull();
      await expect(may('member', 'member')).resolves.toBe('author');
    });
  });

  describe('canDeleteEach — the answer handed to the client', () => {
    // The UI renders its delete control from this. If it disagreed with
    // resolveAuthority, users would see controls the API refuses (or be denied
    // ones it would allow), so the two are checked against each other here.
    beforeEach(() => setup({ ...ROLES }));

    const items = [
      { authorId: 'member', communityId: COMMUNITY },
      { authorId: 'mod2', communityId: COMMUNITY },
      { authorId: OWNER, communityId: COMMUNITY },
      { authorId: 'mod', communityId: COMMUNITY },
    ];

    it('matches resolveAuthority for a moderator, item for item', async () => {
      const batch = await authorizer.canDeleteEach('mod', items);
      const single = await Promise.all(
        items.map(async (i) => Boolean(await may('mod', i.authorId))),
      );
      expect(batch).toEqual(single);
      expect(batch).toEqual([true, false, false, true]); // member yes, peer no, owner no, own yes
    });

    it('matches resolveAuthority for the owner', async () => {
      const batch = await authorizer.canDeleteEach(OWNER, items);
      expect(batch).toEqual([true, true, true, true]);
    });

    it('matches resolveAuthority for a plain member', async () => {
      const batch = await authorizer.canDeleteEach('member', items);
      expect(batch).toEqual([true, false, false, false]); // only their own
    });

    it('answers false for everything when there is no viewer', async () => {
      expect(await authorizer.canDeleteEach(undefined, items)).toEqual([false, false, false, false]);
    });

    it('needs no queries at all for personal posts', async () => {
      const out = await authorizer.canDeleteEach('member', [
        { authorId: 'member', communityId: null },
        { authorId: 'someone', communityId: null },
      ]);
      expect(out).toEqual([true, false]);
      expect(prisma.community.findMany).not.toHaveBeenCalled();
    });

    it('does not look up author roles when the viewer moderates nothing', async () => {
      prisma.community.findMany = jest.fn(async () => [{ id: COMMUNITY, ownerId: OWNER }]);
      prisma.communityMember.findMany = jest.fn(async () => []);
      await authorizer.canDeleteEach('member', items);
      // One call: the viewer's own memberships. No author-role lookup, because
      // a member's answer never depends on who wrote the content.
      expect(prisma.communityMember.findMany).toHaveBeenCalledTimes(1);
    });

    it('protects an owner who has no membership row', async () => {
      prisma.community.findMany = jest.fn(async () => [{ id: COMMUNITY, ownerId: OWNER }]);
      prisma.communityMember.findMany = jest.fn(async ({ where }: any) =>
        where.userId === 'mod' ? [{ communityId: COMMUNITY, role: 'MODERATOR' }] : [],
      );
      const out = await authorizer.canDeleteEach('mod', [{ authorId: OWNER, communityId: COMMUNITY }]);
      expect(out).toEqual([false]);
    });
  });

  describe('assertCanDelete', () => {
    beforeEach(() => setup({ ...ROLES }));

    it('throws Forbidden with the same message whoever is refused', async () => {
      // The refusal must not disclose who outranks whom in a community the
      // caller may not even belong to.
      const asMod = authorizer.assertCanDelete({ actorId: 'mod', authorId: OWNER, communityId: COMMUNITY }, 'post');
      const asStranger = authorizer.assertCanDelete({ actorId: 'stranger', authorId: OWNER, communityId: COMMUNITY }, 'post');

      await expect(asMod).rejects.toThrow(ForbiddenException);
      await expect(asMod).rejects.toThrow('Not your post');
      await expect(asStranger).rejects.toThrow('Not your post');
    });

    it('names the right content type', async () => {
      await expect(
        authorizer.assertCanDelete({ actorId: 'member', authorId: 'member2', communityId: COMMUNITY }, 'comment'),
      ).rejects.toThrow('Not your comment');
    });

    it('returns the authority so the caller can word the notification', async () => {
      await expect(
        authorizer.assertCanDelete({ actorId: 'mod', authorId: 'member', communityId: COMMUNITY }, 'comment'),
      ).resolves.toBe('moderator');
    });
  });
});
