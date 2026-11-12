import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * What happens to a person's campus communities when their campus ends.
 *
 * A campus community belongs to one college and is open only to people who hold
 * an active affiliation with it. When an affiliation ends (removed, switched to
 * another college, revoked or released by an admin) the person leaves every
 * campus community of the college they left, in the same transaction, so the
 * rest of the app never sees a member who no longer belongs. The read-time rule
 * in `posts/community-visibility.ts` stays as the second line of defence.
 *
 * Lives here, free of the community and affiliation services, so both can use
 * it without a module cycle. It only needs a transaction client; the cache and
 * realtime side effects of a leave are the caller's, after the commit (see
 * `CommunitiesService.announceCampusExit`).
 */

type Db = PrismaService | Prisma.TransactionClient;

export interface CampusCommunityRef {
  id: string;
  name: string;
}

/** Why the exit was refused: the person still owns these communities. */
export class CampusCommunityOwnerError extends Error {
  constructor(readonly communities: CampusCommunityRef[]) {
    super('Owner of campus communities');
    this.name = 'CampusCommunityOwnerError';
  }
}

/** How owned communities are treated. */
export type CampusOwnerPolicy =
  /** The person must hand them over first: throws CampusCommunityOwnerError. */
  | 'refuse'
  /** Admin action, which cannot be refused: pass them to a successor. */
  | 'transfer';

/** The result of an exit, for the caller's after-commit side effects. */
export interface CampusCommunityExit {
  /** Memberships deleted, with each community's member count afterwards. */
  removed: Array<{ communityId: string; memberCount: number }>;
  /** Ownership handed to a successor (admin path only). */
  transfers: Array<{
    communityId: string;
    communityName: string;
    newOwnerId: string;
  }>;
  /**
   * Communities whose owner could not be replaced because nobody at the
   * college qualified. The owner keeps both `ownerId` and their membership
   * there: dropping only the membership would leave an owner who is not a
   * member, which the boot-time owner repair re-adds without counting them.
   */
  unsuccessored: string[];
}

export const EMPTY_CAMPUS_COMMUNITY_EXIT: CampusCommunityExit = {
  removed: [],
  transfers: [],
  unsuccessored: [],
};

/** A person's standing in the live campus communities of one college. */
export interface CampusCommunityStanding {
  /** Communities they hold a membership row in. */
  joinedCount: number;
  /** Communities whose `ownerId` is them (a transfer is needed to leave). */
  owned: CampusCommunityRef[];
}

/**
 * Every live campus community of `collegeId` the person belongs to or owns.
 * One statement (relation joins), also run inside the exit under its locks.
 *
 * The owner is matched on `ownerId`, not only on a membership row: an owner
 * can lack a member row (the community detail synthesises one), and a stray
 * OWNER row on someone who is not `ownerId` owns nothing — the same test
 * `transferOwnership` applies.
 */
async function loadStanding(db: Db, userId: string, collegeId: string) {
  const rows = await db.community.findMany({
    where: {
      isCampusCommunity: true,
      collegeId,
      deletedAt: null,
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    select: {
      id: true,
      name: true,
      ownerId: true,
      members: { where: { userId }, select: { userId: true } },
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    isOwner: row.ownerId === userId,
    isMember: row.members.length > 0,
  }));
}

/** For the settings screen and the early refusals; never writes. */
export async function getCampusCommunityStanding(
  db: Db,
  userId: string,
  collegeId: string,
): Promise<CampusCommunityStanding> {
  const rows = await loadStanding(db, userId, collegeId);
  return {
    joinedCount: rows.filter((r) => r.isMember).length,
    owned: rows
      .filter((r) => r.isOwner)
      .map((r) => ({ id: r.id, name: r.name })),
  };
}

/**
 * The 409 for an owner who tries to end their campus. The old installed app
 * shows `message` as it is; newer clients read `communities` to list them.
 */
export function campusCommunityOwnerConflict(
  collegeName: string,
  communities: CampusCommunityRef[],
  action: 'remove' | 'switch',
): ConflictException {
  const names = communities.map((c) => c.name).join(', ');
  const verb = action === 'switch' ? 'switching' : 'removing';
  return new ConflictException({
    statusCode: 409,
    code: 'CAMPUS_COMMUNITY_OWNER',
    message: `You own campus communities at ${collegeName}. Transfer ownership of ${names} before ${verb} your campus.`,
    communities,
  });
}

/**
 * The member who inherits a community: the longest-serving MODERATOR, else the
 * longest-serving MEMBER (by when they joined), among people who still hold an
 * active affiliation with the college and an account that may own a community
 * (the gate `transferOwnership` applies to a new owner). Null when nobody
 * qualifies.
 */
export async function findSuccessor(
  tx: Prisma.TransactionClient,
  communityId: string,
  collegeId: string,
  leavingUserId: string,
): Promise<string | null> {
  for (const role of ['MODERATOR', 'MEMBER'] as const) {
    const row = await tx.communityMember.findFirst({
      where: {
        communityId,
        role,
        userId: { not: leavingUserId },
        user: {
          deletedAt: null,
          accountStatus: 'ACTIVE',
          verificationStatus: 'VERIFIED',
          collegeAffiliation: {
            is: {
              collegeId,
              revokedAt: null,
              college: {
                isActive: true,
                status: 'APPROVED',
                deletedAt: null,
              },
            },
          },
        },
      },
      orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }],
      select: { userId: true },
    });
    if (row) return row.userId;
  }
  return null;
}

/**
 * Removes `userId` from every live campus community of `collegeId`, inside the
 * caller's transaction (the one that also changes the affiliation).
 *
 *  - The affected community rows are locked first, in id order, so a
 *    concurrent ownership transfer or admin succession is serialised with
 *    this and what is read below is what is acted on.
 *  - Owned communities: `refuse` throws before anything is written;
 *    `transfer` promotes a successor (see `findSuccessor`) and the previous
 *    owner is removed with the rest.
 *  - Each membership is deleted on its own and a community's `memberCount` is
 *    decremented only for a row this call actually removed (never below 0), so
 *    a leave that raced in cannot be counted twice.
 *  - The person's PENDING join requests to campus communities of the college
 *    are deleted, joined or not.
 */
export async function leaveCampusCommunities(
  tx: Prisma.TransactionClient,
  input: { userId: string; collegeId: string; owners: CampusOwnerPolicy },
): Promise<CampusCommunityExit> {
  const { userId, collegeId, owners } = input;

  const found = await loadStanding(tx, userId, collegeId);
  if (found.length === 0) return EMPTY_CAMPUS_COMMUNITY_EXIT;

  const ids = found.map((r) => r.id);
  await tx.$queryRaw`
    SELECT "id" FROM "Community"
    WHERE "id" IN (${Prisma.join(ids)})
    ORDER BY "id"
    FOR UPDATE`;

  // Re-read under the locks: ownership may have changed since the first look.
  const rows = await loadStanding(tx, userId, collegeId);
  const owned = rows.filter((r) => r.isOwner);
  if (owned.length > 0 && owners === 'refuse') {
    throw new CampusCommunityOwnerError(
      owned.map((r) => ({ id: r.id, name: r.name })),
    );
  }

  const transfers: CampusCommunityExit['transfers'] = [];
  const unsuccessored: string[] = [];
  for (const community of owned) {
    const successor = await findSuccessor(tx, community.id, collegeId, userId);
    // Promote the member before pointing `ownerId` at them, so a member who
    // left a moment ago can never end up as an owner without a row.
    const promoted = successor
      ? await tx.communityMember.updateMany({
          where: { userId: successor, communityId: community.id },
          data: { role: 'OWNER' },
        })
      : { count: 0 };
    if (!successor || promoted.count === 0) {
      unsuccessored.push(community.id);
      continue;
    }
    await tx.community.update({
      where: { id: community.id },
      data: { ownerId: successor },
    });
    transfers.push({
      communityId: community.id,
      communityName: community.name,
      newOwnerId: successor,
    });
  }

  const staying = new Set(unsuccessored);
  const removed: CampusCommunityExit['removed'] = [];
  for (const community of rows) {
    if (staying.has(community.id) || !community.isMember) continue;
    const gone = await tx.communityMember.deleteMany({
      where: { userId, communityId: community.id },
    });
    if (gone.count === 0) continue;
    // `gt: 0` keeps a count that was already wrong from going negative.
    await tx.community.updateMany({
      where: { id: community.id, memberCount: { gt: 0 } },
      data: { memberCount: { decrement: 1 } },
    });
    const after = await tx.community.findUnique({
      where: { id: community.id },
      select: { memberCount: true },
    });
    removed.push({
      communityId: community.id,
      memberCount: Math.max(0, after?.memberCount ?? 0),
    });
  }

  // By college, not by the communities found above: a request to a campus
  // community the person never joined is just as dead once the campus ends.
  await tx.communityJoinRequest.deleteMany({
    where: {
      userId,
      status: 'PENDING',
      community: { isCampusCommunity: true, collegeId },
    },
  });

  return { removed, transfers, unsuccessored };
}
