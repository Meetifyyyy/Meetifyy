import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PresenceService } from '../presence/presence.service';
import { DomainEventService } from '../events/domain-event.service';
import { MediaCleanupService } from '../uploads/media-cleanup.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { clearAuthSyncCache } from '../auth/auth.service';
import { DELETED_USER_DISPLAY_NAME } from '../common/users/deleted-user';
import {
  PURGE_BATCH_SIZE,
  PURGE_LEASE_MS,
  PURGE_MAX_ATTEMPTS,
  PURGE_TRANSACTION_MAX_WAIT_MS,
  PURGE_TRANSACTION_TIMEOUT_MS,
} from './account-deletion.constants';

export interface PurgeSweepResult {
  claimed: number;
  purged: number;
  failed: number;
}

/**
 * The irreversible half of the lifecycle: permanent deletion once the 30-day
 * window has expired.
 *
 * ── Why the User row survives ─────────────────────────────────────────────
 * `Message.senderId` is `onDelete: Cascade`. Deleting the row would therefore
 * erase every message this person ever sent *out of the other participant's
 * conversation*, which is exactly the outcome the product must not have.
 * `Comment.authorId` cascades the same way. So permanent deletion is an
 * anonymization in place: the row is stripped of every identifying field and
 * left as a tombstone that the serialization layer renders as "Deleted User".
 * Everything genuinely owned solely by this person — posts, activities, their
 * media — is hard-deleted around it.
 *
 * ── Idempotency ───────────────────────────────────────────────────────────
 * Every step is either a `deleteMany` over a predicate (a no-op the second
 * time), or a write of a fixed terminal value. A run that dies halfway leaves
 * a partially purged row that the next sweep re-claims once its lease goes
 * stale and finishes; running the whole purge twice on the same user produces
 * the same end state and no errors.
 */
@Injectable()
export class AccountDeletionPurgeService {
  private readonly logger = new Logger(AccountDeletionPurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly presenceService: PresenceService,
    private readonly domainEventService: DomainEventService,
    @Optional() private readonly mediaCleanupService?: MediaCleanupService,
  ) {}

  /**
   * One sweep. Claims up to `PURGE_BATCH_SIZE` eligible accounts and purges
   * them one at a time.
   *
   * The batch bound matters: purging is a multi-statement transaction per user,
   * and an unbounded sweep after a backlog would hold locks long enough to
   * affect live traffic.
   */
  async runSweep(now: Date = new Date()): Promise<PurgeSweepResult> {
    const candidates = await this.findEligible(now);
    let purged = 0;
    let failed = 0;
    let claimed = 0;

    for (const candidate of candidates) {
      const didClaim = await this.claim(candidate.id, now);
      if (!didClaim) continue; // Recovered, or another replica took it.
      claimed += 1;

      try {
        await this.purgeUser(candidate.id);
        purged += 1;
      } catch (err) {
        failed += 1;
        await this.releaseFailedClaim(candidate.id, err as Error);
      }
    }

    if (claimed > 0) {
      this.logger.log(
        `Account purge sweep: claimed=${claimed} purged=${purged} failed=${failed}`,
      );
    }
    return { claimed, purged, failed };
  }

  /**
   * Accounts whose window has expired and which are not currently being purged
   * by a live worker.
   *
   * The lease check is what makes the sweep safe to run on several replicas and
   * safe to re-run after a crash: a claim newer than `PURGE_LEASE_MS` is
   * assumed to belong to a running worker and left alone, while an older one is
   * treated as abandoned and retried.
   */
  private async findEligible(now: Date) {
    const staleBefore = new Date(now.getTime() - PURGE_LEASE_MS);
    return this.prisma.user.findMany({
      where: {
        accountStatus: 'PENDING_DELETION',
        // The deadline. `<=` is the documented semantics: the account is
        // eligible AT `scheduledPurgeAt`, having had the full 30 days.
        scheduledPurgeAt: { lte: now },
        purgeAttempts: { lt: PURGE_MAX_ATTEMPTS },
        OR: [{ purgeStartedAt: null }, { purgeStartedAt: { lt: staleBefore } }],
      },
      select: { id: true },
      orderBy: { scheduledPurgeAt: 'asc' },
      take: PURGE_BATCH_SIZE,
    });
  }

  /**
   * Takes exclusive ownership of one row.
   *
   * This single statement is the entire race resolution against
   * `recoverAccount`. Both are conditional updates on the same row; Postgres
   * serializes them. If recovery landed first the row is ACTIVE and this
   * matches nothing, so the worker skips the user and no purge begins. If this
   * landed first, `purgeStartedAt` is non-null and recovery matches nothing, so
   * the user is told the window has closed rather than being shown a restored
   * account that is mid-erasure.
   */
  private async claim(userId: string, now: Date): Promise<boolean> {
    const staleBefore = new Date(now.getTime() - PURGE_LEASE_MS);
    const res = await this.prisma.user.updateMany({
      where: {
        id: userId,
        accountStatus: 'PENDING_DELETION',
        scheduledPurgeAt: { lte: now },
        purgeAttempts: { lt: PURGE_MAX_ATTEMPTS },
        OR: [{ purgeStartedAt: null }, { purgeStartedAt: { lt: staleBefore } }],
      },
      data: { purgeStartedAt: now, purgeAttempts: { increment: 1 } },
    });
    return res.count === 1;
  }

  /**
   * Records a failure and hands the row back so a later sweep retries it.
   *
   * Deliberately does not roll the account back to a non-pending state: the
   * user asked for deletion and the window has expired, so the correct outcome
   * is still deletion, just later. After `PURGE_MAX_ATTEMPTS` the sweep stops
   * picking it up and it surfaces as failed in the admin queue for a human,
   * rather than retrying forever against a broken dependency.
   */
  private async releaseFailedClaim(userId: string, err: Error): Promise<void> {
    this.logger.error(
      `Purge failed for user ${userId}: ${err?.message}`,
      err?.stack,
    );
    try {
      await this.prisma.user.updateMany({
        where: { id: userId, accountStatus: 'PENDING_DELETION' },
        data: {
          purgeStartedAt: null,
          purgeLastError: (err?.message ?? 'unknown error').slice(0, 500),
        },
      });
    } catch (releaseErr) {
      // The lease expires on its own, so even this failing self-heals.
      const message =
        releaseErr instanceof Error ? releaseErr.message : String(releaseErr);
      this.logger.error(
        `Could not record purge failure for ${userId}: ${message}`,
      );
    }
  }

  /**
   * Permanently deletes one account. Safe to call twice.
   *
   * Order matters in one place only: media object keys are collected *inside*
   * the transaction, before the rows referencing them are deleted, and the
   * storage deletes are issued *after* it commits. Deleting from R2 first would
   * orphan live rows if the transaction then rolled back; deleting inside it
   * would leave objects orphaned in storage if it rolled back after the call.
   */
  async purgeUser(userId: string): Promise<{ purged: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        avatar: true,
        cover: true,
        accountStatus: true,
        purgeCompletedAt: true,
      },
    });

    if (!user) return { purged: false };
    // Already finished by an earlier run — idempotent no-op.
    if (user.accountStatus === 'DELETED' && user.purgeCompletedAt) {
      return { purged: false };
    }

    // From here the account can no longer be recovered, so the session goes.
    JwtGuard.revokeUser(userId);
    clearAuthSyncCache(userId);

    const mediaKeys: string[] = [];
    const pushKey = (value: string | null | undefined) => {
      const key = this.mediaCleanupService?.extractStorageKey(value ?? null);
      if (key) mediaKeys.push(key);
    };
    pushKey(user.avatar);
    pushKey(user.cover);

    const now = new Date();
    const anonUsername = `deleted_${userId.slice(0, 8)}_${Date.now()}`;
    const anonEmail = `deleted_${userId}@deleted.meetifyy`;

    await this.prisma.$transaction(
      async (tx) => {
        // 1. Anonymize the row in place. It stays because messages and comments
        //    cascade off it (see the class comment) — this is the tombstone every
        //    "Deleted User" rendering resolves to.
        await tx.user.update({
          where: { id: userId },
          data: {
            accountStatus: 'DELETED',
            deletedAt: user.accountStatus === 'DELETED' ? undefined : now,
            purgeCompletedAt: now,
            purgeLastError: null,
            displayName: DELETED_USER_DISPLAY_NAME,
            username: anonUsername,
            email: anonEmail,
            collegeEmail: null,
            collegeId: null,
            avatar: null,
            avatarMediaId: null,
            cover: null,
            coverMediaId: null,
            bio: null,
            birthday: null,
            interests: [],
            location: null,
            course: null,
            branch: null,
            passingYear: null,
            profileCompleted: false,
            isCampusRep: false,
            verificationStatus: 'UNVERIFIED',
            lastSeenAt: null,
          },
        });

        // 2. Hard-delete every post this user authored. Cascades take the
        //    comments, likes, shares, hashtags, poll options/votes, post media
        //    rows — and, critically, every *other* user's PostBookmark pointing
        //    at them, so a purged post cannot linger in someone's Saved tab.
        await this.purgePosts(tx, { authorId: userId }, mediaKeys);

        // 3. Hard-delete activities this user created; cascades take their
        //    bookmarks, invitations, members and discussion messages.
        await this.purgeActivities(tx, userId, mediaKeys);

        // 4. Owned communities: hand over, or wind up if they were the only member.
        await this.purgeOwnedCommunities(tx, userId, mediaKeys, now);

        // 4b. Campus events. A published event is institutional content other
        //     students have in their calendars, so it survives its author — the
        //     serialization layer renders the creator as a tombstone instead
        //     (see campus-events.service.ts). A DRAFT was never published and is
        //     purely this person's, so it goes. Soft-delete rather than delete,
        //     because CampusEvent already has the column and the rest of the
        //     product filters on it.
        await tx.campusEvent.updateMany({
          where: { createdBy: userId, status: 'DRAFT', deletedAt: null },
          data: { deletedAt: now },
        });

        // 4c. Instant-match sessions. Pure matchmaking state, and the queue
        //     snapshots on them hold this person's campus, chosen activity and
        //     approximate coordinates — location data that must not outlive the
        //     account. Deleting the session does not touch the conversation it
        //     produced, so any chat that came out of a match is preserved for
        //     the other participant like every other conversation.
        await tx.matchSession.deleteMany({
          where: { OR: [{ userAId: userId }, { userBId: userId }] },
        });

        // 4d. Discussion messages in OTHER people's activities are deliberately
        //     NOT touched.
        //
        //     An activity discussion is a conversation among its members, and
        //     deleting one person's messages rewrites that thread for everyone
        //     else — the same objection that keeps chat history intact. The
        //     rows stay; the identity does not. `ActivityDiscussionService`
        //     resolves each author through the shared tombstone presenter, so
        //     once this transaction anonymizes the user row every one of those
        //     messages renders as "Deleted User" with the default avatar and no
        //     profile link, with its text intact.
        //
        //     Messages left in the user's OWN activities do go, but as a
        //     consequence of those activities being hard-deleted above, not as
        //     a rule about messages.

        // 4d-bis. Moderation reports.
        //
        //   The reports themselves are KEPT. A moderation record is an audit
        //   trail — who reported what, and what a moderator decided — and it
        //   describes the reporter's action as much as the subject's. It is
        //   also admin-only, so a tombstoned `reporterId` leaks nothing to
        //   users. Deleting the history would make the deletion of one account
        //   quietly erase evidence about others.
        //
        //   What DOES change is the queue. An open report about an account that
        //   no longer exists can never be actioned, so leaving it PENDING just
        //   accumulates un-workable items that a moderator has to triage and
        //   dismiss by hand, forever. They are closed here with an explicit
        //   resolution, so the record survives and the queue stays true.
        await tx.report.updateMany({
          where: {
            targetType: 'USER',
            targetId: userId,
            status: { in: ['PENDING', 'UNDER_REVIEW'] },
          },
          data: {
            status: 'RESOLVED',
            resolvedAt: now,
            resolution:
              'Closed automatically: the reported account was permanently deleted.',
          },
        });

        // Reports this user FILED about other people stay open — those are
        // still actionable, and the subject of them has done nothing to
        // warrant the report being dropped because the reporter left.

        // 4e. Support tickets. The ticket body is a support and suspension-appeal
        //     record worth keeping, but it carries a denormalized copy of the
        //     real email and name, which must not survive the account. Identity
        //     is detached; the record stays.
        await tx.supportTicket.updateMany({
          where: { userId },
          data: {
            userId: null,
            email: anonEmail,
            name: DELETED_USER_DISPLAY_NAME,
          },
        });

        // 5. Tombstone comments authored elsewhere. NOT deleted: `Comment.parent`
        //    is a self-relation without a cascade, so removing a commented-on
        //    node would either fail or strand its replies. The row survives with
        //    no text, no mentions and no identity — thread integrity intact,
        //    author invisible.
        await tx.comment.updateMany({
          where: { authorId: userId, isDeleted: false },
          data: {
            isDeleted: true,
            deletedAt: now,
            text: '',
            mentions: Prisma.DbNull,
            likeCount: 0,
          },
        });

        // 6. Any remaining media owned by the user but not hanging off a post
        //    (orphaned uploads, verification selfies, replaced avatars).
        const strayMedia = await tx.media.findMany({
          where: { ownerId: userId },
          select: { id: true, objectKey: true },
        });
        strayMedia.forEach((m) => mediaKeys.push(m.objectKey));

        // 7. Disposable relational data. None of this belongs to anyone else.
        await this.purgeUserRelations(tx, userId);
      },
      {
        // See PURGE_TRANSACTION_TIMEOUT_MS: the default 5s cannot cover a purge's
        // ~35 sequential statements against a pooled remote database.
        timeout: PURGE_TRANSACTION_TIMEOUT_MS,
        maxWait: PURGE_TRANSACTION_MAX_WAIT_MS,
      },
    );

    // 8. Post-commit storage cleanup, with its own retries. Failing here does
    //    not resurrect the account; it leaves orphaned objects, which the
    //    cleanup service logs loudly and `scripts/audit-r2-media.ts` can find.
    if (mediaKeys.length > 0 && this.mediaCleanupService) {
      await this.mediaCleanupService.queueMediaDeletion(mediaKeys);
    }

    await this.presenceService.removePresence(userId).catch(() => {});
    await this.invalidateCaches(userId);
    this.deleteSupabaseIdentity(userId);

    void this.domainEventService.emit('user.deleted', { userId });
    this.logger.log(`Account ${userId} permanently deleted`);

    return { purged: true };
  }

  /**
   * Hard-deletes posts matching `where`, collecting their media keys first.
   *
   * `parentId` is nulled across the posts' comments before the delete: the
   * comment self-relation has no cascade, so deleting a thread whose replies
   * point at a parent in the same batch would violate the FK.
   */
  private async purgePosts(
    tx: Prisma.TransactionClient,
    where: Prisma.PostWhereInput,
    mediaKeys: string[],
  ): Promise<void> {
    const posts = await tx.post.findMany({ where, select: { id: true } });
    const postIds = posts.map((p) => p.id);
    if (postIds.length === 0) return;

    const media = await tx.media.findMany({
      where: { postId: { in: postIds } },
      select: { objectKey: true },
    });
    media.forEach((m) => mediaKeys.push(m.objectKey));

    await tx.comment.updateMany({
      where: { postId: { in: postIds }, parentId: { not: null } },
      data: { parentId: null },
    });

    // Not cascaded: Notification.entityId is a loose reference, not an FK.
    await tx.notification.deleteMany({ where: { entityId: { in: postIds } } });
    await tx.mention.deleteMany({
      where: { sourceId: { in: postIds }, sourceType: 'POST' },
    });

    await tx.post.deleteMany({ where: { id: { in: postIds } } });
  }

  private async purgeActivities(
    tx: Prisma.TransactionClient,
    userId: string,
    mediaKeys: string[],
  ): Promise<void> {
    const activities = await tx.crewActivity.findMany({
      where: { creatorId: userId },
      select: { id: true, coverImage: true },
    });
    if (activities.length === 0) return;

    const ids = activities.map((a) => a.id);
    activities.forEach((a) => {
      const key = this.mediaCleanupService?.extractStorageKey(a.coverImage);
      if (key) mediaKeys.push(key);
    });

    await tx.notification.deleteMany({ where: { entityId: { in: ids } } });
    await tx.crewActivity.deleteMany({ where: { id: { in: ids } } });
  }

  /**
   * Communities are other people's, so they are never deleted out from under
   * them: ownership moves to the longest-standing remaining member (admins
   * first, by role order). Only a community where this user was the sole member
   * is wound up.
   */
  private async purgeOwnedCommunities(
    tx: Prisma.TransactionClient,
    userId: string,
    mediaKeys: string[],
    now: Date,
  ): Promise<void> {
    const owned = await tx.community.findMany({
      where: { ownerId: userId, deletedAt: null },
      select: { id: true, avatarKey: true, coverKey: true },
    });

    for (const comm of owned) {
      const successor = await tx.communityMember.findFirst({
        where: { communityId: comm.id, userId: { not: userId } },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
        select: { userId: true },
      });

      if (successor) {
        await tx.community.update({
          where: { id: comm.id },
          data: { ownerId: successor.userId },
        });
        await tx.communityMember.update({
          where: {
            userId_communityId: {
              userId: successor.userId,
              communityId: comm.id,
            },
          },
          data: { role: 'OWNER' },
        });
        this.logger.log(
          `Community ${comm.id} ownership transferred to ${successor.userId}`,
        );
        continue;
      }

      // Sole member: nothing of anyone else's is in here.
      await this.purgePosts(tx, { communityId: comm.id }, mediaKeys);
      if (comm.avatarKey) mediaKeys.push(comm.avatarKey);
      if (comm.coverKey) mediaKeys.push(comm.coverKey);
      await tx.communityJoinRequest.deleteMany({
        where: { communityId: comm.id },
      });
      await tx.communityMember.deleteMany({ where: { communityId: comm.id } });
      await tx.community.update({
        where: { id: comm.id },
        data: { deletedAt: now, memberCount: 0, ownerId: null },
      });
    }
  }

  /**
   * Relational rows that exist only to describe this user's participation.
   *
   * Nothing here is another user's content. Conversations, ConversationParticipant
   * rows and Messages are conspicuously absent and must stay absent: those are
   * how the other participant still sees the history.
   */
  private async purgeUserRelations(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await tx.follow.deleteMany({
      where: { OR: [{ followerId: userId }, { followingId: userId }] },
    });
    await tx.postBookmark.deleteMany({ where: { userId } });
    await tx.postLike.deleteMany({ where: { userId } });
    await tx.postShare.deleteMany({ where: { userId } });
    await tx.commentLike.deleteMany({ where: { userId } });
    await tx.activityBookmark.deleteMany({ where: { userId } });
    await tx.activityInvitation.deleteMany({
      where: { OR: [{ inviterId: userId }, { inviteeId: userId }] },
    });
    await tx.crewActivityMember.deleteMany({ where: { userId } });
    await tx.matchQueueEntry.deleteMany({ where: { userId } });
    await tx.block.deleteMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    });
    await tx.mute.deleteMany({ where: { muterId: userId } });
    await tx.mention.deleteMany({ where: { userId } });
    await tx.pollVote.deleteMany({ where: { userId } });
    // Notifications this user received, and notifications *about* this user
    // that would otherwise render a tombstone actor in someone else's list.
    await tx.notification.deleteMany({ where: { recipientId: userId } });
    await tx.notification.deleteMany({ where: { actorId: userId } });
    await tx.communityMember.deleteMany({ where: { userId } });
    await tx.communityJoinRequest.deleteMany({ where: { userId } });
    await tx.conversationJoinRequest.deleteMany({ where: { userId } });
    await tx.recentSearch.deleteMany({ where: { userId } });
    await tx.deletedMessage.deleteMany({ where: { userId } });
    await tx.messageReaction.deleteMany({ where: { userId } });
    await tx.notificationPreferences.deleteMany({ where: { userId } });
    await tx.userSettings.deleteMany({ where: { userId } });
    await tx.verificationRequest.deleteMany({ where: { userId } });
    // Detach remaining media rows from the purged owner. The objects
    // themselves are queued for storage deletion post-commit; the rows are
    // kept only where something still references them.
    await tx.media.deleteMany({ where: { ownerId: userId, postId: null } });
  }

  private async invalidateCaches(userId: string): Promise<void> {
    const redis = this.redisService.getClient();
    if (!redis) return;
    try {
      await redis.del(
        `user:${userId}`,
        `profile:${userId}`,
        `user:profile:${userId}`,
        `suggestions:${userId}`,
      );
    } catch {
      /* stale cache only; Postgres is authoritative */
    }
  }

  /**
   * Removes the Supabase auth identity so the address can be reused and no
   * token can be minted for the account again.
   *
   * Fire-and-forget by design: it is the last step and a failure here must not
   * roll back a completed database purge. A leftover identity cannot sign in
   * anyway — `syncUser` refuses a DELETED row.
   */
  private deleteSupabaseIdentity(userId: string): void {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      this.logger.warn(
        `Supabase env not configured — auth identity for ${userId} not removed`,
      );
      return;
    }
    void import('@supabase/supabase-js')
      .then(({ createClient }) =>
        createClient(supabaseUrl, serviceRoleKey).auth.admin.deleteUser(userId),
      )
      .then(({ error }) => {
        if (error) {
          this.logger.warn(
            `Supabase auth deletion failed for ${userId}: ${error.message}`,
          );
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Supabase auth deletion threw for ${userId}: ${message}`,
        );
      });
  }
}
