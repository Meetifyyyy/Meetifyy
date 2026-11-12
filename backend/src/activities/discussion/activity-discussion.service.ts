import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ACTIVE_AFFILIATION_SELECT,
  activeAffiliationCollegeId,
} from '../../common/campus/campus-access.service';
import { DomainEventService } from '../../events/domain-event.service';
import { ActivityAuthorizationService } from '../activity-authorization.service';
import { BlocksService } from '../../users/blocks.service';
import type { UserIdentityLike } from '../../common/users/deleted-user';
import {
  isUnavailableUser,
  presentUserAvatar,
  DELETED_USER_DISPLAY_NAME,
  DELETED_USER_USERNAME,
} from '../../common/users/deleted-user';

const MAX_MESSAGE_LENGTH = 2000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Lightweight, activity-scoped discussion. There are no conversation rows of
 * its own: reading is "may this user view the activity?", resolved server-side
 * by the shared access policy on every call — a restricted activity's
 * discussion is itself restricted data — and posting additionally needs the
 * caller to be taking part in a live activity. Messages are keyed directly by
 * activityId and retrieved newest-first via the
 * ([activityId, createdAt desc, id desc]) index for fast cursor pagination.
 */
@Injectable()
export class ActivityDiscussionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly domainEventService: DomainEventService,
    private readonly activityAuthorizationService: ActivityAuthorizationService,
    private readonly blocksService: BlocksService,
  ) {}

  private static readonly messageSelect = {
    id: true,
    text: true,
    createdAt: true,
    userId: true,
    user: {
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        isCampusRep: true,
        // Required by the tombstone projection in `format`. A select that
        // omits these renders a deleted author's real name and photo in a
        // thread every other activity member can still read.
        accountStatus: true,
        deletedAt: true,
      },
    },
  } as const;

  private format<
    M extends {
      id: string;
      text: string;
      createdAt: Date;
      userId: string;
      user?: UserIdentityLike | null;
    },
  >(m: M, activityId: string) {
    return {
      id: m.id,
      activityId,
      text: m.text,
      createdAt: m.createdAt,
      userId: m.userId,
      // A message from someone who has deleted their account keeps its place
      // in the thread — removing it would rewrite the discussion for everyone
      // else — but carries no identity.
      user: (() => {
        const author = m.user;
        const unavailable = isUnavailableUser(author);
        return {
          id: author?.id || m.userId,
          username: unavailable
            ? DELETED_USER_USERNAME
            : author?.username || '',
          displayName: unavailable
            ? DELETED_USER_DISPLAY_NAME
            : author?.displayName || author?.username || 'Member',
          avatar: presentUserAvatar(author),
          isDeleted: unavailable,
          profileAvailable: !unavailable,
          // Explicit rather than omitted: the discussion row renders a campus
          // representative badge from this field, and a deleted account must
          // not keep wearing one. Setting it here means a later widening of
          // the select cannot quietly reintroduce it.
          isCampusRep: unavailable ? false : (author?.isCampusRep ?? false),
        };
      })(),
    };
  }

  /**
   * Loads the activity and asserts the caller may view it. Throws 404 when the
   * activity does not exist and 403 (detail-free body) when it does but the
   * caller is not authorized.
   */
  private async assertCanAccessDiscussion(activityId: string, userId?: string) {
    const [activity, user] = await Promise.all([
      this.prisma.crewActivity.findFirst({
        where: { id: activityId, deletedAt: null },
        select: {
          id: true,
          creatorId: true,
          collegeId: true,
          visibility: true,
          status: true,
          members: userId
            ? { where: { userId }, select: { userId: true, status: true } }
            : false,
          invitations: userId
            ? {
                where: { inviteeId: userId },
                select: {
                  inviteeId: true,
                  status: true,
                  revokedAt: true,
                  expiresAt: true,
                },
              }
            : false,
        },
      }),
      userId
        ? this.prisma.user.findUnique({
            where: { id: userId },
            select: {
              id: true,
              // COLLEGE_ONLY access follows the verified college email.
              collegeAffiliation: { select: ACTIVE_AFFILIATION_SELECT },
            },
          })
        : Promise.resolve(null),
    ]);
    if (!activity) throw new NotFoundException('Activity not found');
    this.activityAuthorizationService.assertCanView(
      user
        ? {
            id: user.id,
            collegeId: activeAffiliationCollegeId(user.collegeAffiliation),
          }
        : null,
      activity,
    );
    // A block with the host (either direction) closes the discussion to this
    // user, answered like a missing activity so the block is not disclosed.
    if (
      userId &&
      (await this.blocksService.isBlocked(userId, activity.creatorId))
    ) {
      throw new NotFoundException('Activity not found');
    }
    return activity;
  }

  /**
   * Viewing the discussion is open to anyone who may view the activity, but
   * posting is for the people taking part: the host, a joined member, or an
   * invitee who accepted (and was not since revoked). Anyone else who can merely
   * see a public activity may read along, not post. A finished or cancelled
   * activity is closed to new messages for everyone; the thread stays readable.
   * Uses the rows assertCanAccessDiscussion already loaded, so no second query.
   */
  private assertCanPost(
    activity: Awaited<ReturnType<typeof this.assertCanAccessDiscussion>>,
    userId: string,
  ): void {
    const isParticipant =
      activity.creatorId === userId ||
      (Array.isArray(activity.members) &&
        activity.members.some(
          (m) => m.userId === userId && m.status === 'MEMBER',
        )) ||
      (Array.isArray(activity.invitations) &&
        activity.invitations.some(
          (i) =>
            i.inviteeId === userId && i.status === 'ACCEPTED' && !i.revokedAt,
        ));
    if (!isParticipant) {
      throw new ForbiddenException('Only people taking part can post here.');
    }
    if (activity.status === 'ENDED') {
      throw new ForbiddenException('This activity has ended.');
    }
    if (activity.status === 'CANCELLED') {
      throw new ForbiddenException('This activity was cancelled.');
    }
  }

  /**
   * Returns a page of messages in chronological order (oldest → newest) so the
   * client can render/prepend directly. `nextCursor` is the id of the oldest
   * message returned; pass it back as `before` to load older messages.
   */
  async getMessages(
    activityId: string,
    userId: string,
    before?: string,
    limit: number = DEFAULT_PAGE_SIZE,
  ) {
    const take = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);

    // The access check, the cursor row and the viewer's block list are
    // independent, so they run together rather than one after another: this is
    // called for every page of a thread. Nothing from the last two is returned
    // unless the first succeeds.
    const [, cursorMsg, blockedWhere] = await Promise.all([
      this.assertCanAccessDiscussion(activityId, userId),
      before
        ? // Scoped to this activity: an id from another thread is not a cursor
          // into this one, and must not be able to probe other threads' timing.
          this.prisma.activityDiscussionMessage.findFirst({
            where: { id: before, activityId },
            select: { createdAt: true, id: true },
          })
        : Promise.resolve(null),
      // Messages from people the viewer is blocked with (either direction) are
      // left out in the query, so the keyset page size stays honest.
      this.blocksService.injectBlockFilter(userId, { activityId }, 'userId'),
    ]);

    const where: Prisma.ActivityDiscussionMessageWhereInput = cursorMsg
      ? {
          AND: [
            blockedWhere,
            {
              OR: [
                { createdAt: { lt: cursorMsg.createdAt } },
                { createdAt: cursorMsg.createdAt, id: { lt: cursorMsg.id } },
              ],
            },
          ],
        }
      : blockedWhere;

    const rows = await this.prisma.activityDiscussionMessage.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      select: ActivityDiscussionService.messageSelect,
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return {
      messages: page.map((m) => this.format(m, activityId)).reverse(),
      nextCursor,
      hasMore,
    };
  }

  async sendMessage(activityId: string, userId: string, text: string) {
    const trimmed = (text || '').trim();
    if (!trimmed) throw new BadRequestException('Message cannot be empty');
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(
        `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`,
      );
    }

    const activity = await this.assertCanAccessDiscussion(activityId, userId);
    this.assertCanPost(activity, userId);

    const created = await this.prisma.activityDiscussionMessage.create({
      data: { activityId, userId, text: trimmed },
      select: ActivityDiscussionService.messageSelect,
    });

    const message = this.format(created, activityId);

    // Fan out to everyone currently viewing the activity (they joined the
    // `activity_<id>` socket room). Room-only broadcast — no participant set.
    void this.domainEventService.emit('activity_discussion.created', {
      activityId,
      message,
    });

    return message;
  }
}
