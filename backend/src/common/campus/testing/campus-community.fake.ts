/**
 * An in-memory stand-in for the community tables that `leaveCampusCommunities`
 * and `getCampusCommunityStanding` touch, for specs.
 *
 * Each method reads the exact `where` fields the production query sends, so a
 * query whose shape drifts (a dropped `deletedAt`, a different role filter)
 * finds nothing here and the spec fails, rather than the fake quietly
 * accepting it. Everything is wrapped in `jest.fn` so a spec can also assert
 * what was called.
 */

export type FakeRole = 'OWNER' | 'MODERATOR' | 'MEMBER';

export interface FakeCommunity {
  id: string;
  name: string;
  collegeId: string | null;
  isCampusCommunity: boolean;
  deletedAt: Date | null;
  ownerId: string | null;
  memberCount: number;
}

export interface FakeMember {
  userId: string;
  communityId: string;
  role: FakeRole;
  joinedAt: Date;
}

export interface FakeJoinRequest {
  id: string;
  communityId: string;
  userId: string;
  status: 'PENDING' | 'DECLINED';
}

/** The account facts a successor must satisfy. */
export interface FakePerson {
  id: string;
  deletedAt: Date | null;
  accountStatus: string;
  verificationStatus: string;
}

/** The affiliation as `collegeAffiliation: { is: … }` is evaluated. */
export interface FakeAffiliationFacts {
  collegeId: string;
  revokedAt: Date | null;
  college: { isActive: boolean; status: string; deletedAt: Date | null };
}

interface SuccessorWhere {
  communityId: string;
  role: FakeRole;
  userId: { not: string };
  user: {
    deletedAt: null;
    accountStatus: string;
    verificationStatus: string;
    collegeAffiliation: {
      is: {
        collegeId: string;
        revokedAt: null;
        college: { isActive: boolean; status: string; deletedAt: null };
      };
    };
  };
}

interface StandingWhere {
  isCampusCommunity: boolean;
  collegeId: string;
  deletedAt: null;
  OR: [{ ownerId: string }, { members: { some: { userId: string } } }];
}

export function createCampusCommunityStore(
  affiliationFor: (userId: string) => FakeAffiliationFacts | null,
) {
  const communities = new Map<string, FakeCommunity>();
  const members: FakeMember[] = [];
  const joinRequests: FakeJoinRequest[] = [];
  const people = new Map<string, FakePerson>();
  /** The text and bound values of every raw statement, in order. */
  const rawStatements: Array<{ text: string; values: unknown[] }> = [];

  const membersOf = (communityId: string) =>
    members.filter((m) => m.communityId === communityId);

  const model = {
    community: {
      findMany: jest.fn(({ where }: { where: StandingWhere }) => {
        const ownerId = where.OR[0].ownerId;
        const memberId = where.OR[1].members.some.userId;
        const rows = [...communities.values()]
          .filter(
            (c) =>
              c.isCampusCommunity === where.isCampusCommunity &&
              c.collegeId === where.collegeId &&
              c.deletedAt === where.deletedAt &&
              (c.ownerId === ownerId ||
                membersOf(c.id).some((m) => m.userId === memberId)),
          )
          .sort(
            (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
          );
        return Promise.resolve(
          rows.map((c) => ({
            id: c.id,
            name: c.name,
            ownerId: c.ownerId,
            members: membersOf(c.id)
              .filter((m) => m.userId === memberId)
              .map((m) => ({ userId: m.userId })),
          })),
        );
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: { ownerId: string };
        }) => {
          const c = communities.get(where.id)!;
          c.ownerId = data.ownerId;
          return Promise.resolve(c);
        },
      ),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string; memberCount: { gt: number } };
          data: { memberCount: { decrement: number } };
        }) => {
          const c = communities.get(where.id);
          if (!c || !(c.memberCount > where.memberCount.gt)) {
            return Promise.resolve({ count: 0 });
          }
          c.memberCount -= data.memberCount.decrement;
          return Promise.resolve({ count: 1 });
        },
      ),
      findUnique: jest.fn(({ where }: { where: { id: string } }) => {
        const c = communities.get(where.id);
        return Promise.resolve(c ? { memberCount: c.memberCount } : null);
      }),
    },
    communityMember: {
      findFirst: jest.fn(({ where }: { where: SuccessorWhere }) => {
        const w = where.user;
        const is = w.collegeAffiliation.is;
        const rows = membersOf(where.communityId)
          .filter((m) => {
            if (m.role !== where.role || m.userId === where.userId.not) {
              return false;
            }
            const person = people.get(m.userId);
            const aff = affiliationFor(m.userId);
            return (
              !!person &&
              person.deletedAt === w.deletedAt &&
              person.accountStatus === w.accountStatus &&
              person.verificationStatus === w.verificationStatus &&
              !!aff &&
              aff.collegeId === is.collegeId &&
              aff.revokedAt === is.revokedAt &&
              aff.college.isActive === is.college.isActive &&
              aff.college.status === is.college.status &&
              aff.college.deletedAt === is.college.deletedAt
            );
          })
          .sort(
            (a, b) =>
              a.joinedAt.getTime() - b.joinedAt.getTime() ||
              a.userId.localeCompare(b.userId),
          );
        return Promise.resolve(rows[0] ? { userId: rows[0].userId } : null);
      }),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { userId: string; communityId: string };
          data: { role: FakeRole };
        }) => {
          const rows = members.filter(
            (m) =>
              m.userId === where.userId && m.communityId === where.communityId,
          );
          for (const row of rows) row.role = data.role;
          return Promise.resolve({ count: rows.length });
        },
      ),
      deleteMany: jest.fn(
        ({ where }: { where: { userId: string; communityId: string } }) => {
          let count = 0;
          for (let i = members.length - 1; i >= 0; i--) {
            if (
              members[i].userId === where.userId &&
              members[i].communityId === where.communityId
            ) {
              members.splice(i, 1);
              count++;
            }
          }
          return Promise.resolve({ count });
        },
      ),
    },
    communityJoinRequest: {
      deleteMany: jest.fn(
        ({
          where,
        }: {
          where: {
            userId: string;
            status: string;
            community: { isCampusCommunity: boolean; collegeId: string };
          };
        }) => {
          let count = 0;
          for (let i = joinRequests.length - 1; i >= 0; i--) {
            const r = joinRequests[i];
            const c = communities.get(r.communityId);
            if (
              r.userId === where.userId &&
              r.status === where.status &&
              c?.isCampusCommunity === where.community.isCampusCommunity &&
              c.collegeId === where.community.collegeId
            ) {
              joinRequests.splice(i, 1);
              count++;
            }
          }
          return Promise.resolve({ count });
        },
      ),
    },
    /** The row lock; records the statement for assertions. */
    $queryRaw: jest.fn(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        rawStatements.push({
          text: strings.join('?').replace(/\s+/g, ' ').trim(),
          values: values.map((v) =>
            v && typeof v === 'object' && 'values' in v
              ? (v as { values: unknown[] }).values
              : v,
          ),
        });
        return Promise.resolve([]);
      },
    ),
  };

  return {
    communities,
    members,
    joinRequests,
    people,
    rawStatements,
    model,
    addCommunity(
      c: Partial<FakeCommunity> & { id: string; name: string },
    ): FakeCommunity {
      const row: FakeCommunity = {
        collegeId: null,
        isCampusCommunity: true,
        deletedAt: null,
        ownerId: null,
        memberCount: 0,
        ...c,
      };
      communities.set(row.id, row);
      return row;
    },
    addMember(
      userId: string,
      communityId: string,
      role: FakeRole = 'MEMBER',
      joinedAt = new Date('2026-01-01T00:00:00Z'),
    ) {
      members.push({ userId, communityId, role, joinedAt });
    },
    addPerson(id: string, overrides: Partial<FakePerson> = {}) {
      people.set(id, {
        id,
        deletedAt: null,
        accountStatus: 'ACTIVE',
        verificationStatus: 'VERIFIED',
        ...overrides,
      });
    },
    roleOf(userId: string, communityId: string): FakeRole | null {
      return (
        members.find(
          (m) => m.userId === userId && m.communityId === communityId,
        )?.role ?? null
      );
    },
  };
}

export type CampusCommunityStore = ReturnType<
  typeof createCampusCommunityStore
>;
