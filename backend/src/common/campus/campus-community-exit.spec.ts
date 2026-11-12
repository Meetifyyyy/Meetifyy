import type { Prisma } from '@prisma/client';
import {
  CampusCommunityOwnerError,
  campusCommunityOwnerConflict,
  getCampusCommunityStanding,
  leaveCampusCommunities,
} from './campus-community-exit';
import {
  createCampusCommunityStore,
  type FakeAffiliationFacts,
} from './testing/campus-community.fake';
import { stub } from '../testing/stub';

/**
 * Leaving the campus communities of a college whose affiliation has ended.
 * The SQL-level behaviour (row locks, the relation filters) is the lead's to
 * run on Postgres; this pins the decisions the routine makes.
 */
describe('leaveCampusCommunities', () => {
  const GLA = 'college-gla';
  const IIT = 'college-iit';
  const LEAVER = 'leaver';
  const open = { isActive: true, status: 'APPROVED', deletedAt: null };

  let affiliations: Map<string, FakeAffiliationFacts>;
  let store: ReturnType<typeof createCampusCommunityStore>;
  let tx: Prisma.TransactionClient;

  const affiliate = (
    userId: string,
    collegeId = GLA,
    overrides: Partial<FakeAffiliationFacts> = {},
  ) => {
    store.addPerson(userId);
    affiliations.set(userId, {
      collegeId,
      revokedAt: null,
      college: { ...open },
      ...overrides,
    });
  };

  beforeEach(() => {
    affiliations = new Map();
    store = createCampusCommunityStore((id) => affiliations.get(id) ?? null);
    tx = stub<Prisma.TransactionClient>(store.model);
  });

  const run = (owners: 'refuse' | 'transfer' = 'refuse') =>
    leaveCampusCommunities(tx, {
      userId: LEAVER,
      collegeId: GLA,
      owners,
    });

  it('does nothing, and takes no lock, when the person is in no campus community', async () => {
    store.addCommunity({ id: 'c1', name: 'A', collegeId: GLA });
    await expect(run()).resolves.toEqual({
      removed: [],
      transfers: [],
      unsuccessored: [],
    });
    expect(store.rawStatements).toHaveLength(0);
  });

  it('ignores deleted communities and a stray OWNER role on someone who is not the owner', async () => {
    store.addCommunity({
      id: 'gone',
      name: 'Gone',
      collegeId: GLA,
      deletedAt: new Date(),
      memberCount: 3,
    });
    store.addMember(LEAVER, 'gone');
    store.addCommunity({
      id: 'stray',
      name: 'Stray',
      collegeId: GLA,
      ownerId: 'someone-else',
      memberCount: 3,
    });
    store.addMember(LEAVER, 'stray', 'OWNER');

    const exit = await run('refuse');

    expect(exit.removed).toEqual([{ communityId: 'stray', memberCount: 2 }]);
    expect(store.roleOf(LEAVER, 'gone')).toBe('MEMBER');
    expect(store.communities.get('gone')?.memberCount).toBe(3);
  });

  it('refuses an owner before writing anything', async () => {
    store.addCommunity({
      id: 'mine',
      name: 'Mine',
      collegeId: GLA,
      ownerId: LEAVER,
      memberCount: 2,
    });
    store.addMember(LEAVER, 'mine', 'OWNER');
    store.addCommunity({
      id: 'other',
      name: 'Other',
      collegeId: GLA,
      memberCount: 2,
    });
    store.addMember(LEAVER, 'other');

    const err = await run('refuse').then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(CampusCommunityOwnerError);
    expect((err as CampusCommunityOwnerError).communities).toEqual([
      { id: 'mine', name: 'Mine' },
    ]);
    expect(store.members).toHaveLength(2);
    expect(store.communities.get('other')?.memberCount).toBe(2);
    expect(store.model.communityMember.deleteMany).not.toHaveBeenCalled();
  });

  it('never takes a count below zero', async () => {
    store.addCommunity({
      id: 'c1',
      name: 'A',
      collegeId: GLA,
      memberCount: 0,
    });
    store.addMember(LEAVER, 'c1');

    const exit = await run();

    expect(exit.removed).toEqual([{ communityId: 'c1', memberCount: 0 }]);
    expect(store.communities.get('c1')?.memberCount).toBe(0);
  });

  it('counts only a row it removed itself', async () => {
    // The person is the owner of record with no member row (the detail page
    // synthesises one): handing it over removes no row, so no count moves.
    affiliate('heir');
    store.addCommunity({
      id: 'c1',
      name: 'A',
      collegeId: GLA,
      ownerId: LEAVER,
      memberCount: 4,
    });
    store.addMember('heir', 'c1');

    const exit = await run('transfer');

    expect(exit.removed).toEqual([]);
    expect(exit.transfers).toEqual([
      { communityId: 'c1', communityName: 'A', newOwnerId: 'heir' },
    ]);
    expect(store.communities.get('c1')?.memberCount).toBe(4);
  });

  describe('choosing a successor', () => {
    const setup = () => {
      store.addCommunity({
        id: 'c1',
        name: 'A',
        collegeId: GLA,
        ownerId: LEAVER,
        memberCount: 9,
      });
      store.addMember(LEAVER, 'c1', 'OWNER');
    };
    const candidate = (
      id: string,
      role: 'MODERATOR' | 'MEMBER',
      joined: string,
    ) => {
      affiliate(id);
      store.addMember(id, 'c1', role, new Date(joined));
    };

    it('takes the longest-serving moderator over any member', async () => {
      setup();
      candidate('old-member', 'MEMBER', '2024-01-01');
      candidate('mod-b', 'MODERATOR', '2025-06-01');
      candidate('mod-a', 'MODERATOR', '2025-01-01');

      const exit = await run('transfer');

      expect(exit.transfers[0].newOwnerId).toBe('mod-a');
      expect(store.roleOf('mod-a', 'c1')).toBe('OWNER');
      expect(store.communities.get('c1')?.ownerId).toBe('mod-a');
      expect(store.roleOf(LEAVER, 'c1')).toBeNull();
      expect(store.communities.get('c1')?.memberCount).toBe(8);
    });

    it('takes the longest-serving member when there is no moderator', async () => {
      setup();
      candidate('newer', 'MEMBER', '2025-06-01');
      candidate('older', 'MEMBER', '2025-01-01');

      expect((await run('transfer')).transfers[0].newOwnerId).toBe('older');
    });

    it('breaks a tie on joining time by user id', async () => {
      setup();
      candidate('b', 'MEMBER', '2025-01-01');
      candidate('a', 'MEMBER', '2025-01-01');

      expect((await run('transfer')).transfers[0].newOwnerId).toBe('a');
    });

    it.each([
      [
        'revoked affiliation',
        () => affiliate('x', GLA, { revokedAt: new Date() }),
      ],
      ['another college', () => affiliate('x', IIT)],
      [
        'a closed college',
        () =>
          affiliate('x', GLA, {
            college: { ...open, isActive: false },
          }),
      ],
      [
        'a college no longer approved',
        () => affiliate('x', GLA, { college: { ...open, status: 'DISABLED' } }),
      ],
      ['no affiliation at all', () => store.addPerson('x')],
      [
        'a deleted account',
        () => {
          affiliate('x');
          store.addPerson('x', { deletedAt: new Date() });
        },
      ],
      [
        'a suspended account',
        () => {
          affiliate('x');
          store.addPerson('x', { accountStatus: 'SUSPENDED' });
        },
      ],
      [
        'an unverified account',
        () => {
          affiliate('x');
          store.addPerson('x', { verificationStatus: 'UNVERIFIED' });
        },
      ],
    ])('never picks someone with %s', async (_label, make) => {
      setup();
      make();
      // The disqualified person is a moderator who joined first.
      store.addMember('x', 'c1', 'MODERATOR', new Date('2020-01-01'));
      candidate('fine', 'MEMBER', '2025-01-01');

      expect((await run('transfer')).transfers[0].newOwnerId).toBe('fine');
    });

    it('leaves ownership, membership and count alone when nobody qualifies', async () => {
      setup();
      candidate('elsewhere', 'MODERATOR', '2025-01-01');
      affiliate('elsewhere', IIT);
      store.addCommunity({
        id: 'c2',
        name: 'B',
        collegeId: GLA,
        memberCount: 5,
      });
      store.addMember(LEAVER, 'c2');

      const exit = await run('transfer');

      expect(exit).toEqual({
        removed: [{ communityId: 'c2', memberCount: 4 }],
        transfers: [],
        unsuccessored: ['c1'],
      });
      expect(store.communities.get('c1')?.ownerId).toBe(LEAVER);
      expect(store.roleOf(LEAVER, 'c1')).toBe('OWNER');
      expect(store.communities.get('c1')?.memberCount).toBe(9);
    });
  });

  it('locks every affected community, in id order, before reading roles', async () => {
    store.addCommunity({ id: 'b', name: 'A', collegeId: GLA });
    store.addCommunity({ id: 'a', name: 'B', collegeId: GLA });
    store.addMember(LEAVER, 'a');
    store.addMember(LEAVER, 'b');

    await run();

    expect(store.rawStatements).toHaveLength(1);
    expect(store.rawStatements[0].text).toBe(
      'SELECT "id" FROM "Community" WHERE "id" IN (?) ORDER BY "id" FOR UPDATE',
    );
    // Bound in name order; the ORDER BY makes the lock order id order.
    expect(store.rawStatements[0].values).toEqual([['b', 'a']]);
    const lockOrder = store.model.$queryRaw.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(
      store.model.communityMember.deleteMany.mock.invocationCallOrder[0],
    );
  });
});

describe('getCampusCommunityStanding', () => {
  it('counts memberships and lists communities owned, once each', async () => {
    const store = createCampusCommunityStore(() => null);
    store.addCommunity({
      id: 'c1',
      name: 'Zeta',
      collegeId: 'g',
      ownerId: 'u',
    });
    store.addMember('u', 'c1', 'OWNER');
    store.addCommunity({ id: 'c2', name: 'Alpha', collegeId: 'g' });
    store.addMember('u', 'c2');
    // The owner of record without a member row counts as owning only.
    store.addCommunity({
      id: 'c3',
      name: 'Mid',
      collegeId: 'g',
      ownerId: 'u',
    });
    store.addCommunity({ id: 'c4', name: 'Other', collegeId: 'h' });
    store.addMember('u', 'c4');

    await expect(
      getCampusCommunityStanding(
        stub<Prisma.TransactionClient>(store.model),
        'u',
        'g',
      ),
    ).resolves.toEqual({
      joinedCount: 2,
      owned: [
        { id: 'c3', name: 'Mid' },
        { id: 'c1', name: 'Zeta' },
      ],
    });
  });
});

describe('campusCommunityOwnerConflict', () => {
  it('words a removal and a switch differently and carries the list', () => {
    const list = [
      { id: '1', name: 'A' },
      { id: '2', name: 'B' },
    ];
    expect(
      campusCommunityOwnerConflict('GLA', list, 'remove').getResponse(),
    ).toEqual({
      statusCode: 409,
      code: 'CAMPUS_COMMUNITY_OWNER',
      message:
        'You own campus communities at GLA. Transfer ownership of A, B before removing your campus.',
      communities: list,
    });
    expect(
      campusCommunityOwnerConflict('GLA', list, 'switch').getResponse(),
    ).toMatchObject({
      message:
        'You own campus communities at GLA. Transfer ownership of A, B before switching your campus.',
    });
  });
});
