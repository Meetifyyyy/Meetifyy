import {
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BlocksService } from '../users/blocks.service';
import { VerificationAccessService } from '../common/verification/verification-access.service';
import { MessagesService } from '../messages/messages.service';
import {
  computeCompatibility,
  relaxedThreshold,
} from './instant-match.scoring';
import {
  JoinQueueDto,
  QueueSnapshot,
  toQueueSnapshot,
  readQueueSnapshot,
} from './dto/join-queue.dto';
import {
  QUEUE_TTL_MS,
  ACCEPT_TIMER_GRACE_MS,
  getAcceptTimerSecs,
} from './instant-match.constants';

/** How long after a declined/expired match before the same pair may be
 *  re-matched. Without this, declining someone re-queues both sides and the
 *  scorer immediately hands you the same person back. */
const REMATCH_COOLDOWN_MS = 30 * 60 * 1000;

/** How long an accepted match stays on the Instant Match screen. Mirrors the
 *  24h lifetime of the conversation it opened — once the chat is gone there is
 *  nothing left to link to. */
const RECENT_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Upper bound on how many same-activity waiters one join attempt ranks.
 *  Ordered oldest-first, so the people owed a match are always considered. */
const CANDIDATE_SCAN_LIMIT = 200;

export interface MatchCandidateDto {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  course: string | null;
  branch: string | null;
  passingYear: number | null;
  interests: string[];
  bio: string | null;
}

export interface MatchFoundPayload {
  matchId: string;
  candidate: MatchCandidateDto;
  activity: string;
  area: string | null;
  timer: number;
  /** 0–100 weighted compatibility, so the card can show *why* this pairing. */
  compatibility?: number;
  /** Absolute deadline (ms epoch). The client counts down to this rather
   *  than to `timer` seconds from render, so a slow render, a backgrounded
   *  tab, or a late-arriving event cannot desync the ring from the server. */
  expiresAt: number;
}

export interface QueueStats {
  /** Everyone searching Instant Match right now, across every activity,
   *  campus and time window. This is the honest answer to "how busy is it?"
   *  — the old per-bucket figure reported 0 while a dozen people were
   *  searching one tile over. */
  count: number;
  /** Of those, how many are looking for the same activity as this viewer —
   *  the only people they can actually be paired with, since the activity is
   *  the one hard requirement. */
  sameActivity: number;
  avgWaitSecs: number;
}

/** A match both sides accepted, still inside its chat's lifetime. Surfaced so
 *  reopening Instant Match shows who you were paired with rather than a blank
 *  form, and offers a way straight back into the conversation. */
export interface RecentMatchPayload {
  matchId: string;
  candidate: MatchCandidateDto;
  activity: string;
  chatId: string | null;
  /** When the 24h chat closes (ms epoch), so the client can retire the
   *  Matched state on its own instead of pointing at a deleted chat. */
  expiresAt: number | null;
  matchedAt: number;
}

/** Everything the client needs to rebuild its UI after a reload or a socket
 *  reconnect, so a refresh mid-search does not strand the user. */
export interface MatchStateSnapshot {
  queued: {
    activity: string;
    timePreference: string;
    optionalDetail: string | null;
    area: string | null;
    joinedAt: number;
  } | null;
  pendingMatch: MatchFoundPayload | null;
  recentMatch: RecentMatchPayload | null;
  stats: QueueStats | null;
}

const USER_CARD_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatar: true,
  course: true,
  branch: true,
  passingYear: true,
  interests: true,
  bio: true,
} as const;

/** Everything the client needs to open the new chat immediately — the public
 *  id it routes on, the internal id it joins the socket room with, and the
 *  deadline the chat header counts down to. */
export interface MatchAcceptedPayload {
  matchId: string;
  chatId: string;
  internalId: string;
  expiresAt: number;
  activity: string;
  candidate: MatchCandidateDto;
}

/** The MatchSession row, once we know it carries a chat. */
export type InstantMatchSession = {
  id: string;
  userAId: string;
  userBId: string;
  activity: string;
  matchReason: string | null;
  chatStatus: 'ACTIVE' | 'ENDED_BY_USER' | 'EXPIRED';
  chatExpiresAt: Date | null;
  endedById: string | null;
  endedAt: Date | null;
  createdAt: Date;
  conversationId: string | null;
};

/** Why a chat is over, from the viewer's own point of view. */
export type InstantMatchEndReason = 'you_left' | 'they_left' | 'expired';

/**
 * One viewer's view of an Instant Match chat. This is the only shape the
 * client's state machine consumes, and it is always produced from the
 * persisted row — realtime pushes it and resync pulls it, so a missed event
 * and a reload converge on identical state.
 */
export interface InstantMatchChatState {
  matchId: string;
  otherUserId: string;
  activity: string;
  matchReason: string;
  status: 'ACTIVE' | 'ENDED_BY_USER' | 'EXPIRED';
  isActive: boolean;
  endReason: InstantMatchEndReason | null;
  endedById: string | null;
  endedAt: number | null;
  expiresAt: number | null;
  createdAt: number;
  conversationId: string | null;
  /**
   * Unread messages waiting for *this* viewer in *this* session.
   *
   * Session-scoped by construction: a session's conversation is created with
   * it and destroyed with it, so the participant row this counts is only ever
   * about the current pairing. A previous session's unread can no more leak
   * into this number than its messages can.
   */
  unreadCount: number;
}

export interface InstantMatchEmitter {
  emitMatchFound(userId: string, p: MatchFoundPayload): void;
  emitMatchAccepted(userId: string, p: MatchAcceptedPayload): void;
  emitMatchDeclined(
    userId: string,
    p: { reason: string; requeued: boolean },
  ): void;
  emitSearchResumed(userId: string): void;
  emitQueueStats(userId: string, stats: QueueStats): void;
  emitInstantMatchChatEnded(userId: string, state: InstantMatchChatState): void;
}

// Injected by RealtimeGateway.afterInit() to avoid a circular module import.
export let realtimeGatewayRef: InstantMatchEmitter | null = null;

export function setRealtimeGatewayRef(ref: InstantMatchEmitter | null) {
  realtimeGatewayRef = ref;
}

@Injectable()
export class InstantMatchService implements OnModuleInit {
  private readonly logger = new Logger(InstantMatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messagesService: MessagesService,
    private readonly blocksService: BlocksService,
    private readonly verificationAccess: VerificationAccessService,
  ) {}

  onModuleInit() {
    // Close the loop the other way: MessagesService owns the single send path
    // and needs to ask us whether an Instant Match chat still accepts writes.
    // Registered rather than injected because the module dependency already
    // runs InstantMatch -> Messages.
    this.messagesService.registerInstantMatchGuard(this);
  }

  // ─── Join queue ─────────────────────────────────────────────────────────────

  /**
   * Idempotent: re-joining with the same or updated criteria replaces the
   * existing entry rather than stacking duplicates (userId is unique).
   */
  async joinQueue(dto: JoinQueueDto): Promise<void> {
    // Through the shared policy rather than its own `verificationStatus !==
    // 'VERIFIED'` comparison: one definition of eligibility, one feature flag,
    // and the cached lookup the rest of the app already pays for.
    if (!(await this.verificationAccess.isUserEligible(dto.userId))) {
      throw new ForbiddenException(
        'Account verification is required for Instant Match',
      );
    }

    // A user holding a live match must resolve it before re-queueing,
    // otherwise accepting the old match and searching again race each other.
    const pending = await this.findPendingSessionFor(dto.userId);
    if (pending) {
      throw new BadRequestException('Respond to your current match first');
    }

    // One active Instant Match per user. Without this a user holding a live
    // 24h chat could queue again and be paired a second time, leaving two
    // conversations both claiming to be "your Instant Match" — and no way for
    // the UI, which models exactly one, to represent the second. Leaving the
    // current match is the deliberate way out, and it goes through the
    // confirmation that says so.
    const liveChat = await this.getActiveChatSession(dto.userId);
    if (liveChat) {
      throw new BadRequestException(
        'You already have an Instant Match — leave it before finding someone new',
      );
    }

    const expiresAt = new Date(Date.now() + QUEUE_TTL_MS);
    const shared = {
      campus: dto.campus,
      activity: dto.activity,
      timePreference: dto.timePreference,
      optionalDetail: dto.optionalDetail,
      area: dto.area,
      latitude: dto.gps?.latitude ?? null,
      longitude: dto.gps?.longitude ?? null,
      expiresAt,
    };

    await this.prisma.matchQueueEntry.upsert({
      where: { userId: dto.userId },
      create: { userId: dto.userId, joinedAt: new Date(), ...shared },
      update: { joinedAt: new Date(), ...shared },
    });

    this.logger.log(
      `queue:join user=${dto.userId} activity=${dto.activity} when=${dto.timePreference}`,
    );

    // Everyone waiting in this bucket now sees a different queue depth.
    await this.broadcastQueueStats();

    // The user is queued at this point, so a failure to pair them *right now*
    // must not be reported as a failed join — that would tell them the search
    // never started while the server happily kept them in the queue. The next
    // joiner's tryMatch, or the sweep, picks them up.
    try {
      await this.tryMatch(dto.userId);
    } catch (err) {
      this.logger.error(
        `Queued ${dto.userId}, but the immediate match attempt failed`,
        err,
      );
    }
  }

  async cancelQueue(userId: string): Promise<void> {
    const entry = await this.prisma.matchQueueEntry.findUnique({
      where: { userId },
    });
    if (!entry) return;

    await this.prisma.matchQueueEntry.deleteMany({ where: { userId } });
    this.logger.log(`queue:cancel user=${userId}`);
    await this.broadcastQueueStats();
  }

  // ─── Matching ───────────────────────────────────────────────────────────────

  /**
   * Attempts to pair `userId` with the best-scoring compatible candidate.
   *
   * Candidates are tried best-first: claiming a pair can lose a race against
   * a concurrent match, in which case we fall through to the next candidate
   * instead of giving up and leaving the user waiting a full sweep cycle.
   */
  async tryMatch(userId: string): Promise<void> {
    const myEntry = await this.prisma.matchQueueEntry.findUnique({
      where: { userId },
    });
    if (!myEntry) return;
    if (myEntry.expiresAt.getTime() <= Date.now()) return;

    const excludedIds = await this.getExcludedUserIds(userId);

    // The activity is the only strict requirement. Campus, time preference,
    // area and GPS used to be equality filters here, which is what made a
    // sparse queue feel broken: a perfectly good partner who picked "30min"
    // instead of "now" was not merely ranked lower, they were invisible.
    // Those signals are now weighted by the scorer and traded away in order
    // of importance as the wait grows.
    const candidates = await this.prisma.matchQueueEntry.findMany({
      where: {
        activity: myEntry.activity,
        user: { verificationStatus: 'VERIFIED' },
        userId: {
          not: userId,
          notIn: excludedIds.length ? excludedIds : undefined,
        },
        expiresAt: { gt: new Date() },
      },
      include: { user: { select: USER_CARD_SELECT } },
      // Bounded so one very popular activity cannot turn a join into an
      // unbounded scan; the oldest waiters are the ones we owe a match to.
      orderBy: { joinedAt: 'asc' },
      take: CANDIDATE_SCAN_LIMIT,
    });

    if (candidates.length === 0) return;

    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_CARD_SELECT,
    });
    if (!me) return;

    const history = await this.getPriorMatchCounts(
      userId,
      candidates.map((c) => c.userId),
    );

    const myContext = this.toScoringContext(myEntry, me);

    const now = Date.now();
    const ranked = candidates
      .map((candidate) => {
        const { score, breakdown } = computeCompatibility(
          myContext,
          this.toScoringContext(
            candidate,
            candidate.user,
            history.get(candidate.userId) ?? 0,
          ),
        );
        // Whoever has waited longer sets the bar: a five-minute waiter should
        // not be held back by a partner who joined ten seconds ago.
        const waitedMs = Math.max(
          now - myEntry.joinedAt.getTime(),
          now - candidate.joinedAt.getTime(),
        );
        return {
          candidate,
          score,
          breakdown,
          threshold: relaxedThreshold(waitedMs),
        };
      })
      .filter((r) => r.score >= r.threshold)
      // Best compatibility first; ties break toward whoever has been waiting
      // longest, so the queue stays fair instead of favouring whatever order
      // Postgres returned.
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.candidate.joinedAt.getTime() - b.candidate.joinedAt.getTime(),
      );

    if (ranked.length === 0) return;

    const timer = getAcceptTimerSecs(myEntry.activity, myEntry.timePreference);

    for (const { candidate, score, breakdown } of ranked) {
      const session = await this.claimPair(myEntry, candidate, timer);
      if (!session) continue; // lost the race for this candidate — try the next

      const area = myEntry.area ?? candidate.area ?? null;
      const expiresAtMs = session.expiresAt.getTime();

      realtimeGatewayRef?.emitMatchFound(userId, {
        matchId: session.id,
        candidate: this.toCandidateDto(candidate.user),
        activity: myEntry.activity,
        area,
        timer,
        expiresAt: expiresAtMs,
        compatibility: score,
      });
      realtimeGatewayRef?.emitMatchFound(candidate.userId, {
        matchId: session.id,
        candidate: this.toCandidateDto(me),
        activity: myEntry.activity,
        area,
        timer,
        expiresAt: expiresAtMs,
        compatibility: score,
      });

      this.logger.log(
        `match:created ${session.id} ${userId} <> ${candidate.userId} ` +
          `score=${score} ${JSON.stringify(breakdown)}`,
      );

      // Both are out of the queue now — refresh the depth for everyone left.
      await this.broadcastQueueStats();
      return;
    }
  }

  /** Shapes a queue entry plus its owner's profile into scorer input. */
  private toScoringContext(
    entry: {
      campus: string;
      activity: string;
      timePreference: string;
      optionalDetail: string | null;
      area: string | null;
      latitude: number | null;
      longitude: number | null;
      joinedAt: Date;
    },
    user: {
      interests: string[];
      course: string | null;
      branch: string | null;
      passingYear: number | null;
    },
    priorConversations: number | null = null,
  ) {
    return {
      campus: entry.campus,
      activity: entry.activity,
      timePreference: entry.timePreference,
      area: entry.area,
      optionalDetail: entry.optionalDetail,
      latitude: entry.latitude,
      longitude: entry.longitude,
      interests: user.interests ?? [],
      course: user.course,
      branch: user.branch,
      passingYear: user.passingYear,
      joinedAt: entry.joinedAt.getTime(),
      priorConversations,
    };
  }

  /**
   * How many times this user has previously matched with each candidate.
   * One batched query rather than one per candidate — the scan limit above
   * keeps the `in` list small.
   */
  private async getPriorMatchCounts(
    userId: string,
    candidateIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (candidateIds.length === 0) return counts;

    try {
      const sessions = await this.prisma.matchSession.findMany({
        where: {
          status: 'ACCEPTED',
          OR: [
            { userAId: userId, userBId: { in: candidateIds } },
            { userBId: userId, userAId: { in: candidateIds } },
          ],
        },
        select: { userAId: true, userBId: true },
      });
      for (const s of sessions) {
        const other = s.userAId === userId ? s.userBId : s.userAId;
        counts.set(other, (counts.get(other) ?? 0) + 1);
      }
    } catch (err) {
      // History is a 6-point nudge — never let it block a match.
      this.logger.warn(`Could not read match history for ${userId}`);
    }
    return counts;
  }

  /**
   * Atomically removes both queue entries and opens a match session.
   *
   * The paired `deleteMany` is the concurrency gate: a competing transaction
   * that already claimed either user leaves fewer than two rows to delete, and
   * this transaction rolls back rather than creating a second session for
   * someone who is already matched. Returns null when the claim was lost.
   */
  private async claimPair(
    myEntry: { userId: string },
    candidate: { userId: string },
    timerSecs: number,
  ): Promise<{ id: string; expiresAt: Date } | null> {
    const expiresAt = new Date(
      Date.now() + timerSecs * 1000 + ACCEPT_TIMER_GRACE_MS,
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        const a = await tx.matchQueueEntry.findUnique({
          where: { userId: myEntry.userId },
        });
        const b = await tx.matchQueueEntry.findUnique({
          where: { userId: candidate.userId },
        });
        if (!a || !b) throw new PairClaimLost();

        const removed = await tx.matchQueueEntry.deleteMany({
          where: { userId: { in: [myEntry.userId, candidate.userId] } },
        });
        if (removed.count !== 2) throw new PairClaimLost();

        return tx.matchSession.create({
          data: {
            userAId: a.userId,
            userBId: b.userId,
            activity: a.activity,
            expiresAt,
            snapshotA: this.entryToSnapshot(
              a,
            ) as unknown as Prisma.InputJsonValue,
            snapshotB: this.entryToSnapshot(
              b,
            ) as unknown as Prisma.InputJsonValue,
          },
          select: { id: true, expiresAt: true },
        });
      });
    } catch (err) {
      if (err instanceof PairClaimLost) return null;
      throw err;
    }
  }

  // ─── Responding ─────────────────────────────────────────────────────────────

  async respondToMatch(
    userId: string,
    matchId: string,
    action: 'accept' | 'decline',
  ): Promise<void> {
    const session = await this.prisma.matchSession.findUnique({
      where: { id: matchId },
    });
    if (!session) throw new NotFoundException('Match session not found');

    const isUserA = session.userAId === userId;
    const isUserB = session.userBId === userId;
    if (!isUserA && !isUserB) {
      // Authorization lives here, not in the UI: knowing a match id must not
      // let a third party accept or decline on someone else's behalf.
      throw new ForbiddenException('Not part of this match');
    }
    if (session.status !== 'PENDING') {
      throw new BadRequestException('Match is no longer active');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      // Beat the sweep to it so the user gets an honest answer immediately.
      await this.expireSession(session.id);
      throw new BadRequestException('Match is no longer active');
    }

    if (action === 'decline') {
      await this.declineSession(session, userId);
      return;
    }

    await this.acceptSession(session, isUserA);
  }

  private async declineSession(
    session: {
      id: string;
      userAId: string;
      userBId: string;
      snapshotA: unknown;
      snapshotB: unknown;
    },
    userId: string,
  ): Promise<void> {
    // Conditional update = the transition claim. Exactly one caller can move
    // a session out of PENDING, so a simultaneous decline from both sides
    // notifies each user once instead of twice.
    const claimed = await this.prisma.matchSession.updateMany({
      where: { id: session.id, status: 'PENDING' },
      data: { status: 'DECLINED' },
    });
    if (claimed.count !== 1) return;

    const otherUserId =
      session.userAId === userId ? session.userBId : session.userAId;
    const otherSnapshot = readQueueSnapshot(
      session.userAId === userId ? session.snapshotB : session.snapshotA,
    );

    const requeued = await this.requeue(otherUserId, otherSnapshot);

    realtimeGatewayRef?.emitMatchDeclined(userId, {
      reason: 'You passed on this match',
      requeued: false,
    });
    realtimeGatewayRef?.emitMatchDeclined(otherUserId, {
      reason: requeued
        ? 'The other student was unavailable — back to searching'
        : 'The other student was unavailable',
      requeued,
    });

    this.logger.log(
      `match:declined ${session.id} by=${userId} requeued=${requeued}`,
    );

    if (requeued) await this.tryMatch(otherUserId);
  }

  private async acceptSession(
    session: { id: string; userAId: string; userBId: string; activity: string },
    isUserA: boolean,
  ): Promise<void> {
    // Record this side's acceptance without clobbering the other side's flag.
    await this.prisma.matchSession.updateMany({
      where: { id: session.id, status: 'PENDING' },
      data: isUserA ? { aAccepted: true } : { bAccepted: true },
    });

    const fresh = await this.prisma.matchSession.findUnique({
      where: { id: session.id },
      select: {
        aAccepted: true,
        bAccepted: true,
        status: true,
        conversationId: true,
      },
    });
    if (!fresh || fresh.status !== 'PENDING') return;
    if (!fresh.aAccepted || !fresh.bAccepted) {
      this.logger.log(`match:half-accepted ${session.id}`);
      return;
    }

    // Re-check eligibility for BOTH people before the chat exists.
    //
    // The `@VerifiedOnly()` guard on `match:respond` only vouches for whoever
    // is calling right now; it says nothing about the other side, whose
    // verification may have been revoked at any point while this match sat
    // PENDING. Without this, a pair matched minutes ago could still be handed
    // a 24h conversation with someone who is no longer allowed to message —
    // and the messaging layer would then refuse every send inside a chat the
    // product had just promised them.
    const eligibility = await this.verificationAccess.getEligibilityMap([
      session.userAId,
      session.userBId,
    ]);
    if (
      eligibility.get(session.userAId) === false ||
      eligibility.get(session.userBId) === false
    ) {
      this.logger.warn(
        `match:refused-ineligible ${session.id} — a participant is no longer eligible`,
      );
      await this.prisma.matchSession.updateMany({
        where: { id: session.id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      return;
    }

    // Neither person may hold two live chats at once.
    //
    // The queue guards the entry to matching, but nothing guarded the exit
    // until here: a stale PENDING session accepted late — a second tab, a
    // reconnect replaying an accept — could open a second conversation for
    // someone who is already mid-chat, and from then on "the active session"
    // was whichever row a given query happened to order first. One live
    // session per user is what makes `getActiveChatSession` a well-defined
    // question, so it is enforced at the one transition that creates them.
    const liveElsewhere = await this.prisma.matchSession.findFirst({
      where: {
        id: { not: session.id },
        status: 'ACCEPTED',
        chatStatus: 'ACTIVE',
        conversationId: { not: null },
        chatExpiresAt: { gt: new Date() },
        OR: [
          { userAId: session.userAId },
          { userBId: session.userAId },
          { userAId: session.userBId },
          { userBId: session.userBId },
        ],
      },
      select: { id: true },
    });
    if (liveElsewhere) {
      this.logger.warn(
        `match:refused-already-matched ${session.id} — a participant already ` +
          `has live session ${liveElsewhere.id}`,
      );
      await this.prisma.matchSession.updateMany({
        where: { id: session.id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      return;
    }

    // Both sides are in. Claim the finalize transition so that two
    // simultaneous accepts create exactly one conversation.
    const claimed = await this.prisma.matchSession.updateMany({
      where: { id: session.id, status: 'PENDING' },
      data: { status: 'ACCEPTED' },
    });
    if (claimed.count !== 1) return;

    let conv: { id: string; internalId: string; expiresAt: number };
    try {
      conv = await this.messagesService.createInstantMatchConversation(
        session.userAId,
        session.userBId,
        session.activity,
      );
    } catch (err) {
      // Roll the transition back so the pair is not stranded in ACCEPTED with
      // no conversation to open. The sweep will expire it and re-queue both.
      await this.prisma.matchSession.updateMany({
        where: { id: session.id, status: 'ACCEPTED' },
        data: { status: 'PENDING' },
      });
      this.logger.error(
        `match:accept failed to open conversation ${session.id}`,
        err,
      );
      throw new BadRequestException('Could not open your chat — try again');
    }

    await this.prisma.matchSession.update({
      where: { id: session.id },
      data: {
        // Store the internal id: it is the stable foreign key, while the
        // public id is what the client routes on.
        conversationId: conv.internalId,
        // The chat's own lifecycle starts here, and the deadline is recorded
        // on the session rather than inferred from the conversation — this is
        // the row every send is authorized against.
        chatStatus: 'ACTIVE',
        chatExpiresAt: new Date(conv.expiresAt),
        matchReason: session.activity,
      },
    });

    // Both users' cards are looked up so each side's `match:accepted` carries
    // the person they matched with. The client renders the Matched state and
    // the chat header from this alone, which is what lets "Open chat" work
    // on a fresh device that has never seen the match:found event.
    const [userA, userB] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: session.userAId },
        select: USER_CARD_SELECT,
      }),
      this.prisma.user.findUnique({
        where: { id: session.userBId },
        select: USER_CARD_SELECT,
      }),
    ]);

    const base = {
      matchId: session.id,
      chatId: conv.id,
      internalId: conv.internalId,
      expiresAt: conv.expiresAt,
      activity: session.activity,
    };

    if (userB) {
      realtimeGatewayRef?.emitMatchAccepted(session.userAId, {
        ...base,
        candidate: this.toCandidateDto(userB),
      });
    }
    if (userA) {
      realtimeGatewayRef?.emitMatchAccepted(session.userBId, {
        ...base,
        candidate: this.toCandidateDto(userA),
      });
    }

    this.logger.log(`match:accepted ${session.id} conversation=${conv.id}`);
  }

  // ─── Expiry ─────────────────────────────────────────────────────────────────

  async expireStale(): Promise<void> {
    const now = new Date();

    // The count is global now, so one broadcast covers every waiter — no
    // need to enumerate which buckets the sweep happened to touch.
    const removed = await this.prisma.matchQueueEntry.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    if (removed.count > 0) await this.broadcastQueueStats();

    const expired = await this.prisma.matchSession.findMany({
      where: { status: 'PENDING', expiresAt: { lt: now } },
      select: { id: true },
    });

    let handled = 0;
    for (const { id } of expired) {
      if (await this.expireSession(id)) handled += 1;
    }

    if (handled > 0) this.logger.log(`match:expired ${handled} session(s)`);

    // The 24h chat windows are swept on the same cadence, so an online user
    // watching an open chat is told the moment it closes rather than
    // discovering it on their next send. Users who are offline are reconciled
    // lazily when they next read their state — correctness does not depend on
    // this having run.
    const chatsEnded = await this.expireStaleChats();
    if (chatsEnded > 0)
      this.logger.log(`instant-match:chats-expired ${chatsEnded}`);
  }

  /**
   * Moves one PENDING session to EXPIRED and puts both users back in the
   * queue. Returns false when another worker claimed it first, which keeps
   * the notifications single-delivery across multiple backend instances.
   */
  private async expireSession(sessionId: string): Promise<boolean> {
    const claimed = await this.prisma.matchSession.updateMany({
      where: { id: sessionId, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
    if (claimed.count !== 1) return false;

    const session = await this.prisma.matchSession.findUnique({
      where: { id: sessionId },
      select: {
        userAId: true,
        userBId: true,
        snapshotA: true,
        snapshotB: true,
      },
    });
    if (!session) return false;

    const sides: Array<[string, unknown]> = [
      [session.userAId, session.snapshotA],
      [session.userBId, session.snapshotB],
    ];

    for (const [uid, snap] of sides) {
      const requeued = await this.requeue(uid, readQueueSnapshot(snap));
      realtimeGatewayRef?.emitMatchDeclined(uid, {
        reason: requeued
          ? 'Match timed out — back to searching'
          : 'Match timed out',
        requeued,
      });
      if (requeued) await this.tryMatch(uid);
    }

    return true;
  }

  // ─── Re-queue ───────────────────────────────────────────────────────────────

  /**
   * Puts a user back into the queue from their stored request. Server-driven
   * so a user whose sheet is minimised — or whose socket dropped — is not
   * silently removed from matching when the other side declines.
   */
  private async requeue(
    userId: string,
    snapshot: QueueSnapshot | null,
  ): Promise<boolean> {
    if (!snapshot) return false;

    try {
      const expiresAt = new Date(Date.now() + QUEUE_TTL_MS);
      const shared = {
        campus: snapshot.campus,
        activity: snapshot.activity,
        timePreference: snapshot.timePreference,
        optionalDetail: snapshot.optionalDetail,
        area: snapshot.area,
        latitude: snapshot.gps?.latitude ?? null,
        longitude: snapshot.gps?.longitude ?? null,
        expiresAt,
      };
      await this.prisma.matchQueueEntry.upsert({
        where: { userId },
        create: { userId, joinedAt: new Date(), ...shared },
        update: { joinedAt: new Date(), ...shared },
      });
      realtimeGatewayRef?.emitSearchResumed(userId);
      await this.broadcastQueueStats();
      return true;
    } catch (err) {
      this.logger.error(`Failed to re-queue ${userId}`, err);
      return false;
    }
  }

  // ─── Stats ──────────────────────────────────────────────────────────────────

  /**
   * A live snapshot of the whole Instant Match queue.
   *
   * Deliberately global rather than scoped to the viewer's bucket. Matching
   * itself is no longer bucketed — campus, time and location are weighted
   * preferences now — so a count filtered by all three described a queue that
   * no longer exists, and read as "nobody is here" on a busy evening.
   */
  async getQueueStats(activity?: string | null): Promise<QueueStats> {
    const entries = await this.prisma.matchQueueEntry.findMany({
      where: { expiresAt: { gt: new Date() } },
      select: { joinedAt: true, activity: true },
    });

    return this.summarise(entries, activity);
  }

  /** Shared by the single-reader and the broadcast path so both can never
   *  disagree about what the same queue contains. */
  private summarise(
    entries: Array<{ joinedAt: Date; activity: string }>,
    activity?: string | null,
  ): QueueStats {
    const sameActivity = activity
      ? entries.filter((e) => e.activity === activity).length
      : 0;

    if (entries.length === 0)
      return { count: 0, sameActivity: 0, avgWaitSecs: 60 };

    const now = Date.now();
    const totalWait = entries.reduce(
      (sum, e) => sum + (now - e.joinedAt.getTime()),
      0,
    );
    const avgWaitSecs = Math.max(
      30,
      Math.round(totalWait / entries.length / 1000),
    );

    return { count: entries.length, sameActivity, avgWaitSecs };
  }

  /**
   * Pushes fresh stats to everyone currently waiting, so a join, cancel,
   * match or expiry updates every searching screen at once.
   *
   * The headline count is global, so any change moves the number for every
   * waiter — not just for the bucket that changed. One read serves the whole
   * broadcast; each user's `sameActivity` is computed from it in memory.
   */
  private async broadcastQueueStats(): Promise<void> {
    if (!realtimeGatewayRef) return;
    try {
      const waiting = await this.prisma.matchQueueEntry.findMany({
        where: { expiresAt: { gt: new Date() } },
        select: { userId: true, joinedAt: true, activity: true },
      });

      // Per-activity totals once, rather than per recipient.
      const byActivity = new Map<string, number>();
      for (const e of waiting) {
        byActivity.set(e.activity, (byActivity.get(e.activity) ?? 0) + 1);
      }

      const base = this.summarise(waiting);
      for (const { userId, activity } of waiting) {
        realtimeGatewayRef.emitQueueStats(userId, {
          ...base,
          sameActivity: byActivity.get(activity) ?? 0,
        });
      }
    } catch (err) {
      // Stats are cosmetic — never let them break a join or a match.
      this.logger.warn(
        `Failed to broadcast queue stats: ${(err as Error)?.message}`,
      );
    }
  }

  // ─── Resync ─────────────────────────────────────────────────────────────────

  /**
   * Rebuilds the client's view after a reload or reconnect. Without this a
   * refresh mid-search leaves the user queued on the server but idle in the
   * UI, and a pending match would be invisible until it timed out.
   */
  async getStateFor(userId: string): Promise<MatchStateSnapshot> {
    const [entry, session, recentMatch] = await Promise.all([
      this.prisma.matchQueueEntry.findUnique({ where: { userId } }),
      this.findPendingSessionFor(userId),
      this.getRecentMatchFor(userId),
    ]);

    const live = entry && entry.expiresAt.getTime() > Date.now() ? entry : null;

    let pendingMatch: MatchFoundPayload | null = null;
    if (session) {
      const otherId =
        session.userAId === userId ? session.userBId : session.userAId;
      const other = await this.prisma.user.findUnique({
        where: { id: otherId },
        select: USER_CARD_SELECT,
      });
      if (other) {
        const snapshot = readQueueSnapshot(
          session.userAId === userId ? session.snapshotA : session.snapshotB,
        );
        pendingMatch = {
          matchId: session.id,
          candidate: this.toCandidateDto(other),
          activity: session.activity,
          area: snapshot?.area ?? null,
          timer: getAcceptTimerSecs(
            session.activity,
            snapshot?.timePreference ?? 'now',
          ),
          expiresAt: session.expiresAt.getTime(),
        };
      }
    }

    const stats = live ? await this.getQueueStats(live.activity) : null;

    return {
      queued: live
        ? {
            activity: live.activity,
            timePreference: live.timePreference,
            optionalDetail: live.optionalDetail,
            area: live.area,
            joinedAt: live.joinedAt.getTime(),
          }
        : null,
      pendingMatch,
      recentMatch,
      stats,
    };
  }

  /**
   * The most recent mutually-accepted match still inside its chat's lifetime.
   *
   * Read from the database rather than remembered on the client, so it
   * survives a reload and shows up on every device the user is signed in on.
   */
  async getRecentMatchFor(userId: string): Promise<RecentMatchPayload | null> {
    const since = new Date(Date.now() - RECENT_MATCH_WINDOW_MS);

    const session = await this.prisma.matchSession.findFirst({
      where: {
        status: 'ACCEPTED',
        createdAt: { gte: since },
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!session) return null;

    const otherId =
      session.userAId === userId ? session.userBId : session.userAId;
    const other = await this.prisma.user.findUnique({
      where: { id: otherId },
      select: USER_CARD_SELECT,
    });
    if (!other) return null;

    // conversationId holds the internal id; the client routes on the public
    // one. A missing or already-expired conversation yields a null chatId so
    // the UI can show the pairing without offering a dead link.
    let chatId: string | null = null;
    let chatExpiresAt: number | null = null;
    // A session whose chat is over never offers a link into it, whatever the
    // conversation row still says. The teardown pulls `expiresAt` back to now
    // as well, so the query below would already decline — but relying on that
    // would make "is this chat reachable?" a fact about a timestamp instead of
    // a fact about the session, and the session is the boundary.
    if (session.conversationId && session.chatStatus === 'ACTIVE') {
      const conv = await this.prisma.conversation.findFirst({
        where: {
          id: session.conversationId,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { id: true, publicId: true, expiresAt: true },
      });
      if (conv) {
        chatId = conv.publicId || conv.id;
        chatExpiresAt = conv.expiresAt?.getTime() ?? null;
      }
    }

    return {
      matchId: session.id,
      candidate: this.toCandidateDto(other),
      activity: session.activity,
      chatId,
      expiresAt: chatExpiresAt,
      matchedAt: session.createdAt.getTime(),
    };
  }

  // ─── Instant Match chat session ─────────────────────────────────────────────
  //
  // Everything below is the authority for the dedicated 24h conversation:
  // whether it exists, whether it is still live, and whether either user may
  // still write to it. No client timer participates in any of these answers —
  // a client's countdown is presentation only, and every write re-checks the
  // row. That is what makes a stale tab, a suspended phone, or a hand-crafted
  // socket frame unable to post into a chat that has ended.

  /**
   * The user's one live Instant Match chat, or null.
   *
   * Lazily reconciles expiry on read: a session whose window has passed is
   * flipped to EXPIRED here rather than being reported as active until the
   * sweep next runs. The sweep still exists — it is what notifies users who
   * are online but not looking — but correctness never depends on it having
   * run, which is what keeps an offline user from returning to a chat the
   * clock says is dead and the database says is alive.
   */
  async getActiveChatSession(
    userId: string,
  ): Promise<InstantMatchSession | null> {
    const session = await this.prisma.matchSession.findFirst({
      where: {
        status: 'ACCEPTED',
        chatStatus: 'ACTIVE',
        conversationId: { not: null },
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!session) return null;

    if (this.isPastWindow(session)) {
      await this.expireChatSession(session.id);
      return null;
    }
    return session;
  }

  /**
   * The state the Instant Match screen renders, whatever that state is.
   *
   * Returns the *most recent* session rather than only a live one, so a user
   * coming back to a chat the other person left sees "they left" instead of a
   * blank matching form — the difference between an explained ending and an
   * apparent bug. Reconciles expiry the same way as above.
   */
  async getChatStateFor(userId: string): Promise<InstantMatchChatState | null> {
    const session = await this.prisma.matchSession.findFirst({
      where: {
        status: 'ACCEPTED',
        conversationId: { not: null },
        // Anything older than the window is history, not state worth showing.
        createdAt: { gte: new Date(Date.now() - RECENT_MATCH_WINDOW_MS) },
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!session) return null;

    let current = session;
    if (current.chatStatus === 'ACTIVE' && this.isPastWindow(current)) {
      await this.expireChatSession(current.id);
      current = { ...current, chatStatus: 'EXPIRED' };
    }

    return this.withUnread(this.toChatState(current, userId), userId);
  }

  /** True once the 24h window has closed. A session with no recorded window
   *  (impossible for rows written after the migration) is treated as open,
   *  so a data gap can never silently lock a live chat. */
  private isPastWindow(session: { chatExpiresAt: Date | null }): boolean {
    return Boolean(
      session.chatExpiresAt && session.chatExpiresAt.getTime() <= Date.now(),
    );
  }

  /**
   * Ends a chat because one participant walked away.
   *
   * The conditional update is the whole concurrency story: `chatStatus:
   * ACTIVE` in the WHERE means exactly one caller can perform the transition.
   * Two users tapping "Find someone new" at the same instant therefore
   * produce one ENDED_BY_USER row and one no-op, rather than two writes
   * racing to record different leavers — and the loser is told the truth
   * (already ended) instead of an error.
   */
  async leaveChatSession(
    userId: string,
    matchId?: string,
  ): Promise<{ ended: boolean; session: InstantMatchChatState | null }> {
    const session = matchId
      ? await this.prisma.matchSession.findUnique({ where: { id: matchId } })
      : await this.getActiveChatSession(userId);

    if (!session) {
      // Nothing live to leave. That is the ordinary outcome of a double tap,
      // a second tab, or the other person having just left — so answer with
      // whatever the state actually is rather than an empty result the caller
      // cannot render. Without this the second tap of a double tap returned
      // null and the UI had nothing to transition to.
      return { ended: false, session: await this.getChatStateFor(userId) };
    }

    const isParticipant =
      session.userAId === userId || session.userBId === userId;
    if (!isParticipant) {
      // Knowing a match id must not let a third party end someone's chat.
      throw new ForbiddenException('Not part of this match');
    }

    const claimed = await this.prisma.matchSession.updateMany({
      where: { id: session.id, chatStatus: 'ACTIVE' },
      data: {
        chatStatus: 'ENDED_BY_USER',
        endedById: userId,
        endedAt: new Date(),
      },
    });

    const fresh = await this.prisma.matchSession.findUnique({
      where: { id: session.id },
    });
    if (!fresh) return { ended: false, session: null };

    if (claimed.count === 1) {
      this.logger.log(`instant-match:chat-ended ${session.id} by=${userId}`);
      // Close the conversation itself too, so any path that reads the
      // conversation rather than the session also sees a dead chat.
      await this.closeConversation(fresh.conversationId);
      this.notifyChatEnded(fresh);
    }

    return {
      ended: claimed.count === 1,
      session: this.toChatState(fresh, userId),
    };
  }

  /** Ends a chat because its 24h window closed. Same claim-once discipline as
   *  leaving, so the sweep and a concurrent read cannot both notify. */
  private async expireChatSession(sessionId: string): Promise<boolean> {
    const claimed = await this.prisma.matchSession.updateMany({
      where: { id: sessionId, chatStatus: 'ACTIVE' },
      data: { chatStatus: 'EXPIRED', endedAt: new Date() },
    });
    if (claimed.count !== 1) return false;

    const fresh = await this.prisma.matchSession.findUnique({
      where: { id: sessionId },
    });
    if (!fresh) return false;

    this.logger.log(`instant-match:chat-expired ${sessionId}`);
    await this.closeConversation(fresh.conversationId);
    this.notifyChatEnded(fresh);
    return true;
  }

  /**
   * Tears a session's conversation down for good.
   *
   * Marking the row ENDED is not enough on its own. The messages stay
   * queryable by anything that reads the conversation directly — a stale tab
   * replaying its history request, an IndexedDB rehydrate, a future session
   * that somehow lands on the same id — and "the chat is over" has to mean
   * the transcript is gone, not merely hidden. So the messages are deleted
   * and the conversation is stamped closed in one transaction: either the
   * session's chat is fully torn down or nothing changed and the sweep will
   * retry.
   *
   * `expiresAt` is pulled back to now as well, so every window-based query in
   * the codebase agrees with `status` about this conversation being dead.
   */
  private async closeConversation(
    conversationId: string | null,
  ): Promise<void> {
    if (!conversationId) return;
    try {
      await this.prisma.$transaction(async (tx) => {
        // The denormalised preview is cleared before the messages it points
        // at, so no ordering inside the transaction leaves a dangling
        // `lastMessageId`.
        await tx.conversation.updateMany({
          where: { id: conversationId },
          data: {
            status: 'ENDED',
            expiresAt: new Date(),
            lastMessageId: null,
            lastMessageText: null,
            lastMessageType: null,
            lastMessageAt: null,
            lastMessageSenderId: null,
          },
        });
        await tx.conversationParticipant.updateMany({
          where: { conversationId },
          data: { unreadCount: 0, lastReadAt: new Date() },
        });
        // Reactions, receipts and deleted-message rows cascade from Message;
        // anything that does not is scoped to a message id that no longer
        // exists.
        await tx.message.deleteMany({ where: { conversationId } });
      });
    } catch (err) {
      this.logger.warn(
        `Could not close instant-match conversation ${conversationId}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  /** Tells both sides, each from their own point of view. Fire-and-forget:
   *  the persisted row is the truth, and every screen reconciles against it,
   *  so a dropped event costs a moment's staleness and nothing more. */
  private notifyChatEnded(session: InstantMatchSession): void {
    for (const uid of [session.userAId, session.userBId]) {
      realtimeGatewayRef?.emitInstantMatchChatEnded(
        uid,
        this.toChatState(session, uid),
      );
    }
  }

  /**
   * Projects a session into the shape a given viewer's UI needs.
   *
   * Per-viewer rather than a shared payload because "you left" and "they
   * left" are different screens, and the difference must not be computed on
   * the client from an id comparison it might get wrong.
   */
  private toChatState(
    session: InstantMatchSession,
    viewerId: string,
  ): InstantMatchChatState {
    const otherUserId =
      session.userAId === viewerId ? session.userBId : session.userAId;
    const endedByMe = Boolean(
      session.endedById && session.endedById === viewerId,
    );

    let reason: InstantMatchEndReason | null = null;
    if (session.chatStatus === 'ENDED_BY_USER')
      reason = endedByMe ? 'you_left' : 'they_left';
    else if (session.chatStatus === 'EXPIRED') reason = 'expired';

    return {
      matchId: session.id,
      otherUserId,
      activity: session.activity,
      matchReason: session.matchReason ?? session.activity,
      status: session.chatStatus,
      isActive: session.chatStatus === 'ACTIVE' && !this.isPastWindow(session),
      endReason: reason,
      endedById: session.endedById ?? null,
      endedAt: session.endedAt?.getTime() ?? null,
      expiresAt: session.chatExpiresAt?.getTime() ?? null,
      createdAt: session.createdAt.getTime(),
      conversationId: session.conversationId,
      // Overlaid by `withUnread` where a count is meaningful. An ended
      // session has none by definition — closing it zeroes both participants'
      // counters — so the badge cannot survive its session.
      unreadCount: 0,
    };
  }

  /**
   * The same projection, with the viewer's unread count filled in.
   *
   * Read from the conversation participant row rather than kept on the
   * session, so it is the *same* number the rest of messaging maintains:
   * incremented by the one send path, cleared by the one mark-seen path. A
   * second counter here would be a second source of truth to disagree with.
   */
  private async withUnread(
    state: InstantMatchChatState,
    viewerId: string,
  ): Promise<InstantMatchChatState> {
    if (!state.isActive || !state.conversationId) return state;
    try {
      const participant =
        await this.prisma.conversationParticipant.findUnique({
          where: {
            userId_conversationId: {
              userId: viewerId,
              conversationId: state.conversationId,
            },
          },
          select: { unreadCount: true },
        });
      return { ...state, unreadCount: participant?.unreadCount ?? 0 };
    } catch {
      // A badge is not worth failing a state read over.
      return state;
    }
  }

  /**
   * Authorization for a single write into an Instant Match conversation.
   *
   * Called by MessagesService on the one send path every client shares, so
   * there is no route — socket or HTTP, first tab or fifth — that reaches a
   * message insert without passing through here.
   */
  async assertCanSendInChat(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    const session = await this.prisma.matchSession.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
    });

    // A conversation typed INSTANT_MATCH with no session behind it is
    // corrupt state; refusing the write is the safe reading.
    if (!session)
      throw new ForbiddenException('This Instant Match chat has ended');

    if (session.userAId !== userId && session.userBId !== userId) {
      throw new ForbiddenException('Not part of this match');
    }

    if (session.chatStatus === 'ENDED_BY_USER') {
      throw new ForbiddenException(
        session.endedById === userId
          ? 'You left this match'
          : 'The other student left this match',
      );
    }
    if (session.chatStatus === 'EXPIRED') {
      throw new ForbiddenException('This Instant Match has expired');
    }

    // The deadline is re-read from the row on every send, so a message that
    // arrives one millisecond late is refused even if the sweep has not run
    // and the sender's countdown still showed time on the clock.
    if (this.isPastWindow(session)) {
      await this.expireChatSession(session.id);
      throw new ForbiddenException('This Instant Match has expired');
    }
  }

  /**
   * Read authorization for an Instant Match conversation.
   *
   * The mirror of `assertCanSendInChat`, minus the reasons: callers only need
   * a yes or no, because "the chat ended" is rendered from the session state
   * they already hold rather than from a history error. Answers no for a
   * conversation with no session behind it, a caller who is not one of the
   * two participants, an ended session, and a window that has closed —
   * reconciling that last case rather than trusting the sweep to have run.
   */
  async canReadChat(userId: string, conversationId: string): Promise<boolean> {
    const session = await this.prisma.matchSession.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
    });
    if (!session) return false;
    if (session.userAId !== userId && session.userBId !== userId) return false;
    if (session.chatStatus !== 'ACTIVE') return false;
    if (this.isPastWindow(session)) {
      await this.expireChatSession(session.id);
      return false;
    }
    return true;
  }

  /** Expires every chat whose window has closed. Driven by the same sweep as
   *  the accept-timer expiry, so online users are told promptly; offline ones
   *  are reconciled by the lazy check on their next read. */
  async expireStaleChats(): Promise<number> {
    const due = await this.prisma.matchSession.findMany({
      where: { chatStatus: 'ACTIVE', chatExpiresAt: { lte: new Date() } },
      select: { id: true },
      take: 200,
    });

    let handled = 0;
    for (const { id } of due) {
      if (await this.expireChatSession(id)) handled += 1;
    }
    return handled;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private findPendingSessionFor(userId: string) {
    return this.prisma.matchSession.findFirst({
      where: {
        status: 'PENDING',
        expiresAt: { gt: new Date() },
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Users this person must not be paired with: anyone blocked in either
   * direction, plus anyone they very recently declined or timed out with.
   */
  private async getExcludedUserIds(userId: string): Promise<string[]> {
    const since = new Date(Date.now() - REMATCH_COOLDOWN_MS);

    const [blocked, recent] = await Promise.all([
      // Blocks come from the shared BlocksService, not a local Block query, so
      // there is exactly one place that decides who is blocked from whom (and
      // this path gets its cache rather than a fresh query per match attempt).
      this.blocksService.getExcludedUserIds(userId),
      this.prisma.matchSession.findMany({
        where: {
          status: { in: ['DECLINED', 'EXPIRED'] },
          createdAt: { gte: since },
          OR: [{ userAId: userId }, { userBId: userId }],
        },
        select: { userAId: true, userBId: true },
      }),
    ]);

    const excluded = new Set<string>(blocked);
    for (const s of recent) {
      excluded.add(s.userAId === userId ? s.userBId : s.userAId);
    }
    excluded.delete(userId);
    return [...excluded];
  }

  private toCandidateDto(u: {
    id: string;
    username: string;
    displayName: string;
    avatar: string | null;
    course: string | null;
    branch: string | null;
    passingYear: number | null;
    interests: string[];
    bio: string | null;
  }): MatchCandidateDto {
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatar: u.avatar,
      course: u.course,
      branch: u.branch,
      passingYear: u.passingYear,
      interests: u.interests ?? [],
      bio: u.bio,
    };
  }

  private entryToSnapshot(entry: {
    campus: string;
    activity: string;
    timePreference: string;
    optionalDetail: string | null;
    area: string | null;
    latitude: number | null;
    longitude: number | null;
  }): QueueSnapshot {
    return toQueueSnapshot({
      userId: '',
      campus: entry.campus,
      activity: entry.activity,
      timePreference: entry.timePreference,
      optionalDetail: entry.optionalDetail,
      area: entry.area,
      gps:
        entry.latitude != null && entry.longitude != null
          ? { latitude: entry.latitude, longitude: entry.longitude }
          : null,
    });
  }
}

/** Internal signal used to roll back a pair claim that lost its race. */
class PairClaimLost extends Error {}
