import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MessagesService } from '../messages/messages.service';
import { computeMatchScore } from './instant-match.scoring';
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

export interface MatchCandidateDto {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  course: string | null;
  branch: string | null;
  currentYear: number | null;
  interests: string[];
  bio: string | null;
}

export interface MatchFoundPayload {
  matchId: string;
  candidate: MatchCandidateDto;
  activity: string;
  area: string | null;
  timer: number;
  /** Absolute deadline (ms epoch). The client counts down to this rather
   *  than to `timer` seconds from render, so a slow render, a backgrounded
   *  tab, or a late-arriving event cannot desync the ring from the server. */
  expiresAt: number;
}

export interface QueueStats {
  count: number;
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
  currentYear: true,
  interests: true,
  bio: true,
} as const;

export interface InstantMatchEmitter {
  emitMatchFound(userId: string, p: MatchFoundPayload): void;
  emitMatchAccepted(userId: string, p: { chatId: string }): void;
  emitMatchDeclined(userId: string, p: { reason: string; requeued: boolean }): void;
  emitSearchResumed(userId: string): void;
  emitQueueStats(userId: string, stats: QueueStats): void;
}

// Injected by RealtimeGateway.afterInit() to avoid a circular module import.
export let realtimeGatewayRef: InstantMatchEmitter | null = null;

export function setRealtimeGatewayRef(ref: InstantMatchEmitter | null) {
  realtimeGatewayRef = ref;
}

@Injectable()
export class InstantMatchService {
  private readonly logger = new Logger(InstantMatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messagesService: MessagesService,
  ) {}

  // ─── Join queue ─────────────────────────────────────────────────────────────

  /**
   * Idempotent: re-joining with the same or updated criteria replaces the
   * existing entry rather than stacking duplicates (userId is unique).
   */
  async joinQueue(dto: JoinQueueDto): Promise<void> {
    // A user holding a live match must resolve it before re-queueing,
    // otherwise accepting the old match and searching again race each other.
    const pending = await this.findPendingSessionFor(dto.userId);
    if (pending) {
      throw new BadRequestException('Respond to your current match first');
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
    await this.broadcastQueueStats(dto.campus, dto.activity, dto.timePreference);

    // The user is queued at this point, so a failure to pair them *right now*
    // must not be reported as a failed join — that would tell them the search
    // never started while the server happily kept them in the queue. The next
    // joiner's tryMatch, or the sweep, picks them up.
    try {
      await this.tryMatch(dto.userId);
    } catch (err) {
      this.logger.error(
        `Queued ${dto.userId}, but the immediate match attempt failed`,
        err as any,
      );
    }
  }

  async cancelQueue(userId: string): Promise<void> {
    const entry = await this.prisma.matchQueueEntry.findUnique({ where: { userId } });
    if (!entry) return;

    await this.prisma.matchQueueEntry.deleteMany({ where: { userId } });
    this.logger.log(`queue:cancel user=${userId}`);
    await this.broadcastQueueStats(entry.campus, entry.activity, entry.timePreference);
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
    const myEntry = await this.prisma.matchQueueEntry.findUnique({ where: { userId } });
    if (!myEntry) return;
    if (myEntry.expiresAt.getTime() <= Date.now()) return;

    const excludedIds = await this.getExcludedUserIds(userId);

    const candidates = await this.prisma.matchQueueEntry.findMany({
      where: {
        campus: myEntry.campus,
        activity: myEntry.activity,
        timePreference: myEntry.timePreference,
        userId: { not: userId, notIn: excludedIds.length ? excludedIds : undefined },
        expiresAt: { gt: new Date() },
      },
      include: { user: { select: USER_CARD_SELECT } },
    });

    if (candidates.length === 0) return;

    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_CARD_SELECT,
    });
    if (!me) return;

    const myContext = {
      area: myEntry.area,
      optionalDetail: myEntry.optionalDetail,
      latitude: myEntry.latitude,
      longitude: myEntry.longitude,
      interests: me.interests ?? [],
    };

    const ranked = candidates
      .map((candidate) => ({
        candidate,
        score: computeMatchScore(myContext, {
          area: candidate.area,
          optionalDetail: candidate.optionalDetail,
          latitude: candidate.latitude,
          longitude: candidate.longitude,
          interests: candidate.user.interests ?? [],
        }),
      }))
      // Ties break toward whoever has been waiting longest, so the queue
      // stays fair instead of favouring whatever order Postgres returned.
      .sort((a, b) =>
        b.score - a.score ||
        a.candidate.joinedAt.getTime() - b.candidate.joinedAt.getTime(),
      );

    const timer = getAcceptTimerSecs(myEntry.activity, myEntry.timePreference);

    for (const { candidate } of ranked) {
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
      });
      realtimeGatewayRef?.emitMatchFound(candidate.userId, {
        matchId: session.id,
        candidate: this.toCandidateDto(me),
        activity: myEntry.activity,
        area,
        timer,
        expiresAt: expiresAtMs,
      });

      this.logger.log(`match:created ${session.id} ${userId} <> ${candidate.userId}`);

      // Both are out of the queue now — refresh the depth for everyone left.
      await this.broadcastQueueStats(
        myEntry.campus,
        myEntry.activity,
        myEntry.timePreference,
      );
      return;
    }
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
    const expiresAt = new Date(Date.now() + timerSecs * 1000 + ACCEPT_TIMER_GRACE_MS);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const a = await tx.matchQueueEntry.findUnique({ where: { userId: myEntry.userId } });
        const b = await tx.matchQueueEntry.findUnique({ where: { userId: candidate.userId } });
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
            snapshotA: this.entryToSnapshot(a) as unknown as Prisma.InputJsonValue,
            snapshotB: this.entryToSnapshot(b) as unknown as Prisma.InputJsonValue,
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
    const session = await this.prisma.matchSession.findUnique({ where: { id: matchId } });
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
    session: { id: string; userAId: string; userBId: string; snapshotA: unknown; snapshotB: unknown },
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

    const otherUserId = session.userAId === userId ? session.userBId : session.userAId;
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

    this.logger.log(`match:declined ${session.id} by=${userId} requeued=${requeued}`);

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
      select: { aAccepted: true, bAccepted: true, status: true, conversationId: true },
    });
    if (!fresh || fresh.status !== 'PENDING') return;
    if (!fresh.aAccepted || !fresh.bAccepted) {
      this.logger.log(`match:half-accepted ${session.id}`);
      return;
    }

    // Both sides are in. Claim the finalize transition so that two
    // simultaneous accepts create exactly one conversation.
    const claimed = await this.prisma.matchSession.updateMany({
      where: { id: session.id, status: 'PENDING' },
      data: { status: 'ACCEPTED' },
    });
    if (claimed.count !== 1) return;

    let conv: { id: string; internalId: string };
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
      this.logger.error(`match:accept failed to open conversation ${session.id}`, err as any);
      throw new BadRequestException('Could not open your chat — try again');
    }

    await this.prisma.matchSession.update({
      where: { id: session.id },
      // Store the internal id: it is the stable foreign key, while the public
      // id is what the client routes on.
      data: { conversationId: conv.internalId },
    });

    realtimeGatewayRef?.emitMatchAccepted(session.userAId, { chatId: conv.id });
    realtimeGatewayRef?.emitMatchAccepted(session.userBId, { chatId: conv.id });

    this.logger.log(`match:accepted ${session.id} conversation=${conv.id}`);
  }

  // ─── Expiry ─────────────────────────────────────────────────────────────────

  async expireStale(): Promise<void> {
    const now = new Date();

    const staleEntries = await this.prisma.matchQueueEntry.findMany({
      where: { expiresAt: { lt: now } },
      select: { campus: true, activity: true, timePreference: true },
    });
    if (staleEntries.length > 0) {
      await this.prisma.matchQueueEntry.deleteMany({ where: { expiresAt: { lt: now } } });
      const buckets = new Map<string, { campus: string; activity: string; timePreference: string }>();
      for (const e of staleEntries) {
        buckets.set(`${e.campus}|${e.activity}|${e.timePreference}`, e);
      }
      for (const b of buckets.values()) {
        await this.broadcastQueueStats(b.campus, b.activity, b.timePreference);
      }
    }

    const expired = await this.prisma.matchSession.findMany({
      where: { status: 'PENDING', expiresAt: { lt: now } },
      select: { id: true },
    });

    let handled = 0;
    for (const { id } of expired) {
      if (await this.expireSession(id)) handled += 1;
    }

    if (handled > 0) this.logger.log(`match:expired ${handled} session(s)`);
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
      select: { userAId: true, userBId: true, snapshotA: true, snapshotB: true },
    });
    if (!session) return false;

    const sides: Array<[string, unknown]> = [
      [session.userAId, session.snapshotA],
      [session.userBId, session.snapshotB],
    ];

    for (const [uid, snap] of sides) {
      const requeued = await this.requeue(uid, readQueueSnapshot(snap));
      realtimeGatewayRef?.emitMatchDeclined(uid, {
        reason: requeued ? 'Match timed out — back to searching' : 'Match timed out',
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
  private async requeue(userId: string, snapshot: QueueSnapshot | null): Promise<boolean> {
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
      await this.broadcastQueueStats(
        snapshot.campus,
        snapshot.activity,
        snapshot.timePreference,
      );
      return true;
    } catch (err) {
      this.logger.error(`Failed to re-queue ${userId}`, err as any);
      return false;
    }
  }

  // ─── Stats ──────────────────────────────────────────────────────────────────

  async getQueueStats(
    campus: string,
    activity: string,
    timePreference: string,
  ): Promise<QueueStats> {
    const entries = await this.prisma.matchQueueEntry.findMany({
      where: { campus, activity, timePreference, expiresAt: { gt: new Date() } },
      select: { joinedAt: true },
    });

    if (entries.length === 0) return { count: 0, avgWaitSecs: 60 };

    const now = Date.now();
    const totalWait = entries.reduce((sum, e) => sum + (now - e.joinedAt.getTime()), 0);
    const avgWaitSecs = Math.max(30, Math.round(totalWait / entries.length / 1000));

    return { count: entries.length, avgWaitSecs };
  }

  /** Pushes fresh stats to every user currently waiting in a bucket, so a
   *  join, cancel, match, or expiry updates all of their screens at once. */
  private async broadcastQueueStats(
    campus: string,
    activity: string,
    timePreference: string,
  ): Promise<void> {
    if (!realtimeGatewayRef) return;
    try {
      const [stats, waiting] = await Promise.all([
        this.getQueueStats(campus, activity, timePreference),
        this.prisma.matchQueueEntry.findMany({
          where: { campus, activity, timePreference, expiresAt: { gt: new Date() } },
          select: { userId: true },
        }),
      ]);
      for (const { userId } of waiting) {
        realtimeGatewayRef.emitQueueStats(userId, stats);
      }
    } catch (err) {
      // Stats are cosmetic — never let them break a join or a match.
      this.logger.warn(`Failed to broadcast queue stats: ${(err as Error)?.message}`);
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
      const otherId = session.userAId === userId ? session.userBId : session.userAId;
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
          timer: getAcceptTimerSecs(session.activity, snapshot?.timePreference ?? 'now'),
          expiresAt: session.expiresAt.getTime(),
        };
      }
    }

    const stats = live
      ? await this.getQueueStats(live.campus, live.activity, live.timePreference)
      : null;

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

    const otherId = session.userAId === userId ? session.userBId : session.userAId;
    const other = await this.prisma.user.findUnique({
      where: { id: otherId },
      select: USER_CARD_SELECT,
    });
    if (!other) return null;

    // conversationId holds the internal id; the client routes on the public
    // one. A missing or already-expired conversation yields a null chatId so
    // the UI can show the pairing without offering a dead link.
    let chatId: string | null = null;
    if (session.conversationId) {
      const conv = await this.prisma.conversation.findFirst({
        where: {
          id: session.conversationId,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { id: true, publicId: true },
      });
      if (conv) chatId = conv.publicId || conv.id;
    }

    return {
      matchId: session.id,
      candidate: this.toCandidateDto(other),
      activity: session.activity,
      chatId,
      matchedAt: session.createdAt.getTime(),
    };
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

    const [blocks, recent] = await Promise.all([
      this.prisma.block.findMany({
        where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
        select: { blockerId: true, blockedId: true },
      }),
      this.prisma.matchSession.findMany({
        where: {
          status: { in: ['DECLINED', 'EXPIRED'] },
          createdAt: { gte: since },
          OR: [{ userAId: userId }, { userBId: userId }],
        },
        select: { userAId: true, userBId: true },
      }),
    ]);

    const excluded = new Set<string>();
    for (const b of blocks) {
      excluded.add(b.blockerId === userId ? b.blockedId : b.blockerId);
    }
    for (const s of recent) {
      excluded.add(s.userAId === userId ? s.userBId : s.userAId);
    }
    excluded.delete(userId);
    return [...excluded];
  }

  private toCandidateDto(u: {
    id: string; username: string; displayName: string; avatar: string | null;
    course: string | null; branch: string | null; currentYear: number | null;
    interests: string[]; bio: string | null;
  }): MatchCandidateDto {
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatar: u.avatar,
      course: u.course,
      branch: u.branch,
      currentYear: u.currentYear,
      interests: u.interests ?? [],
      bio: u.bio,
    };
  }

  private entryToSnapshot(entry: {
    campus: string; activity: string; timePreference: string;
    optionalDetail: string | null; area: string | null;
    latitude: number | null; longitude: number | null;
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
