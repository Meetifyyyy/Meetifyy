import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isSafeCoverCss, looksLikeCoverCss } from './cover-css.util';
import { Gender, Prisma, UserRole, VerificationStatus } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { DomainEventService } from '../events/domain-event.service';
import { RedisService } from '../redis/redis.service';
import { BlocksService } from './blocks.service';
import { VerificationAccessService } from '../common/verification/verification-access.service';
import { PresenceService } from '../presence/presence.service';
import {
  checkPresenceVisibility,
  resolvePresenceVisibilityForViewer,
} from './privacy.helper';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  NOTIFICATIONS_QUEUE,
  FollowNotifJob,
} from '../notifications/notifications.processor';
import { clearAuthSyncCache } from '../auth/auth.service';
import { pickReason } from './follow-recommendation.scoring';
import {
  PickerSocial,
  closestIds,
  matchTier,
  rankPickerCandidates,
  startsWithWhere,
} from './people-picker';
import { weightedSample } from '../common/utils/weighted-sample.util';
import { validateBirthday } from '../common/utils/birthday-validation.util';
import { AcademicsService } from '../academics/academics.service';
import { MediaCleanupService } from '../uploads/media-cleanup.service';
import {
  isReservedUsername,
  RESERVED_USERNAME_MESSAGE,
} from '../common/users/reserved-usernames';
import { conversationListFirstPageKeys } from '../messages/conversation-list-cache';
import {
  ACTIVE_AFFILIATION_SELECT,
  activeAffiliationCollegeId,
} from '../common/campus/campus-access.service';
import { activeAffiliationCollegeIdSql } from '../common/campus/campus-affiliation.sql';

/** The follow CTE's single row (see followUser). */
interface FollowCteRow {
  targetId: string;
  targetUsername: string;
  targetDisplayName: string;
  targetAvatar: string | null;
  followerUsername: string;
  followerDisplayName: string;
  followerAvatar: string | null;
  isBlocked: boolean;
  newlyFollowed: boolean;
  targetFollowers: number;
  targetFollowing: number;
  currentFollowing: number;
}

/** The unfollow CTE's single row (see unfollowUser). */
interface UnfollowCteRow {
  targetId: string;
  targetUsername: string;
  unfollowed: boolean;
  targetFollowers: number;
  targetFollowing: number;
  currentFollowing: number;
}

/** One row of the followers / following lists. */
interface FollowListRow {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  bio: string | null;
  role: UserRole;
  isFollowing: boolean;
}

/** One candidate of the follow recommendations query. */
interface RecommendationRow {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  bio: string | null;
  isCampusRep: boolean;
  collegeId: string | null;
  collegeName: string | null;
  verificationStatus: VerificationStatus;
  mutualCount: number;
  followerCount: number;
  sameCollege: boolean;
  sameBranch: boolean;
  followsMe: boolean;
  sharedCommunities: number;
  sharedInterests: number;
  score: number;
  mutualSampleName: string | null;
}

/** Columns of the share/invite "people" picker (see getConnections). */
const CONNECTION_SELECT = {
  id: true,
  username: true,
  displayName: true,
  isCampusRep: true,
  collegeId: true,
  college: { select: { id: true, name: true } },
  avatar: true,
} satisfies Prisma.UserSelect;

/** First occurrence of each id, in order. */
function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

/** A getConnections entry, as served and as cached for 20 s. */
type ConnectionUser = Prisma.UserGetPayload<{
  select: typeof CONNECTION_SELECT;
}>;

/** A body value as a log line shows it: '-' when absent, JSON when not a primitive. */
function logValue(value: unknown): string {
  if (value === undefined || value === null) return '-';
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : JSON.stringify(value);
}

/** What PATCH /api/users/me returns: the profile as the client renders it. */
const PROFILE_UPDATE_SELECT = {
  id: true,
  username: true,
  displayName: true,
  isCampusRep: true,
  avatar: true,
  collegeId: true,
  college: { select: { id: true, name: true } },
  cover: true,
  bio: true,
  birthday: true,
  course: true,
  branch: true,
  passingYear: true,
  location: true,
  interests: true,
  profileCompleted: true,
  gender: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

/** The scalar profile columns a profile update may write. */
type ProfileScalarWrite = {
  displayName?: string;
  username?: string;
  bio?: string;
  birthday?: string;
  avatar?: string | null;
  cover?: string | null;
  course?: string;
  branch?: string;
  passingYear?: number;
  location?: string | null;
  profileCompleted?: boolean;
  interests?: string[];
  gender?: Gender | null;
};

/**
 * An avatar or cover value from the body: `undefined` when not sent, `null` to
 * clear it (any falsy value, as before), otherwise the string reference. A
 * non-string used to reach Prisma and fail as a 500; it is a 400 now.
 */
function mediaRefInput(
  value: unknown,
  field: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (!value) return null;
  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} must be a string`);
  }
  return value;
}

/** A link from the profile to the Media row behind a reference. */
type MediaLink =
  | { connect: { objectKey: string } }
  | {
      connectOrCreate: {
        where: { objectKey: string };
        create: {
          provider: string;
          bucket: string;
          objectKey: string;
          mimeType: string;
          fileSize: number;
          ownerId: string;
        };
      };
    };

/**
 * How the avatar/cover relation changes for a submitted reference.
 *
 * Always Prisma's relation (checked) input — never the raw `…MediaId` column.
 * Mixing the two in one write is rejected by Prisma, and a profile save can
 * clear one image while setting the other. `create` is what a brand-new row
 * gets: a link, or nothing (there is nothing to disconnect yet).
 *
 * A reference that is neither an uploaded key nor an external URL (a CSS
 * gradient cover, a bare key) links nothing and leaves the relation alone, as
 * it always has.
 */
function mediaRelationWrite(
  ref: string | null | undefined,
  userId: string,
):
  { update: MediaLink | { disconnect: true }; create?: MediaLink } | undefined {
  if (ref === undefined) return undefined;
  if (ref === null) return { update: { disconnect: true } };
  let link: MediaLink | undefined;
  if (ref.startsWith('/api/media/')) {
    link = { connect: { objectKey: ref.replace('/api/media/', '') } };
  } else if (ref.startsWith('http')) {
    link = {
      connectOrCreate: {
        where: { objectKey: ref },
        create: {
          provider: 'external',
          bucket: 'external',
          objectKey: ref,
          mimeType: 'image/jpeg',
          fileSize: 0,
          ownerId: userId,
        },
      },
    };
  }
  return link ? { update: link, create: link } : undefined;
}

/**
 * The address a brand-new row falls back to when the token carries no real
 * one: the body's `email` if it sent a usable one, else a placeholder. Only
 * read in that case, so an odd value elsewhere is never looked at.
 */
/**
 * People who are members of a college for listing purposes: an active (not
 * revoked) CollegeAffiliation to that college. The college itself is open by
 * construction — the caller reached here through CampusAccessService, which
 * checked that same college.
 */
function campusMemberWhere(collegeId: string): Prisma.UserWhereInput {
  return { collegeAffiliation: { is: { collegeId, revokedAt: null } } };
}

/**
 * A body `email` is type-checked and otherwise ignored. See updateProfile.
 */
function assertBodyEmailType(email: unknown): void {
  if (email !== undefined && email !== null && typeof email !== 'string') {
    throw new BadRequestException('email must be a string');
  }
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger('UsersService');
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationFactory: NotificationFactory,
    private readonly domainEventService: DomainEventService,
    private readonly redisService: RedisService,
    private readonly blocksService: BlocksService,
    private readonly presenceService: PresenceService,
    private readonly academicsService: AcademicsService,
    private readonly verificationAccess: VerificationAccessService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly notifQueue: Queue,
    @Optional() private readonly mediaCleanupService?: MediaCleanupService,
  ) {}

  /**
   * Directory-style listing of users.
   *
   * Took no viewer, so it neither excluded blocked users nor applied anyone's
   * presence settings — it selected `settings` and then ignored them, returning
   * `isOnline` for every row to every caller. Both sides of a block could watch
   * each other's status here.
   */
  /**
   * Which of `targetIds` the viewer already follows, as a Set.
   *
   * ONE query for the whole page, keyed on the `Follow` primary key
   * `(followerId, followingId)`, so the cost does not grow with how many
   * accounts the viewer follows — a viewer with 10 follows and a viewer with
   * 10,000 both do a single index probe per candidate. This is deliberately
   * NOT "fetch my following list and check membership client-side": that
   * pattern is what made follow state depend on a `.limit()` further up the
   * stack, so an account past the limit was silently reported as not-followed.
   *
   * Every list endpoint that renders a follow button goes through here, so
   * there is exactly one definition of "does the viewer follow this row".
   */
  private async getFollowingSet(
    viewerId: string | undefined | null,
    targetIds: string[],
  ): Promise<Set<string>> {
    if (!viewerId || targetIds.length === 0) return new Set<string>();
    const rows = await this.prisma.follow.findMany({
      where: { followerId: viewerId, followingId: { in: targetIds } },
      select: { followingId: true },
    });
    return new Set(rows.map((r) => r.followingId));
  }

  async getAllUsers(limit: number, offset: number, currentUserId?: string) {
    const where = await this.blocksService.injectBlockFilter(
      currentUserId,
      {
        accountStatus: 'ACTIVE',
        deletedAt: null,
      } satisfies Prisma.UserWhereInput,
      'id',
    );
    const users = await this.prisma.user.findMany({
      where,
      take: limit,
      skip: offset,
      select: {
        id: true,
        username: true,
        displayName: true,
        isCampusRep: true,
        avatar: true,
        bio: true,
        collegeId: true,
        college: { select: { id: true, name: true } },
        course: true,
        branch: true,
        passingYear: true,
        settings: {
          select: {
            showOnlineStatus: true,
            whoCanSeeOnline: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const userIds = users.map((u) => u.id);
    // Presence and follow state are independent reads — issue them together
    // rather than one after the other.
    const [presenceMap, followingSet] = await Promise.all([
      this.presenceService.getPresenceMany(userIds),
      this.getFollowingSet(currentUserId, userIds),
    ]);

    // Honour each target's own presence rules (and the block list) rather than
    // reporting raw presence to whoever asked.
    const visibleIds = currentUserId
      ? await resolvePresenceVisibilityForViewer(
          currentUserId,
          users.map((u) => ({
            userId: u.id,
            rule: u.settings?.whoCanSeeOnline || 'everyone',
            isEnabled: u.settings?.showOnlineStatus !== false,
          })),
          this.prisma,
          this.blocksService,
        )
      : new Set<string>();

    return users.map((u) => {
      const pres = presenceMap.get(u.id);
      const canSee = visibleIds.has(u.id);
      const isOnline = canSee && pres?.status === 'online';
      return {
        ...u,
        // Authoritative, from the `Follow` table, for every row on the page.
        // This field did not exist on the payload before, so every consumer
        // that rendered a follow button from this list read `undefined` and
        // fell back to "not following" — which is why an account the viewer
        // already followed showed a "Follow" button here.
        isFollowing: followingSet.has(u.id),
        isOnline,
        online: isOnline,
        lastActive: canSee ? pres?.lastSeen || null : null,
      };
    });
  }

  async getCampusUsers(
    userIdOrCollegeId: string,
    limit: number,
    offset: number,
    // The caller's campus, already resolved from their affiliation by the
    // controller (CampusAccessService). Takes precedence over any lookup.
    scope: { collegeId?: string } = {},
  ) {
    if (!userIdOrCollegeId) return [];
    let collegeId = userIdOrCollegeId;
    let excludeUserId: string | undefined = undefined;

    if (scope.collegeId) {
      collegeId = scope.collegeId;
      excludeUserId = userIdOrCollegeId;
    } else {
      // Check if the argument is a userId by performing a database lookup.
      // A user's campus is their ACTIVE affiliation, never the mirror.
      const targetUser = await this.prisma.user.findUnique({
        where: { id: userIdOrCollegeId },
        select: { collegeAffiliation: { select: ACTIVE_AFFILIATION_SELECT } },
      });
      if (targetUser) {
        const active = activeAffiliationCollegeId(
          targetUser.collegeAffiliation,
        );
        if (!active) return [];
        collegeId = active;
        excludeUserId = userIdOrCollegeId;
      }
    }

    const where: Prisma.UserWhereInput = {
      collegeId,
      // Listed only with a verified college email for THIS college. The
      // `collegeId` mirror alone is not enough: legacy rows the backfill
      // skipped keep it (it is never nulled, for the previous release), and
      // an admin-revoked affiliation keeps its row. See campusMemberWhere.
      ...campusMemberWhere(collegeId),
      accountStatus: 'ACTIVE',
      deletedAt: null,
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    };

    const users = await this.prisma.user.findMany({
      where,
      take: limit,
      skip: offset,
      select: {
        id: true,
        username: true,
        displayName: true,
        isCampusRep: true,
        avatar: true,
        bio: true,
        collegeId: true,
        course: true,
        branch: true,
        passingYear: true,
        college: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    /**
     * No presence on this response, and no `settings` either.
     *
     * Both were wrong. `settings` selected each listed student's
     * `whoCanSeeOnline` and `showOnlineStatus` and then spread them into the
     * response with `...u`, handing every viewer another person's privacy
     * configuration. Worse, having selected those rules the code then ignored
     * them: `isOnline` was computed straight from raw presence, so a student
     * who had set "who can see when I'm online: nobody" was still reported as
     * online to the whole campus. The rules were being read and disregarded.
     *
     * Nothing renders presence from this endpoint — the campus suggestions
     * pass no `isOnline` to their avatars — so the honest fix is to stop
     * computing it rather than to resolve visibility for a value no surface
     * shows. `getDirectory` was corrected the same way. A caller that needs a
     * presence dot here must resolve it through
     * `resolvePresenceVisibilityForViewer`, as the messaging surfaces do.
     */

    // Follow state IS rendered from this endpoint — the campus lists carry a
    // follow button — and it was missing, so every row reported "not
    // following". One batched lookup for the page; see getFollowingSet.
    const followingSet = await this.getFollowingSet(
      excludeUserId,
      users.map((u) => u.id),
    );
    return users.map((u) => ({
      ...u,
      isFollowing: followingSet.has(u.id),
    }));
  }

  /**
   * Server-side campus directory: search + course/branch/passingYear filters with
   * keyset (cursor) pagination on (createdAt desc, id desc). Scoped to the
   * caller's college so a directory can scale past the previous 50-row client
   * cap without ever downloading the whole college. Presence is batched.
   *
   * @param cursor  `${createdAt ISO}|${id}` of the last row from the prior page.
   * @returns { users, nextCursor }
   */
  async getDirectory(
    userId: string,
    opts: {
      /** The caller's campus, from their affiliation (CampusAccessService). */
      collegeId?: string;
      search?: string;
      course?: string;
      branch?: string;
      passingYear?: number;
      currentYear?: number;
      limit?: number;
      cursor?: string;
    } = {},
  ) {
    if (!userId) return { users: [], nextCursor: undefined };
    // The caller's campus: the controller's affiliation lookup, or the same
    // ACTIVE affiliation read here (never the `User.collegeId` mirror).
    const me = {
      collegeId:
        opts.collegeId ??
        activeAffiliationCollegeId(
          await this.prisma.collegeAffiliation.findUnique({
            where: { userId },
            select: ACTIVE_AFFILIATION_SELECT,
          }),
        ),
    };
    if (!me.collegeId) return { users: [], nextCursor: undefined };

    const limit = Math.min(Math.max(Number(opts.limit) || 30, 1), 50);
    const search = (opts.search || '').trim();

    // Decode keyset cursor.
    let cursorWhere: Prisma.UserWhereInput | undefined = undefined;
    /**
     * Keyset pagination on the name, because that is what the list is ordered
     * by now. It used to page on `createdAt`, which was correct for a
     * newest-first directory and would silently return the wrong rows against
     * an alphabetical one — the cursor has to be built from the same key the
     * ORDER BY uses or pages overlap and skip.
     *
     * `id` breaks ties so two people with the same display name cannot make the
     * cursor ambiguous and drop one of them.
     *
     * Split on the LAST `|`, not the first. The id is a uuid and never contains
     * one; a display name can, and splitting on the first would truncate the
     * name at that character and page from the wrong place.
     */
    if (typeof opts.cursor === 'string' && opts.cursor.includes('|')) {
      const separator = opts.cursor.lastIndexOf('|');
      const name = opts.cursor.slice(0, separator);
      const id = opts.cursor.slice(separator + 1);
      if (id) {
        cursorWhere = {
          OR: [
            { displayName: { gt: name } },
            { displayName: name, id: { gt: id } },
          ],
        };
      }
    }

    const yearFilter = opts.passingYear ?? opts.currentYear;
    const where: Prisma.UserWhereInput = {
      collegeId: me.collegeId,
      // Verified members of this college only; see getCampusUsers.
      ...campusMemberWhere(me.collegeId),
      id: { not: userId },
      accountStatus: 'ACTIVE',
      deletedAt: null,
      ...(opts.course ? { course: opts.course } : {}),
      ...(opts.branch ? { branch: opts.branch } : {}),
      ...(yearFilter ? { passingYear: yearFilter } : {}),
      // The search and the keyset cursor are both `OR`s. The cursor's is the
      // top-level `OR`; the search's goes under `AND`. Spread side by side, the
      // cursor's replaced the search's and every page after the first ignored
      // the search text (A18).
      ...(search
        ? {
            AND: [
              {
                OR: [
                  {
                    displayName: {
                      contains: search,
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    username: {
                      contains: search,
                      mode: 'insensitive' as const,
                    },
                  },
                ],
              },
            ],
          }
        : {}),
      ...(cursorWhere || {}),
    };

    /**
     * Blocked users stay IN the campus directory.
     *
     * They used to be filtered out of the query entirely, which reads as the
     * cautious choice and is the wrong one for a directory of the people at
     * your college: a block is a personal boundary, not a claim that someone
     * has stopped attending. Removing them also makes the directory a probe —
     * a name that vanishes tells you something a neutral listing does not.
     *
     * What they lose is everything past the name. The row is stripped below and
     * marked so the card does not link anywhere, and the profile routes enforce
     * the real rule: the blocker may open the profile, the blocked user may not.
     */
    const directoryWhere = where;

    // Exactly the columns a directory card paints: the avatar, the name it is
    // labelled with, the username the card links to, and the three academic
    // fields its subtitle is built from. `createdAt` is selected for the keyset
    // cursor and stripped from the response below.
    //
    // What is deliberately absent used to be selected and shipped: `bio` (a
    // free-text column the card never renders, and the largest thing on the
    // row), `collegeId` (identical on every row by construction — the query is
    // already scoped to one college), `isCampusRep` (no badge on this card),
    // and `settings`, which is the other person's *privacy configuration*:
    // `whoCanSeeOnline` and `showOnlineStatus` were being handed to every
    // viewer who opened the directory.
    const rows = await this.prisma.user.findMany({
      where: directoryWhere,
      take: limit + 1, // fetch one extra to detect the next page
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        course: true,
        branch: true,
        passingYear: true,
        createdAt: true,
      },
      // Alphabetical, with `id` as the tie-break that keeps the keyset cursor
      // above unambiguous.
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && last ? `${last.displayName ?? ''}|${last.id}` : undefined;

    // No presence on this response, because no directory card draws a presence
    // dot — it renders an avatar, a name and an academic line, and nothing else.
    // Resolving it anyway cost a Redis batch plus, per page,
    // `blocksService.getExcludedUserIds` a second time (the block filter above
    // has already run it), the viewer's own settings row, and up to two follow
    // lookups for the 'following' / 'mutual' rules — five or six round trips to
    // compute three fields that were serialized and then dropped on the floor.
    // If a dot is ever wanted here, resolve it then; it is not free.
    /**
     * A blocked row keeps its name and loses the rest.
     *
     * Avatar, username and the academic line all go: the requirement is that
     * the person remains listed, not that the card stays useful. `blocked`
     * tells the card to render a plain, unlinked entry — and the username in
     * particular is withheld because it is the one field that would let the
     * viewer hand-build a profile URL from what they were shown.
     */
    const excludedIds = userId
      ? new Set(await this.blocksService.getExcludedUserIds(userId))
      : new Set<string>();

    const users = pageRows.map(({ createdAt: _createdAt, ...u }) =>
      excludedIds.has(u.id)
        ? {
            id: u.id,
            displayName: u.displayName,
            username: null,
            avatar: null,
            course: null,
            branch: null,
            passingYear: null,
            blocked: true,
          }
        : { ...u, blocked: false },
    );

    return { users, nextCursor };
  }

  /**
   * Profile lookup by id.
   *
   * This route used to take no viewer at all, so it applied neither the block
   * rules nor the target's own presence settings: a blocked user could read the
   * full profile here, and `isOnline`/`lastActive` were returned to anybody who
   * asked. It is the by-id twin of getProfileByUsername and must enforce the
   * same rules.
   */
  async getUserById(id: string, currentUserId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        displayName: true,
        isCampusRep: true,
        avatar: true,
        bio: true,
        college: true,
        course: true,
        branch: true,
        passingYear: true,
        profileCompleted: true,
        deletedAt: true,
        settings: { select: { showOnlineStatus: true, whoCanSeeOnline: true } },
      },
    });
    // Same body as the block case below, so the two are indistinguishable.
    // Also return 404 for soft-deleted users so no stale data is served.
    if (!user || user.deletedAt)
      throw new NotFoundException("This profile isn't available.");

    /**
     * Directional, matching getProfileByUsername — this is its by-id twin and
     * the two must not disagree, or the rule becomes "whichever route you
     * happened to use". The blocker keeps access to a profile they blocked; the
     * blocked user is refused with the same neutral 404 as a missing account.
     */
    const blockDirection =
      currentUserId && currentUserId !== id
        ? await this.blocksService.getBlockDirection(currentUserId, id)
        : { isBlocked: false, blockedByMe: false, blockedByThem: false };

    if (blockDirection.blockedByThem) {
      throw new NotFoundException("This profile isn't available.");
    }

    const canSeeOnline = currentUserId
      ? await checkPresenceVisibility(
          id,
          currentUserId,
          user.settings?.whoCanSeeOnline || 'everyone',
          user.settings?.showOnlineStatus !== false,
          this.prisma,
          this.blocksService,
        )
      : false;

    const pres = canSeeOnline
      ? await this.presenceService.getPresence(id)
      : null;
    const isOnline = canSeeOnline && pres?.status === 'online';

    const { settings: _settings, ...publicUser } = user;
    return {
      ...publicUser,
      isOnline,
      online: isOnline,
      lastActive: canSeeOnline ? pres?.lastSeen || null : null,
      // First-year isolation has been removed. Kept, always `false`, because
      // installed apps ship a frozen frontend that reads it to decide whether
      // to draw a locked Message button.
      messagingRestricted: false,
      // Same flag the username route emits, for the same reason: only the
      // blocker ever sees it, and it tells them something they did themselves.
      blockedByMe: blockDirection.blockedByMe,
    };
  }

  async getProfileByUsername(username: string, currentUserId?: string) {
    const cleanUsername = username.trim().toLowerCase();

    // Resolved up front so the follower/following counts below can be built
    // from exactly what `getFollowers`/`getFollowing` will return. Both are
    // cheap and cached; keeping them here leaves the profile a single query.
    const blockedIds = currentUserId
      ? await this.blocksService.getExcludedUserIds(currentUserId)
      : [];

    // 1. Find user by exact username (case-insensitive), or ID, or email prefix, or handle prefix, or displayName
    const targetUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: cleanUsername, mode: 'insensitive' } },
          { id: cleanUsername },
          { email: { equals: cleanUsername, mode: 'insensitive' } },
          { collegeEmail: { equals: cleanUsername, mode: 'insensitive' } },
        ],
      },
      include: {
        college: { select: { name: true } },
        settings: {
          select: {
            privateProfile: true,
            showOnlineStatus: true,
            showCollegeOnProfile: true,
            whoCanSeeOnline: true,
          },
        },
        _count: {
          select: {
            /**
             * Counted through the SAME visibility rules `getFollowers` and
             * `getFollowing` apply, not just "is this account alive".
             *
             * They used to differ, and the difference was visible: a profile
             * read "1 Following" above a list that said "No following yet",
             * because the count included an account the viewer is not allowed
             * to see and the list — correctly — did not. Blocks cause it.
             *
             * The consequence is that these numbers are viewer-relative: two
             * people can see different follower counts on the same profile.
             * That is the honest reading of a per-viewer visibility rule — the
             * alternative is a number that describes rows the viewer is being
             * refused, which is what produced the contradiction.
             */
            followers: {
              where: {
                follower: {
                  deletedAt: null,
                  accountStatus: 'ACTIVE',
                  ...(blockedIds.length > 0
                    ? { id: { notIn: blockedIds } }
                    : {}),
                },
              },
            },
            following: {
              where: {
                following: {
                  deletedAt: null,
                  accountStatus: 'ACTIVE',
                  ...(blockedIds.length > 0
                    ? { id: { notIn: blockedIds } }
                    : {}),
                },
              },
            },
            posts: {
              where: {
                deletedAt: null,
                communityId: null,
              },
            },
          },
        },
      },
    });

    if (!targetUser || targetUser.deletedAt) {
      throw new NotFoundException("This profile isn't available.");
    }

    let isFollowing = false;
    let isFollowedBy = false;

    // All of these are independent of each other, so run them in ONE parallel
    // batch instead of sequentially — collapses the block-check, both follow
    // lookups, presence read and visibility check from ~3-4 sequential
    // backend↔DB round trips into a single round trip's worth of latency.
    const needsRelational = Boolean(
      currentUserId && currentUserId !== targetUser.id,
    );
    const [
      blockDirection,
      followRecord,
      followedByRecord,
      presence,
      canSeeOnline,
    ] = await Promise.all([
      needsRelational
        ? this.blocksService.getBlockDirection(currentUserId!, targetUser.id)
        : Promise.resolve({
            isBlocked: false,
            blockedByMe: false,
            blockedByThem: false,
          }),
      needsRelational
        ? this.prisma.follow.findUnique({
            where: {
              followerId_followingId: {
                followerId: currentUserId!,
                followingId: targetUser.id,
              },
            },
          })
        : Promise.resolve(null),
      needsRelational
        ? this.prisma.follow.findUnique({
            where: {
              followerId_followingId: {
                followerId: targetUser.id,
                followingId: currentUserId!,
              },
            },
          })
        : Promise.resolve(null),
      this.presenceService.getPresence(targetUser.id),
      checkPresenceVisibility(
        targetUser.id,
        currentUserId || '',
        targetUser.settings?.whoCanSeeOnline || 'everyone',
        targetUser.settings?.showOnlineStatus !== false,
        this.prisma,
        this.blocksService,
      ),
    ]);

    /**
     * Blocking is DIRECTIONAL here, which it was not before.
     *
     * The person who placed the block keeps access: they may want to check what
     * they blocked, or undo it, and refusing them their own decision is not
     * protection. The person who was blocked loses access entirely.
     *
     * Refusing both was the safer-looking rule and the wrong one — it told the
     * blocker nothing useful and, by making the pair symmetric, meant a user
     * could infer a block simply by noticing a profile they had blocked
     * themselves had become unreachable.
     *
     * The refusal keeps the SAME message and status as the genuine
     * profile-not-found above. If the two differed, comparing responses would
     * let a user tell "this account blocked me" apart from "no such account" —
     * exactly the disclosure the neutral 404 exists to prevent.
     */
    if (blockDirection.blockedByThem) {
      throw new NotFoundException("This profile isn't available.");
    }
    isFollowing = !!followRecord;
    isFollowedBy = !!followedByRecord;

    const isOnline = canSeeOnline ? presence?.status === 'online' : false;

    const settings = targetUser.settings
      ? {
          privateProfile: !!targetUser.settings.privateProfile,
          showOnlineStatus: targetUser.settings.showOnlineStatus ?? true,
          whoCanSeeOnline: targetUser.settings.whoCanSeeOnline ?? 'everyone',
          showCollegeOnProfile:
            targetUser.settings.showCollegeOnProfile ?? true,
        }
      : null;

    return {
      id: targetUser.id,
      username: targetUser.username,
      displayName: targetUser.displayName,
      avatar: targetUser.avatar,
      cover: targetUser.cover,
      bio: targetUser.bio,
      birthday: targetUser.birthday,
      college: targetUser.college?.name || null,
      collegeId: targetUser.collegeId,
      isCampusRep: targetUser.isCampusRep,
      course: targetUser.course,
      branch: targetUser.branch,
      passingYear: targetUser.passingYear,
      location: targetUser.location,
      interests: targetUser.interests || [],
      // The checkmark by a name means identity-verified. It used to read a
      // separate `emailVerified` column that no signup path ever wrote, so it
      // only ever appeared for accounts an admin had clicked a button on.
      verified: targetUser.verificationStatus === 'VERIFIED',
      verificationStatus: targetUser.verificationStatus,
      profileCompleted: targetUser.profileCompleted,
      createdAt: targetUser.createdAt,
      settings,
      isPrivate: targetUser.settings?.privateProfile || false,
      isOnline,
      online: isOnline,
      lastActive: presence?.lastSeen || null,
      stats: {
        followers: targetUser._count.followers,
        following: targetUser._count.following,
        posts: targetUser._count.posts,
      },
      isFollowing,
      isFollowedBy,
      isMutual: isFollowing && isFollowedBy,
      /**
       * True when the VIEWER has blocked this profile.
       *
       * Only ever true for the blocker — the blocked side does not reach this
       * response at all — so it discloses nothing: it tells a user something
       * they did themselves. The profile header renders it where the Follow
       * button would go, and following is refused server-side regardless.
       */
      blockedByMe: blockDirection.blockedByMe,
      // First-year isolation has been removed. Kept, always `false`, because
      // installed apps ship a frozen frontend that reads it to decide whether
      // to draw a locked Message button.
      messagingRestricted: false,
    };
  }

  async followUser(followerId: string, followingUsername: string) {
    const t0 = performance.now();
    const cleanUsername = followingUsername.trim().toLowerCase();

    // Resolved before the CTE below so the whole thing stays one round trip.
    // Single atomic CTE query combining: user lookup + block check + follow insert + count calculation
    // Reduces database network round-trips from 4 down to 1!
    const rows = await this.prisma.$queryRaw<FollowCteRow[]>`
      WITH target_user AS (
        SELECT "id", "username", "displayName", "avatar"
        FROM "User" u
        WHERE ("username" = ${cleanUsername} OR "id" = ${cleanUsername})
          -- Unavailable accounts are not followable. During the 30-day
          -- deletion window the username is still the real one, so anybody
          -- who already knew it could otherwise follow an account that is
          -- 404 everywhere else — and the follow row would then have to be
          -- cleaned up again at purge time.
          AND "deletedAt" IS NULL
        LIMIT 1
      ),
      follower_user AS (
        SELECT "id", "username", "displayName", "avatar"
        FROM "User"
        WHERE "id" = ${followerId}
        LIMIT 1
      ),
      block_check AS (
        SELECT 1 FROM "Block" b, target_user tu
        WHERE (b."blockerId" = ${followerId} AND b."blockedId" = tu."id")
           OR (b."blockerId" = tu."id" AND b."blockedId" = ${followerId})
        LIMIT 1
      ),
      ins AS (
        INSERT INTO "Follow" ("followerId", "followingId", "createdAt")
        SELECT ${followerId}, tu."id", NOW()
        FROM target_user tu
        WHERE NOT EXISTS (SELECT 1 FROM block_check)
          AND tu."id" != ${followerId}
        ON CONFLICT ("followerId", "followingId") DO NOTHING
        RETURNING "followingId"
      )
      SELECT 
        tu."id" AS "targetId",
        tu."username" AS "targetUsername",
        tu."displayName" AS "targetDisplayName",
        tu."avatar" AS "targetAvatar",
        fu."username" AS "followerUsername",
        fu."displayName" AS "followerDisplayName",
        fu."avatar" AS "followerAvatar",
        EXISTS(SELECT 1 FROM block_check) AS "isBlocked",
        EXISTS(SELECT 1 FROM ins) AS "newlyFollowed",
        ((SELECT COUNT(*)::int FROM "Follow" f, target_user tu WHERE f."followingId" = tu."id") + CASE WHEN EXISTS(SELECT 1 FROM ins) THEN 1 ELSE 0 END) AS "targetFollowers",
        (SELECT COUNT(*)::int FROM "Follow" f, target_user tu WHERE f."followerId" = tu."id") AS "targetFollowing",
        ((SELECT COUNT(*)::int FROM "Follow" f WHERE f."followerId" = ${followerId}) + CASE WHEN EXISTS(SELECT 1 FROM ins) THEN 1 ELSE 0 END) AS "currentFollowing"
      FROM target_user tu
      CROSS JOIN follower_user fu;
    `;

    const tDb = performance.now();

    if (!rows || rows.length === 0) {
      throw new NotFoundException('Target user not found');
    }

    const res = rows[0];

    if (res.targetId === followerId) {
      throw new BadRequestException('Cannot follow yourself');
    }

    if (res.isBlocked) {
      throw new BadRequestException('Action not allowed due to user block');
    }

    if (res.newlyFollowed) {
      // The auth bootstrap (`/api/auth/sync`) serves `followingList` from a
      // 60-second in-process LRU. Nothing used to drop that entry when the
      // graph changed, so any auth event inside that window — a token refresh,
      // a tab return, a reload — answered with the PRE-follow list, the client
      // overwrote `currentUser.followingList` with it wholesale, and every
      // account followed in the last minute reverted to "Follow" in the UI.
      // That is the flip-back bug, and it got worse the more follows a session
      // performed because each stale answer reverted all of them at once.
      //
      // The LRU is per process, so this also broadcasts over Redis to the
      // other replicas — see clearAuthSyncCache. Without that, whether the UI
      // reverted came down to which replica the next sync happened to reach.
      clearAuthSyncCache(followerId);

      // Async non-blocking notification queue
      const jobData: FollowNotifJob = {
        followerId,
        followingId: res.targetId,
        actor: {
          username: res.followerUsername,
          displayName: res.followerDisplayName,
          avatar: res.followerAvatar,
        },
      };
      this.notifQueue
        .add('follow-notification', jobData, {
          removeOnComplete: true,
          removeOnFail: { count: 50 },
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        })
        .catch((err) =>
          this.logger.warn('Failed to enqueue follow notification', err),
        );

      // Async non-blocking domain event broadcast
      this.domainEventService
        .emit('follow.created', {
          followerId,
          followingId: res.targetId,
          followingUsername: res.targetUsername,
          followerStats: { followingCount: res.currentFollowing },
          targetStats: { followersCount: res.targetFollowers },
        })
        .catch((err) =>
          this.logger.warn('Failed to emit follow.created event', err),
        );
    }

    const tEnd = performance.now();
    this.logger.log(
      `[TIMING followUser] singleQueryDb=${(tDb - t0).toFixed(1)}ms total=${(tEnd - t0).toFixed(1)}ms (1 round-trip)`,
    );

    return {
      success: true,
      isFollowing: true,
      targetUser: {
        id: res.targetId,
        username: res.targetUsername,
        followersCount: res.targetFollowers,
        followingCount: res.targetFollowing,
      },
      currentUserStats: { followingCount: res.currentFollowing },
    };
  }

  async unfollowUser(followerId: string, followingUsername: string) {
    const t0 = performance.now();
    const cleanUsername = followingUsername.trim().toLowerCase();

    // Single atomic CTE query combining: user lookup + follow delete + count calculation
    // Reduces database network round-trips from 3 down to 1!
    const rows = await this.prisma.$queryRaw<UnfollowCteRow[]>`
      WITH target_user AS (
        SELECT "id", "username"
        FROM "User"
        WHERE "username" = ${cleanUsername} OR "id" = ${cleanUsername}
        LIMIT 1
      ),
      del AS (
        DELETE FROM "Follow" f
        USING target_user tu
        WHERE f."followerId" = ${followerId} AND f."followingId" = tu."id"
        RETURNING f."followingId"
      )
      SELECT 
        tu."id" AS "targetId",
        tu."username" AS "targetUsername",
        EXISTS(SELECT 1 FROM del) AS "unfollowed",
        GREATEST(0, (SELECT COUNT(*)::int FROM "Follow" f, target_user tu WHERE f."followingId" = tu."id") - CASE WHEN EXISTS(SELECT 1 FROM del) THEN 1 ELSE 0 END) AS "targetFollowers",
        (SELECT COUNT(*)::int FROM "Follow" f, target_user tu WHERE f."followerId" = tu."id") AS "targetFollowing",
        GREATEST(0, (SELECT COUNT(*)::int FROM "Follow" f WHERE f."followerId" = ${followerId}) - CASE WHEN EXISTS(SELECT 1 FROM del) THEN 1 ELSE 0 END) AS "currentFollowing"
      FROM target_user tu;
    `;

    const tDb = performance.now();

    if (!rows || rows.length === 0) {
      throw new NotFoundException('User not found');
    }

    const res = rows[0];

    if (res.unfollowed) {
      // Same reason as followUser: drop the cached auth bootstrap so the next
      // `/api/auth/sync` cannot hand back a `followingList` that still
      // contains the account just unfollowed.
      clearAuthSyncCache(followerId);

      this.domainEventService
        .emit('follow.deleted', {
          followerId,
          followingId: res.targetId,
          followingUsername: res.targetUsername,
          followerStats: { followingCount: res.currentFollowing },
          targetStats: { followersCount: res.targetFollowers },
        })
        .catch((err) =>
          this.logger.warn('Failed to emit follow.deleted event', err),
        );
    }

    const tEnd = performance.now();
    this.logger.log(
      `[TIMING unfollowUser] singleQueryDb=${(tDb - t0).toFixed(1)}ms total=${(tEnd - t0).toFixed(1)}ms (1 round-trip)`,
    );

    return {
      success: true,
      isFollowing: false,
      targetUser: {
        id: res.targetId,
        username: res.targetUsername,
        followersCount: res.targetFollowers,
        followingCount: res.targetFollowing,
      },
      currentUserStats: { followingCount: res.currentFollowing },
    };
  }

  /**
   * Name/username filter for the profile's follower/following viewer.
   *
   * In SQL, before LIMIT/OFFSET, like every other filter on these lists, so a
   * search pages through ALL matches rather than only the rows already loaded.
   * LIKE wildcards in the input are escaped so they match literally.
   */
  private followListSearchFilter(search?: string): Prisma.Sql {
    const term = search?.trim().replace(/^@/, '').slice(0, 64);
    if (!term) return Prisma.empty;
    const pattern = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return Prisma.sql`AND (u."username" ILIKE ${pattern} OR u."displayName" ILIKE ${pattern})`;
  }

  async getFollowers(
    username: string,
    currentUserId?: string,
    limit = 20,
    offset = 0,
    eligibleOnly = false,
    search?: string,
  ) {
    const cleanUsername = username.trim().toLowerCase();

    const targetUser = await this.prisma.user.findUnique({
      where: { username: cleanUsername },
      select: { id: true },
    });
    if (!targetUser) throw new NotFoundException('User not found');

    // Blocked users must not surface in a follower list. Excluded in SQL, before
    // LIMIT/OFFSET, so pages stay full and the offset cursor does not skip —
    // filtering the rows after the query would return short pages instead.
    const excludedUserIds = currentUserId
      ? await this.blocksService.getExcludedUserIds(currentUserId)
      : [];
    const followerBlockFilter =
      excludedUserIds.length > 0
        ? Prisma.sql`AND f."followerId" NOT IN (${Prisma.join(excludedUserIds)})`
        : Prisma.empty;

    // Verified-only, when this list is being used to CHOOSE a recipient rather
    // than to read a profile's social graph.
    //
    // The same endpoint serves both: the profile's follower/following viewer,
    // where hiding accounts would misreport who actually follows whom and
    // contradict the counts shown beside it, and the Activity Invite picker,
    // where an ineligible account must never be offered. `eligibleOnly` is what
    // separates the two, and it is the caller's intent, not a user preference.
    //
    // In SQL, before LIMIT/OFFSET, for the reason the block filter above is:
    // filtering afterwards returns short pages and lets the offset cursor skip
    // over rows that were never shown.
    const eligibilityFilter =
      eligibleOnly && this.verificationAccess.isEnforcementEnabled()
        ? Prisma.sql`AND u."verificationStatus"::text = ${VerificationStatus.VERIFIED}`
        : Prisma.empty;

    // A deleted or suspended account is not part of anyone's social graph. The
    // counts beside this list have always excluded them; this list did not, so
    // the two disagreed.
    const activeOnlyFilter = Prisma.sql`AND u."deletedAt" IS NULL AND u."accountStatus"::text = 'ACTIVE'`;

    const rows = await this.prisma.$queryRaw<FollowListRow[]>`
      SELECT 
        u."id",
        u."username",
        u."displayName",
        u."avatar",
        u."bio",
        u."role",
        CASE WHEN ${currentUserId ? currentUserId : ''}::text != '' THEN
          EXISTS(
            SELECT 1 FROM "Follow" my_f 
            WHERE my_f."followerId" = ${currentUserId || ''} AND my_f."followingId" = u."id"
          )
        ELSE false END AS "isFollowing"
      FROM "Follow" f
      JOIN "User" u ON f."followerId" = u."id"
      WHERE f."followingId" = ${targetUser.id}
      ${followerBlockFilter}
      ${eligibilityFilter}
      ${activeOnlyFilter}
      ${this.followListSearchFilter(search)}
      ORDER BY f."createdAt" DESC
      LIMIT ${limit} OFFSET ${offset};
    `;

    const userIds = rows.map((r) => r.id);
    const presenceMap = await this.presenceService.getPresenceMany(userIds);

    return rows.map((r) => {
      const pres = presenceMap.get(r.id);
      const isOnline = pres?.status === 'online';
      return {
        id: r.id,
        username: r.username,
        displayName: r.displayName,
        avatar: r.avatar,
        bio: r.bio,
        role: r.role,
        isFollowing: !!r.isFollowing,
        isOnline,
        online: isOnline,
        lastActive: pres?.lastSeen || null,
      };
    });
  }

  async getFollowing(
    username: string,
    currentUserId?: string,
    limit = 20,
    offset = 0,
    eligibleOnly = false,
    search?: string,
  ) {
    const cleanUsername = username.trim().toLowerCase();

    const targetUser = await this.prisma.user.findUnique({
      where: { username: cleanUsername },
      select: { id: true },
    });
    if (!targetUser) throw new NotFoundException('User not found');

    // Same exclusion as getFollowers, applied to the followed side of the edge.
    const excludedUserIds = currentUserId
      ? await this.blocksService.getExcludedUserIds(currentUserId)
      : [];
    const followingBlockFilter =
      excludedUserIds.length > 0
        ? Prisma.sql`AND f."followingId" NOT IN (${Prisma.join(excludedUserIds)})`
        : Prisma.empty;

    // Verified-only, when this list is being used to CHOOSE a recipient rather
    // than to read a profile's social graph.
    //
    // The same endpoint serves both: the profile's follower/following viewer,
    // where hiding accounts would misreport who actually follows whom and
    // contradict the counts shown beside it, and the Activity Invite picker,
    // where an ineligible account must never be offered. `eligibleOnly` is what
    // separates the two, and it is the caller's intent, not a user preference.
    //
    // In SQL, before LIMIT/OFFSET, for the reason the block filter above is:
    // filtering afterwards returns short pages and lets the offset cursor skip
    // over rows that were never shown.
    const eligibilityFilter =
      eligibleOnly && this.verificationAccess.isEnforcementEnabled()
        ? Prisma.sql`AND u."verificationStatus"::text = ${VerificationStatus.VERIFIED}`
        : Prisma.empty;

    // Same as getFollowers: gone or suspended accounts leave the social graph,
    // and the counts beside this list already treated them that way.
    const followingActiveOnlyFilter = Prisma.sql`AND u."deletedAt" IS NULL AND u."accountStatus"::text = 'ACTIVE'`;

    const rows = await this.prisma.$queryRaw<FollowListRow[]>`
      SELECT 
        u."id",
        u."username",
        u."displayName",
        u."avatar",
        u."bio",
        u."role",
        CASE WHEN ${currentUserId ? currentUserId : ''}::text != '' THEN
          EXISTS(
            SELECT 1 FROM "Follow" my_f 
            WHERE my_f."followerId" = ${currentUserId || ''} AND my_f."followingId" = u."id"
          )
        ELSE false END AS "isFollowing"
      FROM "Follow" f
      JOIN "User" u ON f."followingId" = u."id"
      WHERE f."followerId" = ${targetUser.id}
      ${followingBlockFilter}
      ${eligibilityFilter}
      ${followingActiveOnlyFilter}
      ${this.followListSearchFilter(search)}
      ORDER BY f."createdAt" DESC
      LIMIT ${limit} OFFSET ${offset};
    `;

    const userIds = rows.map((r) => r.id);
    const presenceMap = await this.presenceService.getPresenceMany(userIds);

    return rows.map((r) => {
      const pres = presenceMap.get(r.id);
      const isOnline = pres?.status === 'online';
      return {
        id: r.id,
        username: r.username,
        displayName: r.displayName,
        avatar: r.avatar,
        bio: r.bio,
        role: r.role,
        isFollowing: !!r.isFollowing,
        isOnline,
        online: isOnline,
        lastActive: pres?.lastSeen || null,
      };
    });
  }

  async updateProfile(
    userId: string,
    data: Record<string, unknown>,
    userEmail?: string,
  ) {
    // Only allow updating valid user profile fields
    const {
      displayName,
      username,
      bio,
      avatar,
      cover,
      location,
      profileCompleted,
      interests,
      birthday,
      gender,
    } = data;
    // Scalar columns only. The two media relations are kept apart (below)
    // because the update and the create branch must write them differently.
    const updateData: ProfileScalarWrite = {};
    if (displayName !== undefined) {
      const trimmedDisplayName =
        typeof displayName === 'string' ? displayName.trim() : '';
      if (trimmedDisplayName.length > 30) {
        throw new BadRequestException('Name cannot exceed 30 characters');
      }
      updateData.displayName = trimmedDisplayName;
    }

    if (username !== undefined) {
      const trimmedUsername =
        typeof username === 'string' ? username.trim().toLowerCase() : '';
      if (trimmedUsername.length > 30) {
        throw new BadRequestException('Username cannot exceed 30 characters');
      }
      // Coupling reminder: If this validation regex is updated, keep the sanitizer in auth.service.ts in sync.
      const usernameRegex = /^[a-z0-9_.]{3,30}$/;
      if (!usernameRegex.test(trimmedUsername)) {
        throw new BadRequestException(
          'Username must be 3-30 characters long and contain only lowercase letters, numbers, underscores, and dots.',
        );
      }

      // Enforced here as well as at signup. It was checked only at signup, so
      // a user could register an ordinary handle and then rename themselves to
      // `admin`, `support` or `deleted` — the list existed but this path
      // walked straight past it.
      if (isReservedUsername(trimmedUsername)) {
        throw new BadRequestException(RESERVED_USERNAME_MESSAGE);
      }

      // Check if username is already taken by someone else
      const existing = await this.prisma.user.findUnique({
        where: { username: trimmedUsername },
      });
      if (existing && existing.id !== userId) {
        throw new BadRequestException('Username is already taken.');
      }

      updateData.username = trimmedUsername;
    }

    if (bio !== undefined) {
      const trimmedBio = typeof bio === 'string' ? bio.trim() : '';
      if (trimmedBio.length > 200) {
        throw new BadRequestException(
          'Description cannot exceed 200 characters',
        );
      }
      updateData.bio = trimmedBio;
    }

    if (birthday !== undefined) {
      if (!birthday || typeof birthday !== 'string' || birthday.trim() === '') {
        throw new BadRequestException('Date of birth is required.');
      }
      validateBirthday(birthday);
      updateData.birthday = birthday.trim();
    }

    const avatarRef = mediaRefInput(avatar, 'avatar');
    if (avatarRef !== undefined) updateData.avatar = avatarRef;
    const avatarMedia = mediaRelationWrite(avatarRef, userId);

    const coverRef = mediaRefInput(cover, 'cover');
    // A gradient/pattern cover is CSS every viewer paints; see cover-css.util.
    if (coverRef && looksLikeCoverCss(coverRef) && !isSafeCoverCss(coverRef)) {
      throw new BadRequestException('cover is not a supported design');
    }
    if (coverRef !== undefined) updateData.cover = coverRef;
    const coverMedia = mediaRelationWrite(coverRef, userId);

    // Academic information is validated against the official GLA catalogue on the
    // server, so a handcrafted request cannot pair a course with another course's
    // branch or a year beyond the course duration. Absent fields leave the stored
    // values untouched, which lets a settings save that only edits a bio omit them.
    let academic: {
      course: string;
      branch: string;
      passingYear: number;
    } | null = null;
    try {
      academic = this.academicsService.validateIfPresent({
        course: data.course,
        branch: data.branch,
        passingYear: data.passingYear ?? data.currentYear,
      });
    } catch (err) {
      // Log the rejected combination (ids only — no personal data) so an invalid
      // pairing reaching the server is diagnosable without replaying the request.
      this.logger.warn(
        `[ACADEMIC] rejected for user=${userId} course=${logValue(data.course)} branch=${logValue(data.branch)} year=${logValue(data.passingYear ?? data.currentYear)}: ${(err as Error).message}`,
      );
      throw err;
    }
    if (academic) {
      updateData.course = academic.course;
      updateData.branch = academic.branch;
      updateData.passingYear = academic.passingYear;
      // Debug-level: useful while a user is filling in their details, silent in prod.
      this.logger.debug(
        `[ACADEMIC] accepted for user=${userId} course=${academic.course} branch=${academic.branch} year=${academic.passingYear}`,
      );
    }

    if (gender !== undefined) {
      if (
        gender !== null &&
        !(
          typeof gender === 'string' &&
          (Object.values(Gender) as string[]).includes(gender)
        )
      ) {
        throw new BadRequestException(
          `gender must be one of ${Object.values(Gender).join(', ')}`,
        );
      }
      updateData.gender = gender as Gender | null;
    }

    if (location !== undefined) {
      if (location !== null && typeof location !== 'string') {
        throw new BadRequestException('location must be a string');
      }
      updateData.location = location;
    }
    if (profileCompleted !== undefined) {
      if (typeof profileCompleted !== 'boolean') {
        throw new BadRequestException('profileCompleted must be a boolean');
      }
      updateData.profileCompleted = profileCompleted;
    }
    if (Array.isArray(interests))
      updateData.interests = (interests as unknown[]).filter(
        (i): i is string => typeof i === 'string',
      );

    // The sign-in address comes from the verified token only. A body `email`
    // is still type-checked (old clients send whole forms, and a wrongly typed
    // one has always been a 400) but its value is NEVER stored: the only path
    // that changes an existing account's email is the OTP-verified
    // /api/account/email flow.
    assertBodyEmailType(data.email);
    const realEmail =
      userEmail && !userEmail.endsWith('@meetifyy.user')
        ? userEmail.trim().toLowerCase()
        : `${userId}@meetifyy.user`;

    const existingUserRecord = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, username: true, displayName: true },
    });

    const fallbackUsername =
      updateData.username ||
      existingUserRecord?.username ||
      realEmail.split('@')[0] ||
      `user_${userId.slice(0, 8)}`;
    const fallbackDisplayName =
      updateData.displayName ||
      existingUserRecord?.displayName ||
      fallbackUsername;

    // No email "auto-heal" here any more. Changing an existing account's
    // sign-in email happens only through the OTP-verified /api/account/email
    // flow; `realEmail` is used solely for the create branch below (a row that
    // does not exist yet).

    clearAuthSyncCache(userId);

    const userBefore =
      avatar !== undefined || cover !== undefined
        ? await this.prisma.user.findUnique({
            where: { id: userId },
            select: { avatar: true, cover: true },
          })
        : null;

    let updated: Prisma.UserGetPayload<{
      select: typeof PROFILE_UPDATE_SELECT;
    }>;
    try {
      updated = await this.prisma.user.upsert({
        where: { id: userId },
        update: {
          ...updateData,
          ...(avatarMedia && { avatarMedia: avatarMedia.update }),
          ...(coverMedia && { coverMedia: coverMedia.update }),
        },
        create: {
          id: userId,
          username: fallbackUsername,
          displayName: fallbackDisplayName,
          email: realEmail,
          ...updateData,
          // A new row has no media to disconnect; only a link is written.
          ...(avatarMedia?.create && { avatarMedia: avatarMedia.create }),
          ...(coverMedia?.create && { coverMedia: coverMedia.create }),
          notificationPrefs: {
            create: {},
          },
        },
        select: PROFILE_UPDATE_SELECT,
      });
    } catch (err) {
      if (avatarRef) {
        this.mediaCleanupService
          ?.discardFailedNewUpload(avatarRef, userId)
          .catch(() => {});
      }
      if (coverRef) {
        this.mediaCleanupService
          ?.discardFailedNewUpload(coverRef, userId)
          .catch(() => {});
      }
      throw err;
    }

    // Both run only after the update above committed, and only when the field
    // was actually submitted and actually changed — editing a bio must never
    // delete a picture.
    this.mediaCleanupService?.replaceEntityMedia({
      entityType: 'USER_AVATAR',
      entityId: userId,
      previous: userBefore?.avatar,
      next: updated.avatar,
      ownerId: userId,
      submitted: avatar !== undefined,
    });

    this.mediaCleanupService?.replaceEntityMedia({
      entityType: 'USER_COVER',
      entityId: userId,
      previous: userBefore?.cover,
      next: updated.cover,
      ownerId: userId,
      submitted: cover !== undefined,
    });

    // A changed avatar or cover has to reach everyone else, not just the person
    // who changed it. Both are denormalised into most payloads the app renders
    // — post authors, comment authors, chat participants, member lists, invite
    // and share pickers — so without this every other client kept showing the
    // old image until each of its queries happened to refetch. Fire-and-forget:
    // the profile is already saved, and a realtime failure must not undo that.
    if (
      avatar !== undefined ||
      cover !== undefined ||
      displayName !== undefined
    ) {
      this.domainEventService
        .emit('user.updated', {
          // Deliberately `id`, not `userId`: DomainEventService treats a `userId`
          // field as "target only this user", which is the opposite of what this
          // event needs.
          id: updated.id,
          username: updated.username,
          avatar: updated.avatar ?? null,
          cover: updated.cover ?? null,
          displayName: updated.displayName ?? null,
        })
        .catch((err: unknown) =>
          this.logger.warn(
            `Failed to broadcast user.updated: ${(err as Error | undefined)?.message}`,
          ),
        );
    }

    return updated;
  }

  async getSettings(userId: string) {
    return this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  /**
   * "Later" on the Complete-your-profile prompt: snoozes it for this session,
   * for at most 10 days. Idempotent (pressing again just restamps). The snooze
   * is tied to `sessionId`, so a new sign-in ends it; a caller with no
   * resolvable session id records nothing and is reported as not snoozed,
   * which only means the prompt may show again.
   */
  async snoozeProfilePrompt(
    userId: string,
    sessionId: string | null,
  ): Promise<{ snoozed: boolean }> {
    if (!sessionId) return { snoozed: false };
    await this.prisma.user.updateMany({
      where: { id: userId },
      data: {
        profilePromptLaterAt: new Date(),
        profilePromptLaterSessionId: sessionId,
      },
    });
    // The cached sync payload carries the old snooze state for up to 60s, on
    // every replica.
    clearAuthSyncCache(userId);
    return { snoozed: true };
  }

  async updateSettings(userId: string, data: Record<string, unknown>) {
    const payload: {
      emailNotifs?: boolean;
      pushNotifs?: boolean;
      privateProfile?: boolean;
      showOnlineStatus?: boolean;
      readReceipts?: boolean;
      showCollegeOnProfile?: boolean;
      whoCanSeeOnline?: string;
    } = {};
    if (typeof data.emailNotifs === 'boolean')
      payload.emailNotifs = data.emailNotifs;
    if (typeof data.pushNotifs === 'boolean')
      payload.pushNotifs = data.pushNotifs;
    if (typeof data.privateProfile === 'boolean')
      payload.privateProfile = data.privateProfile;
    if (typeof data.showOnlineStatus === 'boolean')
      payload.showOnlineStatus = data.showOnlineStatus;
    if (typeof data.readReceipts === 'boolean')
      payload.readReceipts = data.readReceipts;
    if (typeof data.showCollegeOnProfile === 'boolean')
      payload.showCollegeOnProfile = data.showCollegeOnProfile;

    const validWho = ['everyone', 'following', 'mutual', 'nobody'];
    if (
      typeof data.whoCanSeeOnline === 'string' &&
      validWho.includes(data.whoCanSeeOnline)
    ) {
      payload.whoCanSeeOnline = data.whoCanSeeOnline;
    }

    const updated = await this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...payload },
      update: { ...payload },
    });

    void this.domainEventService.emit(
      'user.settings_updated',
      { userId, settings: updated },
      [userId],
    );

    // C-4 fix: Immediately evict the cached notification preferences so that any
    // changes to notification opt-in/out take effect on the next notification delivery
    // rather than waiting up to 5 minutes for the TTL to expire.
    this.notificationsService.invalidatePrefsCache(userId).catch(() => {});

    return updated;
  }

  async blockUser(blockerId: string, blockedId: string) {
    if (blockerId === blockedId)
      throw new BadRequestException('Cannot block yourself');

    // The block row and its immediate side effects go in one transaction: a
    // block that lands without severing the follow edges would leave the pair
    // following each other invisibly, and re-running the block later would not
    // repair it (the upsert is a no-op the second time).
    await this.prisma.$transaction(async (tx) => {
      await tx.block.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId } },
        create: { blockerId, blockedId },
        update: {},
      });

      // Follow is severed in BOTH directions. Only A pressed the button, but
      // the block is mutual, so leaving B->A intact would keep A's content
      // reaching a follower who can no longer see them.
      await tx.follow.deleteMany({
        where: {
          OR: [
            { followerId: blockerId, followingId: blockedId },
            { followerId: blockedId, followingId: blockerId },
          ],
        },
      });

      // Any live Instant Match between the two ends immediately. The pair is
      // kept out of each other's future match pool by the block filter rather
      // than by deleting their queue entries — both stay matchable with
      // everyone else.
      await tx.matchSession.updateMany({
        where: {
          OR: [
            { userAId: blockerId, userBId: blockedId },
            { userAId: blockedId, userBId: blockerId },
          ],
          // Only sessions still in play — a session already declined or
          // expired keeps the outcome it actually had, so the re-match
          // cooldown that reads MatchStatus is not rewritten by a later block.
          NOT: { status: { in: ['DECLINED', 'EXPIRED'] } },
        },
        data: {
          status: 'EXPIRED',
          chatStatus: 'ENDED_BY_USER',
          endedById: blockerId,
          endedAt: new Date(),
        },
      });
    });
    // Invalidate cached block lists AND the conversation-list cache for both
    // users so the `blocked` flag / hidden presence reflect the change
    // immediately instead of lingering for the 60s conversation-cache TTL.
    await this.blocksService.invalidateBlockCache(blockerId, blockedId);
    await this.invalidateConversationListCache([blockerId, blockedId]);

    // Both sides are told, live. A block closes the thread for writes in BOTH
    // directions, and the person who was blocked is the one who most needs to
    // know: without this event their composer stayed enabled and looked
    // perfectly usable until they happened to reload, at which point a message
    // they had already typed was refused. The server rejects the write either
    // way — this is what stops them from getting that far.
    //
    // Directional flags are resolved per recipient rather than sent raw, so
    // neither client has to work out which side of the block it is on, and the
    // blocked user is never handed an `isBlockedByMe` they could render as an
    // Unblock button for a block they did not place.
    this.emitBlockState('user:blocked', blockerId, blockedId, true);

    return { success: true, blocked: true };
  }

  /**
   * Push a block/unblock to both parties' open sessions.
   *
   * Fire-and-forget on purpose: a realtime delivery failure must never fail
   * the block itself. The database row is the authority and every client
   * re-reads it on the next conversation-list fetch, so a dropped event costs
   * a stale composer until refresh — exactly the behaviour this event exists
   * to improve, never worse than it.
   */
  private emitBlockState(
    type: 'user:blocked' | 'user:unblocked',
    blockerId: string,
    blockedId: string,
    blocked: boolean,
  ) {
    const push = (data: Record<string, unknown>, targets: string[]) => {
      try {
        // The emit is awaited by nobody and may be a synchronous mock, so the
        // result is normalised before a rejection handler is attached.
        Promise.resolve(
          this.domainEventService.emit(type, data, targets),
        ).catch(() => {});
      } catch {
        // Realtime is best-effort here; the block itself has already committed.
      }
    };

    // The blocker's own view: they placed it.
    push(
      {
        blocked,
        actorId: blockerId,
        targetUserId: blockedId,
        otherUserId: blockedId,
        isBlockedByMe: blocked,
        isBlockedByThem: false,
      },
      [blockerId],
    );

    // The blocked user's view: it was placed on them.
    push(
      {
        blocked,
        actorId: blockerId,
        targetUserId: blockerId,
        otherUserId: blockerId,
        isBlockedByMe: false,
        isBlockedByThem: blocked,
      },
      [blockedId],
    );
  }

  /**
   * The authenticated user's own blocked list, for Settings -> Privacy ->
   * Blocked Contacts.
   *
   * Only ever reads blocks *made by* this user (`blockerId`), never blocks
   * received: the screen shows who you blocked, and a user must never be able
   * to learn that they appear on someone else's list. The caller id always
   * comes from the JWT, so there is no parameter that could address another
   * user's list.
   *
   * Ordered newest-block-first and paginated, since a long-lived account can
   * accumulate more entries than one screen should fetch.
   */
  async getBlockedContacts(blockerId: string, limit = 20, offset = 0) {
    const take = Math.min(Math.max(limit, 1), 50);
    const skip = Math.max(offset, 0);

    // One extra row tells us whether another page exists without a COUNT.
    const rows = await this.blocksService.listBlockedContacts(
      blockerId,
      take,
      skip,
    );

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;

    return {
      contacts: page.map((row) => {
        // A soft-deleted account keeps its Block row, so the entry stays
        // listed (and stays unblockable) but is shown anonymously rather than
        // leaking the name of an account that no longer exists.
        const isDeleted = !row.blocked || row.blocked.deletedAt !== null;
        return {
          id: row.blockedId,
          displayName: isDeleted ? 'Deleted Account' : row.blocked.displayName,
          username: isDeleted ? null : row.blocked.username,
          avatar: isDeleted ? null : row.blocked.avatar,
          isDeleted,
          blockedAt: row.createdAt,
        };
      }),
      hasMore,
      nextOffset: hasMore ? skip + take : null,
    };
  }

  async unblockUser(blockerId: string, blockedId: string) {
    await this.blocksService.removeBlock(blockerId, blockedId);
    // Invalidate cached block lists for both users
    await this.blocksService.invalidateBlockCache(blockerId, blockedId);
    await this.invalidateConversationListCache([blockerId, blockedId]);

    // The reverse of the block event, so a composer that was disabled live
    // re-enables live too. An unblock the other side only learns about on
    // reload leaves them looking at a restriction that no longer exists.
    this.emitBlockState('user:unblocked', blockerId, blockedId, false);

    return { success: true, blocked: false };
  }

  /**
   * Bust the conversation-list Redis cache for the given users: the first page
   * at the common page sizes, keyed exactly as MessagesService writes it (see
   * conversation-list-cache.ts). Kept here to avoid a MessagesService <-> UsersService
   * circular dependency.
   */
  private async invalidateConversationListCache(userIds: string[]) {
    const redis = this.redisService?.getClient?.();
    if (!redis) return;
    const keys = userIds.flatMap(conversationListFirstPageKeys);
    if (keys.length > 0) await redis.del(...keys).catch(() => {});
  }

  async getConnections(
    userId: string,
    query?: string,
    limit: number = 50,
  ): Promise<ConnectionUser[]> {
    const cleanQuery = (query || '').trim().toLowerCase();

    // Short-lived Redis cache: the invite/share "people" list is opened
    // repeatedly and is identical for a user within a few seconds. This turns
    // repeat modal opens (and each keystroke that repeats an earlier query)
    // into an O(1) cache hit instead of a fresh DB round-trip + pool acquire.
    const redis = this.redisService?.getClient?.();
    // `v2` because the value shape changed meaning, not structure: entries
    // written by the previous build hold unverified users and would keep
    // serving them for the whole TTL after a deploy. A new prefix retires them
    // instantly instead of leaving a 20-second window where the rule does not
    // apply.
    //
    // `v4` retired the v3 entries written while the (since removed) first-year
    // isolation filter applied; `v5` retires the newest-first order this list
    // had before it was ranked by closeness. The key is scoped by `userId`, which is what
    // makes caching a block-filtered list safe at all.
    const cacheKey = `connections:v5:${userId}:${cleanQuery}:${limit}`;
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached) as ConnectionUser[];
      } catch {
        // A cache miss and an unreachable Redis are the same thing here: fall through to the query.
      }
    }

    const baseWhere: Prisma.UserWhereInput = {
      id: { not: userId },
      accountStatus: 'ACTIVE',
      // Verified accounts only, decided in the query rather than after it.
      //
      // This list is the recipient picker for every Invite flow, and the send
      // it feeds is already refused for an ineligible recipient by
      // `assertUsersEligible`. Offering one was therefore presenting a choice
      // that could only end in an error, and it disclosed the existence and
      // handle of an account the viewer is not allowed to reach.
      //
      // It has to be here rather than in a `.filter()` afterwards for two
      // reasons: `take: limit` is applied by the database, so post-filtering
      // silently shrinks pages and eventually returns an empty one while more
      // eligible users exist further down; and the unfiltered rows would
      // already have been written to the Redis entry below.
      ...this.verificationAccess.eligibleUserWhere(),
      ...(cleanQuery
        ? {
            OR: [
              { displayName: { contains: cleanQuery, mode: 'insensitive' } },
              { username: { contains: cleanQuery, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const whereClause = await this.blocksService.injectBlockFilter(
      userId,
      baseWhere,
      'id',
    );

    // Who the viewer is close to, and candidates that respect that: see
    // people-picker.ts. Every query below is intersected with `whereClause`,
    // so the verification and block rules above still decide eligibility.
    const social = await this.pickerSocial(userId);
    const POOL = 100;
    let candidates: ConnectionUser[];
    if (cleanQuery) {
      // Three pools: the viewer's own people who match (so a friend with the
      // text mid-name is never crowded out by strangers), starts-with
      // matches, and everyone else who contains it.
      const known = closestIds(social, 500);
      const [mine, startsWith, contains] = await Promise.all([
        known.length > 0
          ? this.prisma.user.findMany({
              where: { AND: [whereClause, { id: { in: known } }] },
              take: POOL,
              select: CONNECTION_SELECT,
            })
          : Promise.resolve([]),
        this.prisma.user.findMany({
          where: { AND: [whereClause, startsWithWhere(cleanQuery)] },
          take: POOL,
          select: CONNECTION_SELECT,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.user.findMany({
          where: whereClause,
          take: POOL,
          select: CONNECTION_SELECT,
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      candidates = uniqueById([...mine, ...startsWith, ...contains]);
    } else {
      const closest = closestIds(social, POOL);
      const [known, campus] = await Promise.all([
        closest.length > 0
          ? this.prisma.user.findMany({
              where: { AND: [whereClause, { id: { in: closest } }] },
              select: CONNECTION_SELECT,
            })
          : Promise.resolve([]),
        // Fill from the viewer's campus, so a new account with nobody to
        // talk to yet still sees classmates rather than an empty list.
        this.prisma.user.findMany({
          where: {
            AND: [
              whereClause,
              { id: { notIn: closest } },
              social.collegeId ? campusMemberWhere(social.collegeId) : {},
            ],
          },
          take: limit,
          select: CONNECTION_SELECT,
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      candidates = uniqueById([...known, ...campus]);
    }
    // Which candidates share the viewer's campus: one batched lookup on the
    // affiliation table (indexed by userId), not the User.collegeId mirror.
    const campusPeers = new Set<string>(
      social.collegeId && candidates.length > 0
        ? (
            await this.prisma.collegeAffiliation.findMany({
              where: {
                userId: { in: candidates.map((c) => c.id) },
                collegeId: social.collegeId,
                revokedAt: null,
              },
              select: { userId: true },
            })
          ).map((a) => a.userId)
        : [],
    );
    const payload: ConnectionUser[] = rankPickerCandidates(
      candidates,
      cleanQuery,
      social,
      campusPeers,
    ).slice(0, limit);

    if (redis) {
      // 20s TTL — long enough to make a modal session feel instant, short
      // enough that a new block/signup surfaces quickly.
      redis.setex(cacheKey, 20, JSON.stringify(payload)).catch(() => {});
    }

    return payload;
  }

  /** The viewer's closeness signals for the people pickers. */
  private async pickerSocial(userId: string): Promise<PickerSocial> {
    const [me, following, followers, recentConvs] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { collegeAffiliation: { select: ACTIVE_AFFILIATION_SELECT } },
      }),
      this.prisma.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
      this.prisma.follow.findMany({
        where: { followingId: userId },
        select: { followerId: true },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
      this.prisma.conversationParticipant.findMany({
        where: { userId, deletedAt: null, conversation: { type: 'DM' } },
        select: { conversationId: true },
        orderBy: { conversation: { updatedAt: 'desc' } },
        take: 30,
      }),
    ]);
    const convOrder = recentConvs.map((c) => c.conversationId);
    const partners =
      convOrder.length > 0
        ? await this.prisma.conversationParticipant.findMany({
            where: {
              conversationId: { in: convOrder },
              userId: { not: userId },
            },
            select: { conversationId: true, userId: true },
          })
        : [];
    const recentChat = new Map<string, number>();
    for (const p of partners) {
      const rank = convOrder.indexOf(p.conversationId);
      const prev = recentChat.get(p.userId);
      if (prev === undefined || rank < prev) recentChat.set(p.userId, rank);
    }
    return {
      recentChat,
      following: new Set(following.map((f) => f.followingId)),
      followers: new Set(followers.map((f) => f.followerId)),
      collegeId: activeAffiliationCollegeId(me?.collegeAffiliation),
    };
  }

  /**
   * @mention candidates, from three pools so a crowd of newer accounts that
   * merely contain the query can push out neither an exact @username nor
   * someone the viewer knows: the viewer's own people, starts-with matches,
   * and the newest contains-matches.
   */
  private async mentionCandidates(
    whereClause: Prisma.UserWhereInput,
    cleanQuery: string,
    knownIds: string[],
  ) {
    const select = {
      id: true,
      username: true,
      displayName: true,
      avatar: true,
      isCampusRep: true,
      collegeId: true,
      college: { select: { id: true, name: true } },
    } satisfies Prisma.UserSelect;
    const pool = UsersService.MENTION_CANDIDATE_POOL;
    const known = [...new Set(knownIds)].slice(0, 500);
    const [mine, first, rest] = await Promise.all([
      // The viewer's own people who match: never crowded out by strangers.
      // With no query this is simply "people you know", which is what a bare
      // "@" should open with.
      known.length > 0
        ? this.prisma.user.findMany({
            where: { AND: [whereClause, { id: { in: known } }] },
            take: pool,
            select,
          })
        : Promise.resolve([]),
      cleanQuery
        ? this.prisma.user.findMany({
            where: { AND: [whereClause, startsWithWhere(cleanQuery)] },
            take: pool,
            select,
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
      this.prisma.user.findMany({
        where: whereClause,
        take: pool,
        select,
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return uniqueById([...mine, ...first, ...rest]);
  }

  // Candidate pool pulled from the DB before scoring — bounded regardless of
  // how many users match the query, so this never scales with total user count.
  private static readonly MENTION_CANDIDATE_POOL = 50;
  private static readonly MENTION_RECENT_CONVERSATIONS = 10;

  /**
   * Server-side @mention suggestion search. Replaces the old client pattern of
   * fetching the entire user table into the browser and scoring in JS — here
   * only a bounded, already-matched candidate pool (<= 50 rows) ever leaves
   * the DB, and every ranking signal (mutuals, recent chats, community
   * membership) is computed with indexed, batched queries instead of an
   * O(users) client-side loop.
   */
  async getMentionSuggestions(
    userId: string,
    query: string,
    communityId?: string,
    limit: number = 15,
  ) {
    const cleanQuery = (query || '').trim().toLowerCase();

    // Stage 1 — everything that depends on nothing but `userId`. The block
    // lookup used to be awaited on its own before this batch even started,
    // adding a full round-trip to every request; only the candidate query
    // actually needs its result, so it runs here alongside the rest.
    const [
      excludedUserIds,
      followingRows,
      followerRows,
      communityMemberRows,
      recentConvs,
    ] = await Promise.all([
      this.blocksService.getExcludedUserIds(userId),
      this.prisma.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true },
      }),
      this.prisma.follow.findMany({
        where: { followingId: userId },
        select: { followerId: true },
      }),
      communityId
        ? this.prisma.communityMember.findMany({
            where: { communityId },
            select: { userId: true },
          })
        : Promise.resolve([] as { userId: string }[]),
      this.prisma.conversationParticipant.findMany({
        where: { userId, deletedAt: null },
        select: { conversationId: true },
        orderBy: { conversation: { updatedAt: 'desc' } },
        take: UsersService.MENTION_RECENT_CONVERSATIONS,
      }),
    ]);

    const excludeSet = new Set([...excludedUserIds, userId]);

    const whereClause: Prisma.UserWhereInput = {
      id: { notIn: Array.from(excludeSet) },
      accountStatus: 'ACTIVE',
      ...(cleanQuery
        ? {
            OR: [
              { username: { contains: cleanQuery, mode: 'insensitive' } },
              { displayName: { contains: cleanQuery, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const recentConvIds = recentConvs.map((c) => c.conversationId);

    // Stage 2 — recent-chat partners first: they are part of "the viewer's
    // own people", which the candidate pool has to include so someone just
    // messaged is never crowded out by newer accounts with a similar name.
    const recentParticipants =
      recentConvIds.length > 0
        ? await this.prisma.conversationParticipant.findMany({
            where: {
              conversationId: { in: recentConvIds },
              userId: { not: userId },
            },
            select: { userId: true },
          })
        : [];
    const candidates = await this.mentionCandidates(whereClause, cleanQuery, [
      ...recentParticipants.map((p) => p.userId),
      ...followingRows.map((f) => f.followingId),
      ...followerRows.map((f) => f.followerId),
    ]);

    if (candidates.length === 0) return [];

    const followingIds = followingRows.map((f) => f.followingId);
    const followingSet = new Set(followingIds);
    const followerSet = new Set(followerRows.map((f) => f.followerId));
    const communityMemberSet = new Set(
      communityMemberRows.map((m) => m.userId),
    );

    const recentChatUserIdSet = new Set(
      recentParticipants.map((p) => p.userId),
    );

    // Mutual-connection count per candidate: how many people I follow also
    // follow that candidate. One batched query for the whole candidate set
    // instead of an N+1 per-row lookup.
    const candidateIds = candidates.map((c) => c.id);
    const mutualRows =
      followingIds.length > 0 && candidateIds.length > 0
        ? await this.prisma.follow.findMany({
            where: {
              followerId: { in: followingIds },
              followingId: { in: candidateIds },
            },
            select: { followingId: true },
          })
        : [];
    const mutualCountMap = new Map<string, number>();
    mutualRows.forEach((m) =>
      mutualCountMap.set(
        m.followingId,
        (mutualCountMap.get(m.followingId) || 0) + 1,
      ),
    );

    const scored = candidates.map((u) => {
      // Match quality first (see people-picker.ts): the tier is worth more
      // than every relationship signal combined, so "@ash" puts "ashley"
      // above a close friend who merely has "ash" in the middle of a name.
      let score = matchTier(u, cleanQuery) * 100000;

      const isFollowing = followingSet.has(u.id);
      const isFollower = followerSet.has(u.id);
      if (isFollowing && isFollower) score += 10000;
      else if (isFollowing || isFollower) score += 7000;

      if (recentChatUserIdSet.has(u.id)) score += 4000;
      if (communityMemberSet.has(u.id)) score += 2000;

      return {
        user: {
          id: u.id,
          username: u.username,
          displayName: u.displayName || u.username,
          avatar: u.avatar,
          mutualCount: mutualCountMap.get(u.id) || 0,
        },
        score,
      };
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.user.displayName.localeCompare(b.user.displayName);
    });

    return scored.slice(0, limit).map((s) => s.user);
  }

  /**
   * "Online Friends" sidebar widget data — mutual connections (I follow them
   * AND they follow me) who are currently online, respecting each user's own
   * presence-visibility settings. Computed entirely server-side and capped to
   * `limit` so the client never has to fetch a page of users and re-derive
   * "is this a mutual, is this a friend" in JS — the client-facing hooks
   * used to pull the 20 most-recently-created accounts (getAllUsers's
   * default) and filter down to online mutuals from *that* set, which meant
   * the widget could easily show zero or the wrong people even when the
   * viewer had online friends outside that arbitrary recent-signup window.
   */
  async getOnlineFriends(userId: string, limit: number = 6) {
    // Mutuals in ONE query. This used to be three sequential round-trips
    // (my following → who of those follows me back → hydrate those users),
    // where each step had to wait for the previous step's id list. Expressing
    // "follows me AND I follow them" as two relation filters lets Postgres do
    // the intersection with the existing Follow indexes and hands back the
    // hydrated rows directly.
    const candidates = await this.prisma.user.findMany({
      where: {
        accountStatus: 'ACTIVE',
        followers: { some: { followerId: userId } }, // I follow them
        following: { some: { followingId: userId } }, // they follow me
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        isCampusRep: true,
        collegeId: true,
        college: { select: { id: true, name: true } },
        avatar: true,
        settings: { select: { showOnlineStatus: true, whoCanSeeOnline: true } },
      },
    });
    if (candidates.length === 0) return [];

    const presenceMap = await this.presenceService.getPresenceMany(
      candidates.map((u) => u.id),
    );

    // Only bother with a privacy check for users actually reporting online —
    // avoids doing visibility work for the (usually majority) offline mutuals.
    const onlineCandidates = candidates.filter(
      (u) => presenceMap.get(u.id)?.status === 'online',
    );
    if (onlineCandidates.length === 0) return [];

    // One batched visibility resolution instead of a sequential
    // checkPresenceVisibility call per online mutual — that loop re-read the
    // viewer's own userSettings row once per candidate and issued up to two
    // more follow lookups each, all strictly serialized by the `await`.
    const visibleIds = await resolvePresenceVisibilityForViewer(
      userId,
      onlineCandidates.map((u) => ({
        userId: u.id,
        rule: u.settings?.whoCanSeeOnline || 'everyone',
        isEnabled: u.settings?.showOnlineStatus !== false,
      })),
      this.prisma,
      this.blocksService,
    );

    const results: Array<{
      id: string;
      username: string;
      displayName: string;
      avatar: string | null;
      isOnline: true;
    }> = [];
    for (const u of onlineCandidates) {
      if (!visibleIds.has(u.id)) continue;
      results.push({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatar: u.avatar,
        isOnline: true,
      });
      if (results.length >= limit) break;
    }

    return results;
  }

  /**
   * "Who to follow" — the profile sidebar's recommendation list.
   *
   * This surface had no endpoint at all. The client built it by merging
   * `GET /users?limit=20` (the twenty most recently created accounts), the
   * campus list, and every participant of every open conversation, then
   * filtered that pile against `currentUser.followingList` in JavaScript.
   * Three things followed from that, all of them user-visible:
   *
   *   1. None of those payloads carried follow state, so the button's
   *      `isFollowing` was `undefined` for every row and rendered "Follow"
   *      whatever the database said.
   *   2. Follow state therefore came from a cached array on the client, which
   *      a stale `/auth/sync` could — and did — overwrite with a pre-follow
   *      snapshot.
   *   3. The candidate pool was whoever happened to be in those caches, so
   *      once a viewer had followed most of them the panel simply emptied.
   *
   * The list is computed here instead, in ONE database round-trip, and every
   * row carries `isFollowing` read from the `Follow` table. Excluded: the
   * viewer, accounts they already follow, either side of a block, and
   * unavailable accounts.
   *
   * Ranking, highest first: mutual connections (people the viewer follows who
   * follow this candidate), same college, campus rep, follower count. Ties
   * break on id, so the RANKING is deterministic.
   *
   * The SELECTION is not. A strict top-N of a deterministic ranking gave every
   * viewer the same three faces on every visit — the panel looked broken
   * rather than personalised, and an account you did not want to follow could
   * never be replaced by one you did. So the query returns a pool of the
   * best-ranked candidates and `limit` of them are drawn at random from it.
   * Everything in the pool has already earned its place, so randomising within
   * it trades no relevance for the variety; and because it is drawn per
   * request, a reload produces a different valid selection.
   *
   * Sampling here rather than with `ORDER BY random()` in SQL keeps the
   * ranking itself index-friendly: Postgres can stop at the pool size instead
   * of sorting every eligible row by a random value.
   *
   * Cost: the candidate pool is bounded by `POOL` before any of the scoring
   * joins run, so the aggregate work is proportional to the pool, never to the
   * size of the user table or to how many people the viewer follows. A viewer
   * with 10,000 follows pays the same as one with 10.
   */
  async getFollowRecommendations(userId: string, limit = 10) {
    if (!userId) return [];

    // How many ranked candidates to draw from. Wide enough that the panel
    // visibly changes between reloads, narrow enough that everything in it is
    // still a good suggestion. Clamped so a limit of 1 does not sample from a
    // pool of 8, and a limit of 30 does not pull the whole table.
    const sampleFrom = Math.min(Math.max(limit * 8, 24), 60);

    // Bounded arms rather than one ORDER BY over the whole table: the campus
    // arm walks the viewer's college's affiliations (`CollegeAffiliation
    // [collegeId]`), the platform arm `[accountStatus, createdAt DESC]`. The campus arm is what makes the suggestions feel local;
    // the platform arm keeps the panel populated for an account with no
    // college, or one that has already followed its whole campus.
    const POOL = 120;

    // How many of the viewer's own follows seed the friends-of-friends arm.
    // Their most recent ones: a bound, so a viewer following thousands pays
    // the same as one following two hundred.
    const SEED_FOLLOWS = 200;

    const rows = await this.prisma.$queryRaw<RecommendationRow[]>(Prisma.sql`
      WITH me AS (
        -- "collegeId" is the viewer's ACTIVE affiliation college (campus
        -- access), not the User.collegeId mirror.
        SELECT
          vu."id",
          ${activeAffiliationCollegeIdSql(Prisma.raw('vu."id"'))} AS "collegeId",
          vu."branch", vu."batchYear",
          ARRAY(SELECT DISTINCT lower(trim(i)) FROM unnest(vu."interests") i) AS "interests"
        FROM "User" vu WHERE vu."id" = ${userId} LIMIT 1
      ),
      eligible AS (
        SELECT u."id", u."collegeId", u."createdAt"
        FROM "User" u, me
        WHERE u."id" <> me."id"
          AND u."accountStatus" = 'ACTIVE'
          AND u."deletedAt" IS NULL
          -- Already-followed accounts are excluded from GENERATION only. Once
          -- a row has been handed to the client it stays on screen and its
          -- button flips to "Following"; the exclusion applies the next time
          -- the list is generated, which is what makes a refresh bring in new
          -- faces instead of yanking someone out from under the cursor.
          AND NOT EXISTS (
            SELECT 1 FROM "Follow" f
            WHERE f."followerId" = me."id" AND f."followingId" = u."id"
          )
          AND NOT EXISTS (
            SELECT 1 FROM "Block" b
            WHERE (b."blockerId" = me."id" AND b."blockedId" = u."id")
               OR (b."blockerId" = u."id" AND b."blockedId" = me."id")
          )
      ),
      my_follows AS (
        SELECT f."followingId" AS "id"
        FROM "Follow" f, me
        WHERE f."followerId" = me."id"
        ORDER BY f."createdAt" DESC
        LIMIT ${SEED_FOLLOWS}
      ),
      -- Four arms. The two recency arms were all there was before, which
      -- meant an older account with five mutual friends could never enter the
      -- pool at all: mutuals were scored, but only among the newest sign-ups.
      -- The graph arms bring in the people the viewer is most likely to know.
      fof_arm AS (
        SELECT f2."followingId" AS "id"
        FROM my_follows mf
        JOIN "Follow" f2 ON f2."followerId" = mf."id"
        JOIN eligible e ON e."id" = f2."followingId"
        GROUP BY f2."followingId"
        ORDER BY COUNT(*) DESC
        LIMIT ${POOL}
      ),
      follows_me_arm AS (
        SELECT f."followerId" AS "id"
        FROM "Follow" f
        CROSS JOIN me
        JOIN eligible e ON e."id" = f."followerId"
        WHERE f."followingId" = me."id"
        ORDER BY f."createdAt" DESC
        LIMIT ${POOL}
      ),
      -- Verified members of the viewer's campus: through the affiliation
      -- table (indexed on collegeId), so a legacy row that only carries the
      -- User.collegeId mirror is not presented as a classmate.
      campus_arm AS (
        SELECT e."id"
        FROM me
        JOIN "CollegeAffiliation" ca
          ON ca."collegeId" = me."collegeId" AND ca."revokedAt" IS NULL
        JOIN eligible e ON e."id" = ca."userId"
        ORDER BY e."createdAt" DESC
        LIMIT ${POOL}
      ),
      platform_arm AS (
        SELECT e."id" FROM eligible e
        ORDER BY e."createdAt" DESC
        LIMIT ${POOL}
      ),
      pool AS (
        SELECT "id" FROM fof_arm
        UNION SELECT "id" FROM follows_me_arm
        UNION SELECT "id" FROM campus_arm
        UNION SELECT "id" FROM platform_arm
      ),
      -- People the viewer follows who also follow the candidate. One grouped
      -- join over the bounded pool, not a lookup per row.
      mutuals AS (
        SELECT
          f2."followingId" AS "id",
          COUNT(*)::int AS "mutualCount",
          -- One of them, by name, for "Followed by X + 2 others".
          (array_agg(mf."id" ORDER BY mf."id"))[1] AS "mutualSampleId"
        FROM my_follows mf
        JOIN "Follow" f2 ON f2."followerId" = mf."id"
        JOIN pool p ON p."id" = f2."followingId"
        GROUP BY f2."followingId"
      ),
      follower_counts AS (
        SELECT f."followingId" AS "id", COUNT(*)::int AS "followerCount"
        FROM "Follow" f
        JOIN pool p ON p."id" = f."followingId"
        GROUP BY f."followingId"
      ),
      shared_communities AS (
        SELECT cm2."userId" AS "id", COUNT(*)::int AS "sharedCommunities"
        FROM "CommunityMember" cm1
        CROSS JOIN me
        JOIN "CommunityMember" cm2 ON cm2."communityId" = cm1."communityId"
        JOIN pool p ON p."id" = cm2."userId"
        JOIN "Community" c ON c."id" = cm1."communityId" AND c."deletedAt" IS NULL
        WHERE cm1."userId" = me."id"
        GROUP BY cm2."userId"
      ),
      signals AS (
        SELECT
          u."id",
          COALESCE(m."mutualCount", 0) AS "mutualCount",
          m."mutualSampleId",
          COALESCE(fc."followerCount", 0) AS "followerCount",
          COALESCE(sc."sharedCommunities", 0) AS "sharedCommunities",
          EXISTS (
            SELECT 1 FROM "Follow" fb
            WHERE fb."followerId" = u."id" AND fb."followingId" = me."id"
          ) AS "followsMe",
          -- COALESCE, not a bare comparison: the equality is NULL (not false)
          -- when either side has no value, and NULL sorts FIRST under DESC.
          -- Same college = both hold an active affiliation to it (cand_aff
          -- is a unique-index join, one row per candidate at most).
          COALESCE(me."collegeId" IS NOT NULL AND cand_aff."collegeId" = me."collegeId", false) AS "sameCollege",
          COALESCE(
            me."collegeId" IS NOT NULL AND cand_aff."collegeId" = me."collegeId"
            AND me."branch" IS NOT NULL AND lower(u."branch") = lower(me."branch"),
            false
          ) AS "sameBranch",
          COALESCE(
            me."collegeId" IS NOT NULL AND cand_aff."collegeId" = me."collegeId"
            AND me."batchYear" IS NOT NULL AND u."batchYear" = me."batchYear",
            false
          ) AS "sameBatch",
          (
            SELECT COUNT(*)::int FROM (
              SELECT DISTINCT lower(trim(i)) FROM unnest(u."interests") i
              INTERSECT SELECT unnest(me."interests")
            ) x
          ) AS "sharedInterests",
          GREATEST(
            cardinality(me."interests") + (
              SELECT COUNT(DISTINCT lower(trim(i)))::int FROM unnest(u."interests") i
            ),
            1
          ) AS "interestTotal",
          COALESCE(u."lastSeenAt" > now() - interval '7 days', false) AS "activeRecently"
        FROM pool p
        JOIN "User" u ON u."id" = p."id"
        CROSS JOIN me
        LEFT JOIN mutuals m ON m."id" = u."id"
        LEFT JOIN follower_counts fc ON fc."id" = u."id"
        LEFT JOIN shared_communities sc ON sc."id" = u."id"
        LEFT JOIN "CollegeAffiliation" cand_aff
          ON cand_aff."userId" = u."id" AND cand_aff."revokedAt" IS NULL
      ),
      scored AS (
        SELECT
          s.*,
          -- Each term is about how likely the viewer is to KNOW this person,
          -- which is what a follow suggestion is for. Graph signals dominate;
          -- popularity is a log-damped tiebreaker so a campus celebrity does
          -- not outrank someone from the viewer's own class.
          (
            CASE WHEN s."followsMe" THEN 4.0 ELSE 0 END
            + 3.0 * ln(1 + s."mutualCount")
            + CASE WHEN s."sameBranch" THEN 1.5 ELSE 0 END
            + CASE WHEN s."sameBatch" THEN 1.0 ELSE 0 END
            + CASE WHEN s."sameCollege" THEN 1.0 ELSE 0 END
            + 1.2 * ln(1 + s."sharedCommunities")
            -- Jaccard: shared / (|A| + |B| - shared). Shared/union, so a
            -- profile listing every interest does not match everyone.
            + 2.5 * s."sharedInterests"::float
                / GREATEST(s."interestTotal" - s."sharedInterests", 1)
            + CASE WHEN s."activeRecently" THEN 0.5 ELSE 0 END
            + 0.3 * ln(1 + s."followerCount")
          )::float AS "score"
        FROM signals s
      )
      SELECT
        u."id",
        u."username",
        u."displayName",
        u."avatar",
        u."bio",
        u."isCampusRep",
        u."collegeId",
        c."name" AS "collegeName",
        u."verificationStatus",
        sc."mutualCount",
        sc."followerCount",
        sc."sameCollege",
        sc."sameBranch",
        sc."followsMe",
        sc."sharedCommunities",
        sc."sharedInterests",
        sc."score",
        COALESCE(NULLIF(mu."displayName", ''), mu."username") AS "mutualSampleName"
      FROM scored sc
      JOIN "User" u ON u."id" = sc."id"
      LEFT JOIN "College" c ON c."id" = u."collegeId"
      LEFT JOIN "User" mu ON mu."id" = sc."mutualSampleId"
      ORDER BY sc."score" DESC, u."isCampusRep" DESC, u."id" ASC
      LIMIT ${sampleFrom};
    `);

    // A pool smaller than `limit` is returned whole — a new account, or one
    // that has already followed most of its campus, still gets whatever is
    // left rather than an empty panel.
    return weightedSample(
      rows.map((r) => ({ ...r, score: Number(r.score || 0) })),
      limit,
    ).map((r) => ({
      id: r.id,
      username: r.username,
      displayName: r.displayName || r.username,
      avatar: r.avatar,
      bio: r.bio,
      isCampusRep: !!r.isCampusRep,
      collegeId: r.collegeId,
      college: r.collegeName || null,
      verified: r.verificationStatus === 'VERIFIED',
      mutualCount: Number(r.mutualCount || 0),
      followersCount: Number(r.followerCount || 0),
      // Additive: a client that predates these fields ignores them.
      mutualSampleName: r.mutualSampleName,
      // Additive: a client that predates it ignores the field.
      reason: pickReason({
        score: r.score,
        followsMe: !!r.followsMe,
        mutualCount: Number(r.mutualCount || 0),
        sameBranch: !!r.sameBranch,
        sharedCommunities: Number(r.sharedCommunities || 0),
        sharedInterests: Number(r.sharedInterests || 0),
        sameCollege: !!r.sameCollege,
      }),
      // Always false by construction — the query excludes what the viewer
      // already follows. Emitted explicitly all the same, so this payload is
      // self-describing and a consumer never has to infer follow state from
      // the absence of a field. That inference is the bug this whole change
      // exists to remove.
      isFollowing: false,
    }));
  }

  /**
   * Self-service account deletion now lives in `AccountDeletionService` /
   * `AccountDeletionPurgeService`.
   *
   * The method that used to be here anonymized the row, scrubbed every
   * relation and revoked the Supabase identity synchronously, inside the
   * request that asked for it — which made the action irreversible the instant
   * it was confirmed and left no window to change your mind. It was replaced
   * rather than wrapped because the two halves it conflated (become invisible,
   * be erased) now happen 30 days apart and have different failure modes.
   *
   * `DELETE /api/users/me` still exists and forwards to the request half.
   */
}
