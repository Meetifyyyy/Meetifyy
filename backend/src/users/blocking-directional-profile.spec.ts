import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { createBlocksServiceMock } from './testing/blocks.service.mock';

/**
 * Blocking a profile is DIRECTIONAL.
 *
 * It used to refuse both sides: `isBlocked` answers "is this pair related by a
 * block", so the person who placed the block lost access to the profile they
 * blocked, exactly as the blocked user did. That was the safer-looking rule and
 * the wrong one. Refusing the blocker protects nobody — it hides a decision
 * they made themselves and gives them no way to review it — and making the pair
 * symmetric leaks: a user could infer they had been blocked by noticing that a
 * profile they had blocked was now unreachable in the same way.
 *
 * So: the blocker keeps access, the blocked user is refused, and the refusal is
 * indistinguishable from a profile that never existed.
 */
describe('UsersService — directional profile access', () => {
  const BLOCKER = 'user-blocker';
  const BLOCKED = 'user-blocked';

  const buildService = (blocks: { blockerId: string; blockedId: string }[]) => {
    const blocksService = createBlocksServiceMock(blocks);

    const targetRow = {
      id: BLOCKED,
      username: 'blocked-user',
      displayName: 'Blocked User',
      isCampusRep: false,
      avatar: null,
      bio: null,
      college: null,
      course: null,
      branch: null,
      passingYear: null,
      profileCompleted: true,
      deletedAt: null,
      batchYear: null,
      settings: { showOnlineStatus: false, whoCanSeeOnline: 'nobody' },
    };

    const prisma: any = {
      user: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === BLOCKED
            ? targetRow
            : { ...targetRow, id: BLOCKER, username: 'blocker-user' },
        ),
      },
    };

    const service = Object.create(UsersService.prototype);
    service.prisma = prisma;
    service.blocksService = blocksService;
    service.studentYearPolicy = {
      visibleUserWhere: () => ({}),
      getBatchYearFor: async () => null,
      canIdsInteract: async () => true,
      canCreateMessage: () => true,
    };
    // Presence is resolved separately and is not the subject here.
    service.presenceService = { getPresence: async () => null };
    return service;
  };

  describe('when A has blocked B', () => {
    const blocks = [{ blockerId: BLOCKER, blockedId: BLOCKED }];

    it('lets the BLOCKER open the profile they blocked', async () => {
      const service = buildService(blocks);
      const profile = await service.getUserById(BLOCKED, BLOCKER);
      expect(profile.id).toBe(BLOCKED);
    });

    it('tells the blocker it is blocked, so the button can say so', async () => {
      const service = buildService(blocks);
      const profile = await service.getUserById(BLOCKED, BLOCKER);
      expect(profile.blockedByMe).toBe(true);
    });

    it('refuses the BLOCKED user the blocker’s profile', async () => {
      const service = buildService(blocks);
      await expect(
        service.getUserById(BLOCKER, BLOCKED),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    /**
     * The refusal must read as "no such profile". A distinct message or status
     * would let someone tell being blocked apart from a username that never
     * existed, which is the disclosure the neutral 404 exists to prevent.
     */
    it('refuses with the same answer a missing profile gives', async () => {
      const service = buildService(blocks);
      const blockedAttempt = await service
        .getUserById(BLOCKER, BLOCKED)
        .catch((e: any) => e);

      const missingService = buildService(blocks);
      missingService.prisma.user.findUnique = jest.fn(async () => null);
      const missingAttempt = await missingService
        .getUserById('no-such-user', BLOCKED)
        .catch((e: any) => e);

      expect(blockedAttempt).toBeInstanceOf(NotFoundException);
      expect(missingAttempt).toBeInstanceOf(NotFoundException);
      expect(blockedAttempt.message).toBe(missingAttempt.message);
      expect(blockedAttempt.getStatus()).toBe(missingAttempt.getStatus());
    });
  });

  describe('when there is no block', () => {
    it('lets both users see each other, with no blocked flag', async () => {
      const service = buildService([]);
      const a = await service.getUserById(BLOCKED, BLOCKER);
      const b = await service.getUserById(BLOCKER, BLOCKED);
      expect(a.blockedByMe).toBe(false);
      expect(b.blockedByMe).toBe(false);
    });
  });

  describe('when B has also blocked A', () => {
    const mutual = [
      { blockerId: BLOCKER, blockedId: BLOCKED },
      { blockerId: BLOCKED, blockedId: BLOCKER },
    ];

    /**
     * Each is somebody's blocker and somebody's blocked at once. Being blocked
     * wins: a user who blocked you must not become reachable just because you
     * blocked them back.
     */
    it('refuses both, because each has been blocked by the other', async () => {
      const service = buildService(mutual);
      await expect(
        service.getUserById(BLOCKED, BLOCKER),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.getUserById(BLOCKER, BLOCKED),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('never applies a block to the user viewing their own profile', async () => {
    const service = buildService([{ blockerId: BLOCKER, blockedId: BLOCKED }]);
    const own = await service.getUserById(BLOCKER, BLOCKER);
    expect(own.blockedByMe).toBe(false);
  });
});
