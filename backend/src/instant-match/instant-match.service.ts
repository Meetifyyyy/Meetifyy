import {
  Injectable,
  Optional,
  Logger,
  OnModuleInit,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { detach } from '../common/utils/detach.util';
import { RedisService } from '../redis/redis.service';
import { BlocksService } from '../users/blocks.service';
import { VerificationAccessService } from '../common/verification/verification-access.service';
import { MessagesService } from '../messages/messages.service';
import { PresenceService } from '../presence/presence.service';
import {
  ACTIVE_AFFILIATION_SELECT,
  activeAffiliationCollegeId,
} from '../common/campus/campus-access.service';
import { MediaCleanupService } from '../uploads/media-cleanup.service';
import { MatchScore, explainPair, scoreMutual } from './matching/engine';
import { proposalFeatures } from './matching/features';
import { orderCandidates } from './matching/selection';
import { ROSTER, rosterVisibility } from './matching/roster';
import {
  PairFeedback,
  PairSocial,
  SideContext,
  isHardSkippedEitherWay,
} from './matching/signals';
import {
  CANDIDATE_SCAN_LIMIT,
  FEEDBACK,
  THRESHOLD,
} from './matching/matching.config';
import {
  JoinQueueDto,
  QueueSnapshot,
  toQueueSnapshot,
  readQueueSnapshot,
} from './dto/join-queue.dto';
import {
  QUEUE_TTL_MS,
  EXPIRY_SWEEP_MS,
  ACCEPT_TIMER_GRACE_MS,
  REQUEST_WINDOW_SECS,
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

/** Pending sessions expired per sweep tick (every 10 s); a backlog after an
 *  outage is worked off over a few ticks rather than in one pass. */
const EXPIRE_BATCH = 100;

/** The sweep re-tries matching for people waiting at least this long… */
const REMATCH_AFTER_MS = 30_000;
/** …the longest-waiting this many per tick (every 10 s)… */
const REMATCH_BATCH = 20;
/** …read from at most this many of the oldest live entries (one query). */
const REMATCH_SCAN = 200;
/** A waiter whose bar has stopped falling is re-tried only this often. */
const REMATCH_SETTLED_EVERY_MS = 2 * 60_000;

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

/**
 * The card shown BEFORE both people accept: everything on the profile card,
 * but not the internal user id (owner decision D1). The id arrives with
 * `match:accepted`, once there is a chat to open; the app only reads it after
 * that point.
 */
export type MatchCandidateCard = Omit<MatchCandidateDto, 'id'>;

export interface MatchFoundPayload {
  matchId: string;
  candidate: MatchCandidateCard;
  activity: string;
  area: string | null;
  timer: number;
  /** 0–100 weighted compatibility, so the card can show *why* this pairing. */
  compatibility?: number;
  /** Absolute deadline (ms epoch). The client counts down to this rather
   *  than to `timer` seconds from render, so a slow render, a backgrounded
   *  tab, or a late-arriving event cannot desync the ring from the server. */
  expiresAt: number;
  /** This user has already said yes, so the card shows the wait for the
   *  other side instead of asking again: they sent the request, or (after a
   *  reload) they accepted a match the other side has not answered yet. */
  awaitingOther?: boolean;
  /** This user sent the direct request now waiting on the other side. The
   *  app labels the wait (and offers to withdraw it) by this, not by
   *  `awaitingOther`, which also covers an accepted match. */
  requestSent?: boolean;
  /** The other side has already accepted; the card says so (IM-26, owner
   *  decision 2026-11-14). */
  partnerAccepted?: boolean;
  /** The other person asked for this pairing directly, from the roster. */
  requested?: boolean;
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
/** One candidate as `explainRankingFor` reports it. */
export interface RankedCandidateExplanation {
  userId: string;
  username: string;
  score: number;
  /** True when the pass history has this pairing on hold. */
  skipped: boolean;
  feedback: PairFeedback | null;
  detail: MatchScore;
  /** The one-line human form of `detail`. */
  explanation: string;
  joinedAt: number;
}

/** Why the ranker would choose what it chooses, for one searcher. */
export interface RankingExplanation {
  queued: boolean;
  /** Every candidate considered, best score first, skipped ones included. */
  candidates: RankedCandidateExplanation[];
  /** The order they would actually be tried in, deterministically. */
  order: Array<{ userId: string; score: number; threshold: number }>;
}

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

/**
 * One person currently waiting in the Instant Match queue, as the browse list
 * shows them.
 *
 * Every field is a column of that person's own `MatchQueueEntry` — the same
 * row matching itself reads — so the list can never describe someone
 * differently from the way they will be matched. Nothing is derived, guessed
 * or padded: `area` and `optionalDetail` stay null when they were not given,
 * and the client simply omits the line.
 */
export interface SearchingNowEntry {
  user: MatchCandidateDto;
  activity: string;
  timePreference: string;
  optionalDetail: string | null;
  area: string | null;
  joinedAt: number;
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
  /** This user's acceptance is recorded and the other side has not answered:
   *  every screen they have open moves to the wait (IM-19). */
  emitMatchWaiting(userId: string, p: { matchId: string }): void;
  /** The other side of this match has accepted (IM-26). */
  emitMatchPartnerAccepted(userId: string, p: { matchId: string }): void;
  emitMatchDeclined(
    userId: string,
    p: { reason: string; requeued: boolean },
  ): void;
  emitSearchResumed(userId: string): void;
  emitQueueStats(userId: string, stats: QueueStats): void;
  /** The same stats to many people at once: one group per activity, all in
   *  one relay publish (IM-17). */
  emitQueueStatsMany(
    groups: Array<{ userIds: string[]; stats: QueueStats }>,
  ): void;
  /** The set of people waiting has changed. Carries nothing: it is a
   *  "re-read the roster" ping, and the read it triggers is per-viewer. */
  emitQueueChanged(): void;
  emitInstantMatchChatEnded(userId: string, state: InstantMatchChatState): void;
}

// Injected by RealtimeGateway.afterInit() to avoid a circular module import.
export let realtimeGatewayRef: InstantMatchEmitter | null = null;

export function setRealtimeGatewayRef(ref: InstantMatchEmitter | null) {
  realtimeGatewayRef = ref;
}

/**
 * Asks the shared job queue to run `expireRequest` for one session after a
 * delay. Set by InstantMatchModule once the queue exists. Left unset (tests, a
 * queue that failed to start) the periodic sweep still withdraws the request,
 * only up to one sweep later than the deadline.
 */
export let requestExpiryScheduler:
  ((sessionId: string, delayMs: number) => void) | null = null;

export function setRequestExpiryScheduler(
  fn: ((sessionId: string, delayMs: number) => void) | null,
) {
  requestExpiryScheduler = fn;
}

@Injectable()
export class InstantMatchService implements OnModuleInit {
  private readonly logger = new Logger(InstantMatchService.name);

  /**
   * The one non-deterministic step in ranking, in one replaceable place.
   *
   * Every score is a pure function of its inputs; the only draw in the
   * pipeline is the one that breaks ties and occasionally explores. Holding
   * its options here lets a test — or a debugging session — pin the ordering
   * instead of every assertion about *which* candidate was chosen becoming a
   * coin flip that passes locally and fails in CI.
   *
   * `deterministic` is the switch to reach for, not a fixed `rng`. A constant
   * rng is not a neutral one: `() => 0` satisfies `rng() < exploreRate` on
   * every call, so it explores *always* rather than never. That mistake cost
   * a red CI run.
   *
   * The default is `Math.random`, which is right here: this is ranking
   * jitter, not a token, an id, a secret or a lock value, and nothing is
   * protected by it being unpredictable.
   */
  rankingOptions: { rng?: () => number; deterministic?: boolean } = {};

  constructor(
    private readonly prisma: PrismaService,
    private readonly messagesService: MessagesService,
    private readonly blocksService: BlocksService,
    private readonly verificationAccess: VerificationAccessService,
    // Optional: serialises per-user queue changes. Without it (tests, a dev
    // box with no Redis service wired) the changes run unserialised, as before.
    @Optional() private readonly redisService?: RedisService,
    // Optional: who is actually here (IM-1). Without it a timed-out match
    // re-queues both people, as it always did.
    @Optional() private readonly presenceService?: PresenceService,
    // Optional: durable deletion of a closed chat's photos and videos (IM-8).
    @Optional() private readonly mediaCleanup?: MediaCleanupService,
  ) {}

  /**
   * Sessions that still hold these people (IM-2): a proposal not yet
   * answered, or a chat that is open or being opened (ACCEPTED before its
   * conversation is linked counts, which is what closes the window the old
   * accept check left).
   */
  private static liveFor(
    userIds: string[],
    now: Date,
  ): Prisma.MatchSessionWhereInput {
    return {
      AND: [
        { OR: userIds.flatMap((id) => [{ userAId: id }, { userBId: id }]) },
        {
          OR: [
            { status: 'PENDING', expiresAt: { gt: now } },
            {
              status: 'ACCEPTED',
              chatStatus: 'ACTIVE',
              OR: [{ chatExpiresAt: null }, { chatExpiresAt: { gt: now } }],
            },
          ],
        },
      ],
    };
  }

  /**
   * Whether a person who did not answer a proposal is still around (IM-1).
   * A timed-out match used to put both people back in the queue with a fresh
   * 30 minutes, so someone who had closed the app was offered to real people
   * every minute or so, indefinitely. Fails open: no presence service, or a
   * presence read that fails, keeps the old behaviour.
   */
  private async isPresent(userId: string): Promise<boolean> {
    if (!this.presenceService) return true;
    try {
      const presence = await this.presenceService.getPresence(userId);
      return presence?.status === 'online';
    } catch {
      return true;
    }
  }

  /**
   * Runs a change to one user's queue state under a per-user lock, so a
   * requeue, a join and a cancel for the same person cannot interleave.
   * RedisService.withLock also serialises in-process and falls through to
   * plain execution when Redis is not connected.
   */
  private withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    if (!this.redisService) return fn();
    return this.redisService.withLock(`instant-match:user:${userId}`, 5000, fn);
  }

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
   *
   * `matchNow: false` queues without the immediate pairing attempt — used by
   * a direct request, which must claim one specific person before the ranker
   * can hand the requester to somebody else.
   */
  async joinQueue(
    dto: JoinQueueDto,
    { matchNow = true }: { matchNow?: boolean } = {},
  ): Promise<void> {
    // Through the shared policy rather than its own `verificationStatus !==
    // 'VERIFIED'` comparison: one definition of eligibility, one feature flag,
    // and the cached lookup the rest of the app already pays for.
    if (!(await this.verificationAccess.isUserEligible(dto.userId))) {
      throw new ForbiddenException(
        'Account verification is required for Instant Match',
      );
    }

    await this.withUserLock(dto.userId, async () => {
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

      // The checks above and the write are not one step, and a pairing takes
      // no lock: one can claim this person between them, and the write would
      // then put them back in the queue while they hold a match (IM-2). Seen
      // after the write, it is undone.
      if (await this.holdsLiveSession(dto.userId)) {
        await this.prisma.matchQueueEntry.deleteMany({
          where: { userId: dto.userId },
        });
        throw new BadRequestException('Respond to your current match first');
      }
    });

    this.logger.log(
      `queue:join user=${dto.userId} activity=${dto.activity} when=${dto.timePreference}`,
    );

    // Everyone waiting in this bucket now sees a different queue depth.
    this.requestQueueBroadcast();

    if (!matchNow) return;

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
    const removed = await this.withUserLock(userId, async () => {
      const entry = await this.prisma.matchQueueEntry.findUnique({
        where: { userId },
      });
      if (!entry) return false;
      await this.prisma.matchQueueEntry.deleteMany({ where: { userId } });
      return true;
    });
    if (!removed) return;
    this.logger.log(`queue:cancel user=${userId}`);
    this.requestQueueBroadcast();
  }

  // ─── Matching ───────────────────────────────────────────────────────────────

  /**
   * Attempts to pair `userId` with the best-scoring compatible candidate.
   *
   * Candidates are tried best-first: claiming a pair can lose a race against
   * a concurrent match, in which case we fall through to the next candidate
   * instead of giving up and leaving the user waiting a full sweep cycle.
   */
  /** Returns whether a pairing was made. */
  async tryMatch(userId: string): Promise<boolean> {
    const myEntry = await this.prisma.matchQueueEntry.findUnique({
      where: { userId },
    });
    if (!myEntry) return false;
    if (myEntry.expiresAt.getTime() <= Date.now()) return false;

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
        user: {
          verificationStatus: 'VERIFIED',
          accountStatus: 'ACTIVE',
          deletedAt: null,
        },
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

    if (candidates.length === 0) return false;

    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_CARD_SELECT,
    });
    if (!me) return false;

    const now = Date.now();
    const candidateIds = candidates.map((c) => c.userId);

    // Everything the ranker needs about this user's relationship to each
    // candidate, in four batched reads — never one per candidate. This is the
    // only place that grows as signals are added, which is why it returns one
    // object rather than letting each signal fetch its own data.
    const relations = await this.collectRelations(userId, candidateIds);

    const myContext = this.toScoringContext(
      myEntry,
      me,
      relations.myCommunityIds,
      relations.campusByUser.get(userId) ?? null,
    );

    // A pairing either person has passed on three times is not a ranking
    // problem any more; it is not offered for a while (`isHardSkippedEitherWay`).
    const scored = this.scoreCandidates(
      myContext,
      candidates,
      relations,
      now,
    ).filter((row) => !row.skipped);

    // Threshold, tie bands and exploration all live in `orderCandidates`; the
    // service's job is only to try the order it is given, in order, falling
    // through whenever a claim loses its race.
    const ordered = orderCandidates(scored, {
      searcherJoinedAt: myEntry.joinedAt.getTime(),
      poolSize: scored.length,
      now,
      rng: this.rankingOptions.rng,
      deterministic: this.rankingOptions.deterministic,
    });

    if (ordered.length === 0) return false;

    const timer = getAcceptTimerSecs(myEntry.activity, myEntry.timePreference);

    for (const { item, picked, threshold } of ordered) {
      const { candidate, detail, score } = item;
      const claim = await this.claimPair(myEntry, candidate, timer, {
        features: proposalFeatures({
          source: 'ranker',
          mutual: item.mutual,
          threshold,
          picked,
          waitedMs:
            now -
            Math.min(myEntry.joinedAt.getTime(), candidate.joinedAt.getTime()),
          poolSize: scored.length,
        }),
      });
      // The searcher was taken (or holds a match): nobody else is worth a
      // transaction (IM-18). Otherwise this candidate was lost — try the next.
      if (claim.outcome === 'searcher-gone') return false;
      if (claim.outcome !== 'claimed') continue;
      const { session } = claim;

      const area = myEntry.area ?? candidate.area ?? null;
      const expiresAtMs = session.expiresAt.getTime();

      realtimeGatewayRef?.emitMatchFound(userId, {
        matchId: session.id,
        candidate: this.toCardBeforeAccept(candidate.user),
        activity: myEntry.activity,
        area,
        timer,
        expiresAt: expiresAtMs,
        compatibility: score,
      });
      realtimeGatewayRef?.emitMatchFound(candidate.userId, {
        matchId: session.id,
        candidate: this.toCardBeforeAccept(me),
        activity: myEntry.activity,
        area,
        timer,
        expiresAt: expiresAtMs,
        compatibility: score,
      });

      // Every pairing prints why it happened: the per-signal values, their
      // resolved weights, the coverage behind the number, and whether this
      // candidate came from the leading band or from an exploration draw.
      // "Why were those two put together?" is answerable from the log alone.
      this.logger.log(
        `match:created ${session.id} ${userId} <> ${candidate.userId} ` +
          `via=${picked} ${explainPair(detail)}`,
      );

      // Both are out of the queue now — refresh the depth for everyone left.
      this.requestQueueBroadcast();
      return true;
    }
    return false;
  }

  /**
   * Scores every candidate for one searcher, from both sides (`scoreMutual`),
   * with the skip rule applied both ways. Shared by `tryMatch` and
   * `explainRankingFor`, so the explanation is exactly what matching does.
   */
  private scoreCandidates(
    myContext: SideContext,
    candidates: WaitingCandidate[],
    relations: Relations,
    now: number,
  ) {
    return candidates.map((candidate) => {
      const feedback = relations.feedback.get(candidate.userId) ?? null;
      const mutual = scoreMutual(
        myContext,
        this.toScoringContext(
          candidate,
          candidate.user,
          relations.sharedCommunityIds.get(candidate.userId) ?? null,
          relations.campusByUser.get(candidate.userId) ?? null,
        ),
        {
          feedback,
          social: relations.social.get(candidate.userId) ?? null,
          now,
        },
      );
      return {
        candidate,
        feedback,
        mutual,
        detail: mutual.detail,
        score: mutual.detail.score,
        joinedAt: candidate.joinedAt.getTime(),
        skipped: isHardSkippedEitherWay(feedback, now),
      };
    });
  }

  /**
   * The ranked candidate list for one user, with a full explanation of every
   * score — the debugging counterpart to `tryMatch`.
   *
   * Deterministic: no exploration draw, no tie shuffling, so two runs on the
   * same data give the same answer and a surprising pairing can be picked
   * apart. Nothing calls this in the request path; it exists for tests, for a
   * REPL, and for the next time someone asks why the queue chose who it chose.
   */
  async explainRankingFor(
    userId: string,
    now = Date.now(),
  ): Promise<RankingExplanation> {
    const empty: RankingExplanation = {
      queued: false,
      candidates: [],
      order: [],
    };

    const myEntry = await this.prisma.matchQueueEntry.findUnique({
      where: { userId },
    });
    if (!myEntry) return empty;

    const excludedIds = await this.getExcludedUserIds(userId);
    const candidates = await this.prisma.matchQueueEntry.findMany({
      where: {
        activity: myEntry.activity,
        user: {
          verificationStatus: 'VERIFIED',
          accountStatus: 'ACTIVE',
          deletedAt: null,
        },
        userId: {
          not: userId,
          notIn: excludedIds.length ? excludedIds : undefined,
        },
        expiresAt: { gt: new Date() },
      },
      include: { user: { select: USER_CARD_SELECT } },
      orderBy: { joinedAt: 'asc' },
      take: CANDIDATE_SCAN_LIMIT,
    });

    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_CARD_SELECT,
    });
    if (!me) return { ...empty, queued: true };

    const relations = await this.collectRelations(
      userId,
      candidates.map((c) => c.userId),
    );
    const myContext = this.toScoringContext(
      myEntry,
      me,
      relations.myCommunityIds,
      relations.campusByUser.get(userId) ?? null,
    );

    const rows = this.scoreCandidates(
      myContext,
      candidates,
      relations,
      now,
    ).map((row) => ({
      userId: row.candidate.userId,
      username: row.candidate.user.username,
      score: row.score,
      skipped: row.skipped,
      feedback: row.feedback,
      detail: row.detail,
      explanation: explainPair(row.detail),
      joinedAt: row.joinedAt,
    }));

    const pool = rows.filter((r) => !r.skipped);
    const ordered = orderCandidates(pool, {
      searcherJoinedAt: myEntry.joinedAt.getTime(),
      poolSize: pool.length,
      now,
      deterministic: true,
    });

    return {
      queued: true,
      candidates: rows.sort((x, y) => y.score - x.score),
      order: ordered.map((o) => ({
        userId: o.item.userId,
        score: o.item.score,
        threshold: Math.round(o.threshold * 10) / 10,
      })),
    };
  }

  /**
   * Everything the ranker knows about this user's relationship to a set of
   * candidates, in four batched queries.
   *
   * One query per *kind* of relationship, never one per candidate: the scan
   * limit keeps every `in` list bounded, and adding a signal that needs data
   * means adding a read here rather than a read inside the scoring loop. That
   * distinction is the whole reason this function exists — the moment a signal
   * fetches its own data, ranking 200 candidates becomes 200 round trips.
   *
   * Failures degrade rather than propagate: a ranking without follow edges is
   * worse than one with them, but a matching request that fails because a
   * social query timed out is worse than both.
   */
  private async collectRelations(
    userId: string,
    candidateIds: string[],
  ): Promise<{
    feedback: Map<string, PairFeedback>;
    social: Map<string, PairSocial>;
    sharedCommunityIds: Map<string, string[]>;
    myCommunityIds: string[] | null;
    campusByUser: Map<string, string | null>;
  }> {
    const feedback = new Map<string, PairFeedback>();
    const social = new Map<string, PairSocial>();
    const sharedCommunityIds = new Map<string, string[]>();
    let myCommunityIds: string[] | null = null;
    const campusByUser = new Map<string, string | null>();

    if (candidateIds.length === 0) {
      return {
        feedback,
        social,
        sharedCommunityIds,
        myCommunityIds,
        campusByUser,
      };
    }

    const since = new Date(Date.now() - FEEDBACK.windowMs);

    const [sessions, follows, myMemberships, affiliations] = await Promise.all([
      this.prisma.matchSession
        .findMany({
          where: {
            createdAt: { gte: since },
            OR: [
              { userAId: userId, userBId: { in: candidateIds } },
              { userBId: userId, userAId: { in: candidateIds } },
            ],
          },
          select: {
            userAId: true,
            userBId: true,
            status: true,
            declinedById: true,
            createdAt: true,
          },
        })
        .catch((err) => {
          this.logger.warn(
            `match history unavailable for ${userId}: ${(err as Error)?.message}`,
          );
          return [] as Array<{
            userAId: string;
            userBId: string;
            status: string;
            declinedById: string | null;
            createdAt: Date;
          }>;
        }),
      this.prisma.follow
        .findMany({
          where: {
            OR: [
              { followerId: userId, followingId: { in: candidateIds } },
              { followingId: userId, followerId: { in: candidateIds } },
            ],
          },
          select: { followerId: true, followingId: true },
        })
        .catch(() => [] as Array<{ followerId: string; followingId: string }>),
      this.prisma.communityMember
        .findMany({ where: { userId }, select: { communityId: true } })
        .catch(() => [] as Array<{ communityId: string }>),
      // The campus each side really belongs to: the college of their ACTIVE
      // affiliation (owner decision D4). The `campus` a client sends with its
      // queue request is free text, so anyone could claim any campus and earn
      // the campus signal's weight with a stranger's typed string.
      this.prisma.collegeAffiliation
        .findMany({
          where: { userId: { in: [userId, ...candidateIds] } },
          select: { userId: true, ...ACTIVE_AFFILIATION_SELECT },
        })
        .catch(() => []),
    ]);

    for (const row of affiliations) {
      campusByUser.set(row.userId, activeAffiliationCollegeId(row));
    }

    for (const session of sessions) {
      const other =
        session.userAId === userId ? session.userBId : session.userAId;
      const entry = feedback.get(other) ?? {
        accepted: 0,
        declinedByMe: 0,
        declinedByThem: 0,
        expired: 0,
        lastPairedAt: null,
      };

      const at = session.createdAt.getTime();
      entry.lastPairedAt = Math.max(entry.lastPairedAt ?? 0, at) || at;

      if (session.status === 'ACCEPTED') entry.accepted += 1;
      else if (session.status === 'EXPIRED') entry.expired += 1;
      else if (session.status === 'DECLINED') {
        // A decline from before the attribution column existed carries no
        // side. Counting it as the viewer's would invent a pass they never
        // made, so it is counted the way it reads: a pairing that did not
        // happen, which is what `expired` already means.
        if (session.declinedById === userId) entry.declinedByMe += 1;
        else if (session.declinedById === other) entry.declinedByThem += 1;
        else entry.expired += 1;
      }

      feedback.set(other, entry);
    }

    for (const edge of follows) {
      const other =
        edge.followerId === userId ? edge.followingId : edge.followerId;
      const entry = social.get(other) ?? {
        following: false,
        followedBy: false,
      };
      if (edge.followerId === userId) entry.following = true;
      else entry.followedBy = true;
      social.set(other, entry);
    }

    myCommunityIds = myMemberships.map((m) => m.communityId);

    if (myCommunityIds.length > 0) {
      // Scoped to the viewer's own communities on purpose: the signal only
      // needs the intersection, and fetching every candidate's full
      // membership list would be thousands of rows to compute an overlap
      // with at most a handful.
      const shared = await this.prisma.communityMember
        .findMany({
          where: {
            userId: { in: candidateIds },
            communityId: { in: myCommunityIds },
          },
          select: { userId: true, communityId: true },
        })
        .catch(() => [] as Array<{ userId: string; communityId: string }>);

      for (const row of shared) {
        const list = sharedCommunityIds.get(row.userId) ?? [];
        list.push(row.communityId);
        sharedCommunityIds.set(row.userId, list);
      }
    }

    return {
      feedback,
      social,
      sharedCommunityIds,
      myCommunityIds,
      campusByUser,
    };
  }

  /**
   * Shapes a queue entry plus its owner's profile into scorer input.
   *
   * `communityIds` is the *intersection* with the viewer's own memberships,
   * not the candidate's full list — see `collectRelations` for why. An empty
   * array therefore means "no shared community was found", which the signal
   * treats as no evidence rather than as a mark against them.
   */
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
    communityIds: string[] | null = null,
    campus: string | null = null,
  ): SideContext {
    return {
      // The verified college, never the typed `entry.campus` (D4). No
      // affiliation means no campus evidence: the signal drops out rather than
      // counting against anyone.
      campus,
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
      communityIds,
    };
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
    {
      requestedByA = false,
      activity,
      exactDeadline = false,
      features,
    }: {
      requestedByA?: boolean;
      activity?: string;
      /** What the pairing was judged on, for the learning plan. */
      features?: Prisma.InputJsonObject;
      /** No grace on top of the timer: the deadline the people see is the
       *  deadline the server enforces. */
      exactDeadline?: boolean;
    } = {},
  ): Promise<ClaimResult> {
    const expiresAt = new Date(
      Date.now() +
        timerSecs * 1000 +
        (exactDeadline ? 0 : ACCEPT_TIMER_GRACE_MS),
    );

    try {
      const session = await this.prisma.$transaction(async (tx) => {
        const a = await tx.matchQueueEntry.findUnique({
          where: { userId: myEntry.userId },
        });
        const b = await tx.matchQueueEntry.findUnique({
          where: { userId: candidate.userId },
        });
        if (!a) throw new PairClaimLost('searcher');
        if (!b) throw new PairClaimLost('candidate');

        const removed = await tx.matchQueueEntry.deleteMany({
          where: { userId: { in: [myEntry.userId, candidate.userId] } },
        });
        if (removed.count !== 2) throw new PairClaimLost('candidate');

        // Neither may already hold a match (IM-2). A queue row can outlive
        // the pairing that should have removed it, written by a join or a
        // re-queue that checked just before that pairing committed; pairing
        // such a person again gave them two pending matches, and then two
        // chats. Checked after the deletes, inside the claim, so it sees any
        // pairing that won the rows first.
        const busy = await tx.matchSession.findFirst({
          where: InstantMatchService.liveFor(
            [myEntry.userId, candidate.userId],
            new Date(),
          ),
          select: { userAId: true, userBId: true },
        });
        if (busy) {
          const searcherBusy =
            busy.userAId === myEntry.userId || busy.userBId === myEntry.userId;
          throw new PairClaimLost(
            searcherBusy ? 'searcher' : 'candidate',
            searcherBusy ? myEntry.userId : candidate.userId,
          );
        }

        return tx.matchSession.create({
          data: {
            userAId: a.userId,
            userBId: b.userId,
            activity: activity ?? a.activity,
            expiresAt,
            // A direct request marks itself on the requester's snapshot (a
            // JSON column, so no schema change): declines and reloads read it
            // to tell a request from a ranker pairing.
            snapshotA: (requestedByA
              ? { ...this.entryToSnapshot(a), requested: true }
              : this.entryToSnapshot(a)) as unknown as Prisma.InputJsonValue,
            snapshotB: this.entryToSnapshot(
              b,
            ) as unknown as Prisma.InputJsonValue,
            // A direct request is the requester's yes, given up front.
            aAccepted: requestedByA,
            ...(features ? { features } : {}),
          },
          select: { id: true, expiresAt: true },
        });
      });
      return { outcome: 'claimed', session };
    } catch (err) {
      if (!(err instanceof PairClaimLost)) throw err;
      // The row of someone who holds a match is a leftover: it must not keep
      // them listed as searching, nor be claimed again.
      if (err.staleRowOf) {
        await this.prisma.matchQueueEntry
          .deleteMany({ where: { userId: err.staleRowOf } })
          .catch(() => undefined);
      }
      return {
        outcome: err.side === 'searcher' ? 'searcher-gone' : 'candidate-lost',
      };
    }
  }

  /** Whether this person holds a match or an open chat right now. */
  private async holdsLiveSession(userId: string): Promise<boolean> {
    const live = await this.prisma.matchSession.findFirst({
      where: InstantMatchService.liveFor([userId], new Date()),
      select: { id: true },
    });
    return live !== null;
  }

  // ─── Requesting someone directly ─────────────────────────────────────────────

  /**
   * One searcher asks to be paired with one specific person on the roster.
   *
   * Built on the same claim the ranker uses, so it inherits its guarantees:
   * both rows leave the queue in one transaction, which is what stops either
   * person being paired twice, and a claim that loses a race simply fails.
   * The requester is user A with their acceptance already recorded, so the
   * other person's Accept completes the match through the ordinary path, and
   * a Pass or a timeout goes through the ordinary decline/expiry, which puts
   * the requester straight back in the queue — their search carries on.
   *
   * Everything the roster promises is re-checked here, because a roster can
   * be minutes old: the target must still be searching, still eligible, and
   * not blocked in either direction.
   */
  async requestMatch(
    requesterId: string,
    targetUserId: string,
    search?: JoinQueueDto,
  ): Promise<void> {
    if (requesterId === targetUserId) {
      throw new BadRequestException('You cannot match with yourself');
    }

    // Asked from the roster before searching: the request starts the search,
    // with the same checks as any join, but without the immediate pairing
    // attempt that could hand the requester to somebody else first. If the
    // request then fails, that implicit search is undone, so an error never
    // leaves someone queued who did not choose to be.
    const existing = await this.prisma.matchQueueEntry.findUnique({
      where: { userId: requesterId },
    });
    const queued =
      Boolean(existing) && (existing?.expiresAt.getTime() ?? 0) > Date.now();
    if (!queued && search && search.userId === requesterId) {
      await this.joinQueue(search, { matchNow: false });
      try {
        await this.claimRequested(requesterId, targetUserId);
      } catch (err) {
        // In the moment between joining and claiming, another joiner's
        // ranker may already have paired this user. That match stands, and
        // its own `match:found` drives the client — the request just steps
        // aside rather than reporting a failure that did not happen.
        if (await this.findPendingSessionFor(requesterId)) return;
        await this.cancelQueue(requesterId);
        throw err;
      }
      return;
    }

    await this.claimRequested(requesterId, targetUserId);
  }

  private async claimRequested(
    requesterId: string,
    targetUserId: string,
  ): Promise<void> {
    const [mine, theirs] = await Promise.all([
      this.prisma.matchQueueEntry.findUnique({
        where: { userId: requesterId },
      }),
      this.prisma.matchQueueEntry.findUnique({
        where: { userId: targetUserId },
      }),
    ]);
    const now = Date.now();
    if (!mine || mine.expiresAt.getTime() <= now) {
      throw new BadRequestException('Start a search before sending a request');
    }
    if (!theirs || theirs.expiresAt.getTime() <= now) {
      throw new BadRequestException('They are not searching any more');
    }

    const excluded = await this.getExcludedUserIds(requesterId);
    if (excluded.includes(targetUserId)) {
      // Worded like "not searching" on purpose: a block must not be
      // discoverable by probing who can be asked.
      throw new BadRequestException('They are not searching any more');
    }
    const eligibility = await this.verificationAccess.getEligibilityMap([
      targetUserId,
    ]);
    if (!eligibility.get(targetUserId)) {
      throw new BadRequestException('They are not searching any more');
    }

    const [me, them] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: requesterId },
        select: USER_CARD_SELECT,
      }),
      this.prisma.user.findUnique({
        where: { id: targetUserId },
        select: USER_CARD_SELECT,
      }),
    ]);
    if (!me || !them) {
      throw new BadRequestException('They are not searching any more');
    }

    // What they are up for is the activity, but the wait is the same for every
    // request: 30 seconds, then it is withdrawn and both go back to searching.
    const timer = REQUEST_WINDOW_SECS;
    // Judged the way the ranker would have judged it, and recorded: a direct
    // request is the strongest "I want this person" a learner can see.
    const relations = await this.collectRelations(requesterId, [targetUserId]);
    const requestScore = scoreMutual(
      this.toScoringContext(
        mine,
        me,
        relations.myCommunityIds,
        relations.campusByUser.get(requesterId) ?? null,
      ),
      this.toScoringContext(
        theirs,
        them,
        relations.sharedCommunityIds.get(targetUserId) ?? null,
        relations.campusByUser.get(targetUserId) ?? null,
      ),
      {
        feedback: relations.feedback.get(targetUserId) ?? null,
        social: relations.social.get(targetUserId) ?? null,
        now,
      },
    );

    const claim = await this.claimPair(mine, theirs, timer, {
      features: proposalFeatures({
        source: 'request',
        mutual: requestScore,
        threshold: null,
        picked: null,
        waitedMs:
          now - Math.min(mine.joinedAt.getTime(), theirs.joinedAt.getTime()),
        poolSize: 1,
      }),
      requestedByA: true,
      exactDeadline: true,
      // What they are up for is what was asked for: it is the activity both
      // cards describe and the reason the chat opens with.
      activity: theirs.activity,
    });
    if (claim.outcome === 'searcher-gone') {
      throw new BadRequestException('Respond to your current match first');
    }
    if (claim.outcome !== 'claimed') {
      throw new BadRequestException('They were just matched with someone else');
    }
    const { session } = claim;

    const area = theirs.area ?? mine.area ?? null;
    const expiresAtMs = session.expiresAt.getTime();

    realtimeGatewayRef?.emitMatchFound(requesterId, {
      matchId: session.id,
      candidate: this.toCardBeforeAccept(them),
      activity: theirs.activity,
      area,
      timer,
      expiresAt: expiresAtMs,
      awaitingOther: true,
      requestSent: true,
    });
    realtimeGatewayRef?.emitMatchFound(targetUserId, {
      matchId: session.id,
      candidate: this.toCardBeforeAccept(me),
      activity: theirs.activity,
      area,
      timer,
      expiresAt: expiresAtMs,
      requested: true,
    });

    // Withdrawn on the dot rather than at the next sweep.
    requestExpiryScheduler?.(session.id, timer * 1000 + 250);

    this.logger.log(
      `match:requested ${session.id} ${requesterId} -> ${targetUserId}`,
    );

    this.requestQueueBroadcast();
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
      aAccepted: boolean;
      bAccepted: boolean;
      snapshotA: unknown;
      snapshotB: unknown;
    },
    userId: string,
  ): Promise<void> {
    // Conditional update = the transition claim. Exactly one caller can move
    // a session out of PENDING, so a simultaneous decline from both sides
    // notifies each user once instead of twice.
    //
    // The claim is also where the pass is attributed. It has to be written by
    // the winner of that race and nowhere else: a second write would record
    // whichever side happened to arrive last, and the ranker would then
    // penalise the wrong person for a decision they did not make.
    const claimed = await this.prisma.matchSession.updateMany({
      where: { id: session.id, status: 'PENDING' },
      data: {
        status: 'DECLINED',
        declinedById: userId,
        ...scrubbedSnapshots(session.snapshotA),
      },
    });
    if (claimed.count !== 1) return;

    const otherUserId =
      session.userAId === userId ? session.userBId : session.userAId;
    const otherSnapshot = readQueueSnapshot(
      session.userAId === userId ? session.snapshotB : session.snapshotA,
    );
    const otherAccepted =
      session.userAId === userId ? session.bAccepted : session.aAccepted;

    // Back to searching only if they are still here (IM-1).
    const requeued =
      (otherAccepted || (await this.isPresent(otherUserId))) &&
      (await this.requeue(otherUserId, otherSnapshot));

    // A direct request interrupted two searches, so backing out of it — the
    // target passing, or the requester withdrawing — returns *both* people to
    // what they were doing. A ranker pairing keeps its rule: whoever passes
    // has chosen to stop.
    const isRequest = isDirectRequest(session.snapshotA);
    const declinerRequeued = isRequest
      ? await this.requeue(
          userId,
          readQueueSnapshot(
            session.userAId === userId ? session.snapshotA : session.snapshotB,
          ),
        )
      : false;
    const declinerIsRequester = session.userAId === userId;

    realtimeGatewayRef?.emitMatchDeclined(userId, {
      reason: !isRequest
        ? 'You passed on this match'
        : withSearching(
            declinerIsRequester
              ? 'Request cancelled'
              : 'You passed on this request',
            declinerRequeued,
          ),
      requeued: declinerRequeued,
    });
    realtimeGatewayRef?.emitMatchDeclined(otherUserId, {
      reason: !isRequest
        ? withSearching(NO_MATCH, requeued)
        : withSearching(
            declinerIsRequester ? REQUEST_ENDED : REQUEST_NOT_ANSWERED,
            requeued,
          ),
      requeued,
    });

    this.logger.log(
      `match:declined ${session.id} by=${userId} requeued=${requeued}` +
        (isRequest ? ` request declinerRequeued=${declinerRequeued}` : ''),
    );

    if (requeued) await this.tryMatch(otherUserId);
    if (declinerRequeued) await this.tryMatch(userId);
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
      // Their other tabs and devices still show the card that asks; without
      // this, a Pass there would decline what they have just accepted (IM-19).
      realtimeGatewayRef?.emitMatchWaiting(
        isUserA ? session.userAId : session.userBId,
        { matchId: session.id },
      );
      // And the other side is told they are the one being waited for (IM-26).
      realtimeGatewayRef?.emitMatchPartnerAccepted(
        isUserA ? session.userBId : session.userAId,
        { matchId: session.id },
      );
      return;
    }

    // Re-check eligibility for BOTH people before the chat exists.
    //
    // The `@VerifiedOnly()` guard on `match:respond` only vouches for whoever
    // is calling right now; it says nothing about the other side, whose
    // verification may have been revoked at any point while this match sat
    // PENDING. A block placed in that window counts the same (IM-7). Either
    // way the match is withdrawn and both people are told, rather than left
    // on a card that can never open (IM-3).
    const eligibility = await this.verificationAccess.getEligibilityMap([
      session.userAId,
      session.userBId,
    ]);
    if (
      eligibility.get(session.userAId) === false ||
      eligibility.get(session.userBId) === false ||
      (await this.blocksService.isBlocked(session.userAId, session.userBId))
    ) {
      this.logger.warn(
        `match:refused ${session.id} — a participant is no longer eligible, or they are blocked`,
      );
      await this.expireSession(session.id, 'unavailable');
      return;
    }

    // Neither person may hold two live chats at once, and the check and the
    // claim are one step (IM-2, FEAT-29): both people's advisory locks are
    // held while it is decided, so two accepts for one person cannot both
    // find nothing. An ACCEPTED session whose conversation is still being
    // created counts as live, which closes the window the old check left.
    const outcome = await this.prisma.$transaction(async (tx) => {
      for (const id of [session.userAId, session.userBId].sort()) {
        const key = `instant-match:live:${id}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      }
      const now = new Date();
      const liveElsewhere = await tx.matchSession.findFirst({
        where: {
          id: { not: session.id },
          status: 'ACCEPTED',
          chatStatus: 'ACTIVE',
          OR: [
            { userAId: session.userAId },
            { userBId: session.userAId },
            { userAId: session.userBId },
            { userBId: session.userBId },
          ],
          AND: [
            { OR: [{ chatExpiresAt: null }, { chatExpiresAt: { gt: now } }] },
          ],
        },
        select: { id: true },
      });
      if (liveElsewhere)
        return { kind: 'live-elsewhere' as const, liveElsewhere };
      const current = await tx.matchSession.findUnique({
        where: { id: session.id },
        select: { snapshotA: true },
      });
      // Both sides are in. Claim the finalize transition so that two
      // simultaneous accepts create exactly one conversation.
      const claimed = await tx.matchSession.updateMany({
        where: { id: session.id, status: 'PENDING' },
        data: { status: 'ACCEPTED', ...scrubbedSnapshots(current?.snapshotA) },
      });
      return {
        kind: claimed.count === 1 ? ('claimed' as const) : ('lost' as const),
      };
    });
    if (outcome.kind === 'live-elsewhere') {
      this.logger.warn(
        `match:refused-already-matched ${session.id} — a participant already ` +
          `has live session ${outcome.liveElsewhere.id}`,
      );
      await this.expireSession(session.id, 'unavailable');
      return;
    }
    if (outcome.kind !== 'claimed') return;

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

    try {
      await this.prisma.matchSession.update({
        where: { id: session.id },
        data: {
          // Store the internal id: it is the stable foreign key, while the
          // public id is what the client routes on.
          conversationId: conv.internalId,
          // The chat's own lifecycle starts here, and the deadline is
          // recorded on the session rather than inferred from the
          // conversation — this is the row every send is authorized against.
          chatStatus: 'ACTIVE',
          chatExpiresAt: new Date(conv.expiresAt),
          matchReason: session.activity,
        },
      });
    } catch (err) {
      // Linking failed (IM-4). Left alone, the session sat ACCEPTED with no
      // chat, nobody was told, and no sweep looks at ACCEPTED rows. Undo it as
      // a failed conversation insert is undone: the session goes back to
      // PENDING (the sweep then expires it and tells both people) and the
      // empty conversation is closed for the cleanup to remove.
      await this.prisma.matchSession
        .updateMany({
          where: { id: session.id, status: 'ACCEPTED' },
          data: { status: 'PENDING' },
        })
        .catch(() => undefined);
      await this.prisma.conversation
        .updateMany({
          where: { id: conv.internalId },
          data: { status: 'ENDED', expiresAt: new Date() },
        })
        .catch(() => undefined);
      this.logger.error(`match:accept failed to link ${session.id}`, err);
      throw new BadRequestException('Could not open your chat — try again');
    }

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

  /**
   * Withdraws one direct request at its deadline (a delayed job). A request
   * that was answered in time is no longer PENDING, so this finds nothing.
   */
  async expireRequest(sessionId: string): Promise<void> {
    if (await this.expireSession(sessionId)) {
      this.logger.log(`match:request-withdrawn ${sessionId}`);
    }
  }

  async expireStale(): Promise<void> {
    const now = new Date();

    // The count is global now, so one broadcast covers every waiter — no
    // need to enumerate which buckets the sweep happened to touch.
    const removed = await this.prisma.matchQueueEntry.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    if (removed.count > 0) this.requestQueueBroadcast();

    // Bounded (IM-18): after an outage the backlog is worked off a tick at a
    // time instead of in one unbounded pass.
    const expired = await this.prisma.matchSession.findMany({
      where: { status: 'PENDING', expiresAt: { lt: now } },
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
      take: EXPIRE_BATCH,
    });

    let handled = 0;
    for (const { id } of expired) {
      // One session's failure must not strand everyone after it (IM-3).
      try {
        if (await this.expireSession(id)) handled += 1;
      } catch (err) {
        this.logger.error(`match:expire failed ${id}`, err);
      }
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

    const rematched = await this.rematchLongWaiters();
    if (rematched > 0)
      this.logger.log(`instant-match:sweep-matched ${rematched}`);
  }

  /** When the sweep last re-tried each waiter (this replica only). */
  private readonly sweepTriedAt = new Map<string, number>();

  /**
   * Re-tries matching for the people who have waited longest (phase 1).
   *
   * The bar a pairing has to clear falls while someone waits, but nothing
   * re-ran matching for them: a pair that was below the bar when the second
   * person joined was never looked at again.
   *
   * Only re-tries that can change something are made. A pair's bar uses the
   * longer of the two waits, so when somebody joins, that join's own attempt
   * already gets every waiter's lowered bar; the sweep only has to cover the
   * bar falling with nobody joining. So a waiter is re-tried every tick while
   * their bar is still falling, and every two minutes after that (a cooldown
   * ending or someone coming back online can still change the answer). A
   * waiter who is alone in their activity is not re-tried at all.
   *
   * The memory is per replica: with several, a waiter is at worst re-tried a
   * little more often, never less.
   */
  private async rematchLongWaiters(): Promise<number> {
    const now = Date.now();
    const live = await this.prisma.matchQueueEntry.findMany({
      where: { expiresAt: { gt: new Date(now) } },
      orderBy: { joinedAt: 'asc' },
      take: REMATCH_SCAN,
      select: { userId: true, activity: true, joinedAt: true },
    });

    const liveIds = new Set(live.map((e) => e.userId));
    for (const id of this.sweepTriedAt.keys()) {
      if (!liveIds.has(id)) this.sweepTriedAt.delete(id);
    }
    if (live.length < 2) return 0;

    // Counted only when every live entry was read; otherwise someone beyond
    // the scan could share the activity.
    const complete = live.length < REMATCH_SCAN;
    const perActivity = new Map<string, number>();
    for (const e of live) {
      perActivity.set(e.activity, (perActivity.get(e.activity) ?? 0) + 1);
    }
    // The bar is at its floor after the longest relaxation, plus one tick so
    // the attempt at the floor itself is made.
    const settledAfter = THRESHOLD.relaxFullMs + EXPIRY_SWEEP_MS;

    const due = live
      .filter((e) => {
        const waited = now - e.joinedAt.getTime();
        if (waited < REMATCH_AFTER_MS) return false;
        if (complete && (perActivity.get(e.activity) ?? 0) < 2) return false;
        if (waited <= settledAfter) return true;
        const last = this.sweepTriedAt.get(e.userId);
        return last === undefined || now - last >= REMATCH_SETTLED_EVERY_MS;
      })
      .slice(0, REMATCH_BATCH);

    let matched = 0;
    for (const { userId } of due) {
      this.sweepTriedAt.set(userId, now);
      try {
        if (await this.tryMatch(userId)) matched += 1;
      } catch (err) {
        this.logger.error(`match:sweep-retry failed ${userId}`, err);
      }
    }
    return matched;
  }

  /**
   * Moves one PENDING session to EXPIRED and puts both users back in the
   * queue. Returns false when another worker claimed it first, which keeps
   * the notifications single-delivery across multiple backend instances.
   */
  private async expireSession(
    sessionId: string,
    why: 'timeout' | 'unavailable' = 'timeout',
  ): Promise<boolean> {
    // Read before the claim: the claim clears the stored requests (IM-9), and
    // they are what puts people back in the queue.
    const session = await this.prisma.matchSession.findUnique({
      where: { id: sessionId },
      select: {
        status: true,
        userAId: true,
        userBId: true,
        aAccepted: true,
        bAccepted: true,
        snapshotA: true,
        snapshotB: true,
      },
    });
    if (!session || session.status !== 'PENDING') return false;

    const claimed = await this.prisma.matchSession.updateMany({
      where: { id: sessionId, status: 'PENDING' },
      data: { status: 'EXPIRED', ...scrubbedSnapshots(session.snapshotA) },
    });
    if (claimed.count !== 1) return false;

    const wasRequest = isDirectRequest(session.snapshotA);
    const sides: Array<[string, unknown, boolean]> = [
      [session.userAId, session.snapshotA, session.aAccepted],
      [session.userBId, session.snapshotB, session.bAccepted],
    ];

    for (const [uid, snap, accepted] of sides) {
      // Each person separately: a failure for one must not leave the other
      // unqueued and untold (IM-3).
      try {
        // Back to searching only if they answered or are still here (IM-1):
        // otherwise someone who closed the app is offered to real people
        // every time a match times out.
        const resume =
          why === 'unavailable' || accepted || (await this.isPresent(uid));
        const requeued = resume
          ? await this.requeue(uid, readQueueSnapshot(snap))
          : false;
        // A request nobody answered is withdrawn, not "timed out": the sender
        // should know it is gone, and the other person that it lapsed.
        // The same words whether the other person passed, never answered, or
        // the match could not open (owner decision D5): a different message
        // per cause told people who had passed on them.
        const subject = !wasRequest
          ? NO_MATCH
          : uid === session.userAId
            ? REQUEST_NOT_ANSWERED
            : REQUEST_ENDED;
        realtimeGatewayRef?.emitMatchDeclined(uid, {
          reason: requeued ? `${subject} — back to searching` : subject,
          requeued,
        });
        if (requeued) await this.tryMatch(uid);
      } catch (err) {
        this.logger.error(`match:expire side failed ${sessionId} ${uid}`, err);
      }
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
      const resumed = await this.withUserLock(userId, async () => {
        // Re-checked inside the lock: the user may have been matched again or
        // become ineligible while this requeue waited, and putting them back
        // in the queue then would resurrect them against that.
        if (!(await this.verificationAccess.isUserEligible(userId))) {
          return false;
        }
        if (
          (await this.findPendingSessionFor(userId)) ||
          (await this.getActiveChatSession(userId))
        ) {
          return false;
        }
        // Already searching again, on their own newer request: that one
        // stands (IM-5). A late re-queue used to overwrite it with the old
        // criteria and reset the wait.
        const current = await this.prisma.matchQueueEntry.findUnique({
          where: { userId },
          select: { expiresAt: true },
        });
        if (current && current.expiresAt.getTime() > Date.now()) {
          return 'already';
        }
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
        // As in joinQueue: a pairing may have claimed them between the
        // checks and the write (IM-2).
        if (await this.holdsLiveSession(userId)) {
          await this.prisma.matchQueueEntry.deleteMany({ where: { userId } });
          return false;
        }
        return true;
      });
      if (resumed === 'already') return true;
      if (!resumed) return false;
      realtimeGatewayRef?.emitSearchResumed(userId);
      this.requestQueueBroadcast();
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
    // One row per activity, not one per waiter (IM-17, FEAT-15): this runs on
    // every state read and resync of anyone searching. EXTRACT(EPOCH) of a
    // timestamp without time zone is its nominal seconds, and the column
    // holds UTC, so the sum is real epoch seconds.
    const groups = await this.prisma.$queryRaw<
      Array<{ activity: string; n: number; joinedSecs: number }>
    >`
      SELECT "activity",
        COUNT(*)::int AS "n",
        COALESCE(SUM(EXTRACT(EPOCH FROM "joinedAt")), 0)::float8 AS "joinedSecs"
      FROM "MatchQueueEntry"
      WHERE "expiresAt" > ${new Date()}
      GROUP BY "activity"
    `;
    const count = groups.reduce((sum, g) => sum + g.n, 0);
    if (count === 0) return { count: 0, sameActivity: 0, avgWaitSecs: 60 };
    const joinedSecs = groups.reduce((sum, g) => sum + g.joinedSecs, 0);
    const avgWaitSecs = Math.max(
      30,
      Math.round(Date.now() / 1000 - joinedSecs / count),
    );
    const sameActivity = activity
      ? (groups.find((g) => g.activity === activity)?.n ?? 0)
      : 0;
    return { count, sameActivity, avgWaitSecs };
  }

  /**
   * Everyone waiting in the Instant Match queue right now, for one viewer.
   *
   * Read straight from `MatchQueueEntry`, which is the queue: a row exists
   * only while that person is searching, `joinQueue` upserts it (so changing
   * your activity, time or area rewrites the row rather than adding one), and
   * `claimPair`, `cancelQueue` and the expiry sweep all delete it. There is
   * therefore no separate "who is searching" state to keep in step — this
   * cannot show someone who has stopped.
   *
   * Scoped per viewer, and by the same rule matching uses: the people you are
   * shown are the people you could actually be paired with. Blocks (both
   * directions) and the recent decline/timeout cooldown come from
   * `getExcludedUserIds`, so there is one definition of who is off-limits
   * rather than two that can disagree.
   *
   * Ranked for this viewer (D2, D3: see matching/roster.ts) and bounded.
   */
  async getSearchingNow(userId: string): Promise<SearchingNowEntry[]> {
    // The roster is for eligible members only. The `queue:list` socket event
    // reaches here without the HTTP guards (they do not run on a WebSocket),
    // so the viewer is checked here, in the service every path shares.
    if (!(await this.verificationAccess.isUserEligible(userId))) {
      throw new ForbiddenException(
        'Account verification is required for Instant Match',
      );
    }

    const now = Date.now();
    const [excludedIds, waiting, viewerEntry, viewer] = await Promise.all([
      // Blocks both ways and the recent decline/timeout cooldown: the same
      // definition matching uses.
      this.getExcludedUserIds(userId),
      this.waitingSnapshot(),
      this.prisma.matchQueueEntry.findUnique({ where: { userId } }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: USER_CARD_SELECT,
      }),
    ]);
    if (!viewer) return [];
    const excluded = new Set(excludedIds);
    const pool = waiting.filter(
      (e) =>
        e.userId !== userId &&
        !excluded.has(e.userId) &&
        e.expiresAt.getTime() > now,
    );
    if (pool.length === 0) return [];

    // One batched read for everything the viewer has with these people.
    const relations = await this.collectRelations(
      userId,
      pool.map((e) => e.userId),
    );

    const myCampus = relations.campusByUser.get(userId) ?? null;
    const searching = viewerEntry && viewerEntry.expiresAt.getTime() > now;
    const me: SideContext = searching
      ? this.toScoringContext(
          viewerEntry,
          viewer,
          relations.myCommunityIds,
          myCampus,
        )
      : {
          // Browsing without searching: only the profile is known.
          campus: myCampus,
          interests: viewer.interests ?? [],
          course: viewer.course,
          branch: viewer.branch,
          passingYear: viewer.passingYear,
          communityIds: relations.myCommunityIds,
        };

    const ranked = pool
      .map((e) => {
        // Two-sided, as matching scores it.
        const { detail } = scoreMutual(
          me,
          this.toScoringContext(
            e,
            e.user,
            relations.sharedCommunityIds.get(e.userId) ?? null,
            relations.campusByUser.get(e.userId) ?? null,
          ),
          {
            feedback: relations.feedback.get(e.userId) ?? null,
            social: relations.social.get(e.userId) ?? null,
            now,
          },
        );
        return {
          entry: e,
          visibility: rosterVisibility(detail.score, {
            sameActivity: Boolean(searching) && e.activity === me.activity,
            passedOnViewer:
              relations.feedback.get(e.userId)?.declinedByThem ?? 0,
          }),
        };
      })
      // Best first; ties go to whoever has waited longest.
      .sort(
        (x, y) =>
          y.visibility - x.visibility ||
          x.entry.joinedAt.getTime() - y.entry.joinedAt.getTime(),
      )
      .slice(0, ROSTER.limit);

    return ranked.map(({ entry }) => ({
      user: this.toCandidateDto(entry.user),
      activity: entry.activity,
      timePreference: entry.timePreference,
      optionalDetail: entry.optionalDetail,
      area: entry.area,
      joinedAt: entry.joinedAt.getTime(),
    }));
  }

  /**
   * Everyone waiting, with their cards: the part of the roster that is the
   * same for every viewer, read once and shared for ROSTER.snapshotTtlMs (and
   * dropped whenever this process changes the queue). Every roster viewer
   * re-reads when the queue moves, so without this each of them re-read the
   * whole queue at the same moment.
   */
  private rosterSnapshot: {
    at: number;
    rows: Promise<Awaited<ReturnType<InstantMatchService['readWaiting']>>>;
  } | null = null;

  private waitingSnapshot() {
    const now = Date.now();
    if (
      !this.rosterSnapshot ||
      now - this.rosterSnapshot.at > ROSTER.snapshotTtlMs
    ) {
      const rows = this.readWaiting();
      this.rosterSnapshot = { at: now, rows };
      // A failed read is not kept: the next viewer tries again.
      rows.catch(() => {
        if (this.rosterSnapshot?.rows === rows) this.rosterSnapshot = null;
      });
    }
    return this.rosterSnapshot.rows;
  }

  private readWaiting() {
    return this.prisma.matchQueueEntry.findMany({
      where: {
        expiresAt: { gt: new Date() },
        user: {
          verificationStatus: 'VERIFIED',
          accountStatus: 'ACTIVE',
          deletedAt: null,
        },
      },
      include: { user: { select: USER_CARD_SELECT } },
      orderBy: { joinedAt: 'asc' },
      take: ROSTER.scanLimit,
    });
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

  /** Joins, cancels, matches and expiries inside this window share one
   *  broadcast (IM-17). */
  private static readonly QUEUE_BROADCAST_COALESCE_MS = 500;
  private queueBroadcastTimer: NodeJS.Timeout | null = null;

  /**
   * Asks for fresh queue stats to be pushed to everyone waiting. Nothing
   * waits for it: a join, a pass or an accept used to hold its reply for a
   * read of the whole queue and one publish per waiter — twice for a join that
   * matched — which on a busy queue outlasted the app's 10-second timeout.
   * Requests inside one window share a single broadcast.
   */
  private requestQueueBroadcast(): void {
    // The queue moved: the shared roster snapshot is out of date.
    this.rosterSnapshot = null;
    if (!realtimeGatewayRef || this.queueBroadcastTimer) return;
    this.queueBroadcastTimer = setTimeout(
      () =>
        detach('instant-match queue broadcast', () =>
          this.flushQueueBroadcast(),
        ),
      InstantMatchService.QUEUE_BROADCAST_COALESCE_MS,
    );
    this.queueBroadcastTimer.unref?.();
  }

  /** Runs a requested broadcast now (its timer, or a spec). */
  private async flushQueueBroadcast(): Promise<void> {
    if (this.queueBroadcastTimer) {
      clearTimeout(this.queueBroadcastTimer);
      this.queueBroadcastTimer = null;
    }
    await this.broadcastQueueStats();
  }

  /**
   * Pushes fresh stats to everyone currently waiting, so a join, cancel,
   * match or expiry updates every searching screen at once.
   *
   * The headline count is global, so any change moves the number for every
   * waiter — not just for the bucket that changed. One read serves the whole
   * broadcast, and the people waiting for the same activity get the same
   * numbers, so they go out as one group each, all in ONE relay publish
   * (IM-17: it used to be one publish per waiter).
   */
  private async broadcastQueueStats(): Promise<void> {
    if (!realtimeGatewayRef) return;
    try {
      const waiting = await this.prisma.matchQueueEntry.findMany({
        where: { expiresAt: { gt: new Date() } },
        select: { userId: true, joinedAt: true, activity: true },
      });

      const byActivity = new Map<string, string[]>();
      for (const e of waiting) {
        const ids = byActivity.get(e.activity) ?? [];
        ids.push(e.userId);
        byActivity.set(e.activity, ids);
      }

      const base = this.summarise(waiting);
      realtimeGatewayRef.emitQueueStatsMany(
        [...byActivity.values()].map((userIds) => ({
          userIds,
          stats: { ...base, sameActivity: userIds.length },
        })),
      );

      // The same five moments that move the counts — a join, a cancel, a
      // match, an expiry, a re-queue — are exactly the moments the roster
      // changes, so the browse list is told here rather than through a
      // parallel set of call sites that could fall out of step with these.
      realtimeGatewayRef.emitQueueChanged();
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
    // An ineligible account (unverified, suspended, deleted) is shown the same
    // idle state as someone with nothing going on, rather than an error:
    // queue:sync runs for everyone on connect.
    if (!(await this.verificationAccess.isUserEligible(userId))) {
      return {
        queued: null,
        pendingMatch: null,
        recentMatch: null,
        stats: null,
      };
    }
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
          candidate: this.toCardBeforeAccept(other),
          activity: session.activity,
          area: snapshot?.area ?? null,
          timer: isDirectRequest(session.snapshotA)
            ? REQUEST_WINDOW_SECS
            : getAcceptTimerSecs(
                session.activity,
                snapshot?.timePreference ?? 'now',
              ),
          expiresAt: session.expiresAt.getTime(),
          // After a reload the requester must land on the wait, not on an
          // Accept they already gave; the other side keeps the request label.
          awaitingOther:
            session.userAId === userId ? session.aAccepted : session.bAccepted,
          requestSent:
            session.userAId === userId && isDirectRequest(session.snapshotA),
          partnerAccepted:
            session.userAId === userId ? session.bAccepted : session.aAccepted,
          requested:
            session.userBId === userId && isDirectRequest(session.snapshotA),
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
    // Same rule as getStateFor: an ineligible caller gets "no chat", not an
    // error. The lookup below is keyed on the caller's own id (they must be
    // userA or userB of the session), so no other user's chat is reachable.
    if (!(await this.verificationAccess.isUserEligible(userId))) return null;
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

    const ended = await this.endChat(session.id, {
      chatStatus: 'ENDED_BY_USER',
      endedById: userId,
      endedAt: new Date(),
    });
    if (ended) {
      this.logger.log(`instant-match:chat-ended ${session.id} by=${userId}`);
    }

    const fresh =
      ended ??
      (await this.prisma.matchSession.findUnique({
        where: { id: session.id },
      }));
    if (!fresh) return { ended: false, session: null };

    return {
      ended: ended !== null,
      session: this.toChatState(fresh, userId),
    };
  }

  /**
   * Ends a chat: the claim and the teardown in ONE transaction (IM-9).
   *
   * They used to be two steps — claim the session ended, then close the
   * conversation, swallowing any error — so a failed close left the
   * transcript in place behind a session that said it was gone, and nothing
   * ever retried (the sweep only looks at ACTIVE chats). Now a failure undoes
   * the claim: leaving reports the error and can be tried again, and expiry
   * is retried by the next sweep. Only an ACCEPTED session's chat can end
   * (IM-6): every session row starts with `chatStatus` ACTIVE, so without the
   * status check a pending match could be "left" by id.
   *
   * The photos and videos the chat carried are recorded for deletion in the
   * same transaction and deleted once it commits (IM-8); deleting the
   * messages alone left them in storage. Returns the ended session, or null
   * when it was not this call that ended it.
   */
  private async endChat(
    sessionId: string,
    data: Prisma.MatchSessionUpdateManyMutationInput,
  ): Promise<InstantMatchSession | null> {
    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.matchSession.updateMany({
        where: { id: sessionId, status: 'ACCEPTED', chatStatus: 'ACTIVE' },
        data,
      });
      if (claimed.count !== 1) return null;
      const found = await tx.matchSession.findUnique({
        where: { id: sessionId },
      });
      if (!found) return null;
      if (!found.conversationId) return { fresh: found, media: [] };
      const { owed, sentBy } = await this.tearDownConversation(
        tx,
        found.conversationId,
      );
      const fresh = await tx.matchSession.update({
        where: { id: sessionId },
        data: {
          aMessageCount: sentBy.get(found.userAId) ?? 0,
          bMessageCount: sentBy.get(found.userBId) ?? 0,
        },
      });
      return { fresh, media: owed };
    });
    if (!result) return null;
    this.mediaCleanup?.drainSoon(result.media);
    this.notifyChatEnded(result.fresh);
    return result.fresh;
  }

  /** Ends a chat because its 24h window closed. Same claim-once discipline as
   *  leaving, so the sweep and a concurrent read cannot both notify. */
  private async expireChatSession(sessionId: string): Promise<boolean> {
    try {
      const ended = await this.endChat(sessionId, {
        chatStatus: 'EXPIRED',
        endedAt: new Date(),
      });
      if (!ended) return false;
      this.logger.log(`instant-match:chat-expired ${sessionId}`);
      return true;
    } catch (err) {
      // Nothing changed; the next sweep (or the next read) tries again.
      this.logger.warn(
        `Could not end instant-match chat ${sessionId}`,
        err instanceof Error ? err.stack : undefined,
      );
      return false;
    }
  }

  /**
   * Tears a session's conversation down for good, inside the caller's
   * transaction (see endChat). Returns the storage keys of the photos and
   * videos it carried, already recorded as owed deletes.
   *
   * Marking the row ENDED is not enough on its own. The messages stay
   * queryable by anything that reads the conversation directly — a stale tab
   * replaying its history request, an IndexedDB rehydrate — and "the chat is
   * over" has to mean the transcript is gone, not merely hidden. `expiresAt`
   * is pulled back to now as well, so every window-based query in the
   * codebase agrees with `status` about this conversation being dead.
   */
  private async tearDownConversation(
    tx: Prisma.TransactionClient,
    conversationId: string,
  ): Promise<{ owed: string[]; sentBy: Map<string, number> }> {
    // One read before the messages go, for two things: how many each side
    // sent (whether a match became a conversation is the outcome the learning
    // plan cares about most, and it cannot be read afterwards; counts only,
    // never content), and which files they carried.
    const sent = await tx.message.findMany({
      where: { conversationId },
      select: { senderId: true, attachmentMediaId: true },
    });
    const sentBy = new Map<string, number>();
    const mediaIds: string[] = [];
    for (const { senderId, attachmentMediaId } of sent) {
      sentBy.set(senderId, (sentBy.get(senderId) ?? 0) + 1);
      if (attachmentMediaId !== null) mediaIds.push(attachmentMediaId);
    }
    const media = mediaIds.length
      ? await tx.media.findMany({
          where: { id: { in: mediaIds } },
          select: { objectKey: true },
        })
      : [];
    const owed =
      (await this.mediaCleanup?.recordPendingDeletions(
        media.map((m) => m.objectKey),
        tx,
      )) ?? [];

    // The denormalised preview is cleared before the messages it points at,
    // so no ordering inside the transaction leaves a dangling `lastMessageId`.
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
    // anything that does not is scoped to a message id that no longer exists.
    await tx.message.deleteMany({ where: { conversationId } });
    return { owed, sentBy };
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
      const participant = await this.prisma.conversationParticipant.findUnique({
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

  /** The card before acceptance: the same, minus the internal id (D1). */
  private toCardBeforeAccept(
    u: Parameters<InstantMatchService['toCandidateDto']>[0],
  ): MatchCandidateCard {
    const { id: _id, ...card } = this.toCandidateDto(u);
    return card;
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

/**
 * Internal signal used to roll back a pair claim that lost its race. `side`
 * says whose row was the problem; `staleRowOf` names someone whose queue row
 * should not exist because they already hold a match.
 */
class PairClaimLost extends Error {
  constructor(
    readonly side: 'searcher' | 'candidate',
    readonly staleRowOf?: string,
  ) {
    super('pair claim lost');
  }
}

/** A waiting queue row with its owner's card, as the ranker reads it. */
type WaitingCandidate = Prisma.MatchQueueEntryGetPayload<{
  include: { user: { select: typeof USER_CARD_SELECT } };
}>;

/** Everything the ranker knows about one searcher's relationships. */
type Relations = Awaited<ReturnType<InstantMatchService['collectRelations']>>;

type ClaimResult =
  | { outcome: 'claimed'; session: { id: string; expiresAt: Date } }
  | { outcome: 'searcher-gone' | 'candidate-lost' };

/**
 * What a session keeps of the two queue requests once it is no longer
 * PENDING: nothing, apart from the marker that it was a direct request. The
 * requests (campus, area, GPS) are only needed to re-queue people while the
 * match is being answered (IM-9).
 */
function scrubbedSnapshots(snapshotA: unknown): {
  snapshotA: Prisma.InputJsonValue | typeof Prisma.DbNull;
  snapshotB: typeof Prisma.DbNull;
} {
  return {
    snapshotA: isDirectRequest(snapshotA) ? { requested: true } : Prisma.DbNull,
    snapshotB: Prisma.DbNull,
  };
}

/** True for a session created by a direct request (see `claimPair`). */
function isDirectRequest(snapshotA: unknown): boolean {
  return (
    typeof snapshotA === 'object' &&
    snapshotA !== null &&
    (snapshotA as { requested?: unknown }).requested === true
  );
}

/**
 * What the other person is told when a match or a request does not go ahead,
 * whatever the reason: a pass, no answer in time, or a match that could not
 * open (D5). Only the person who passed is told it was their pass.
 */
const NO_MATCH = 'No match this time';
const REQUEST_NOT_ANSWERED = 'They are not available right now';
const REQUEST_ENDED = 'This request has ended';

function withSearching(reason: string, requeued: boolean): string {
  return requeued ? `${reason} — back to searching` : reason;
}
