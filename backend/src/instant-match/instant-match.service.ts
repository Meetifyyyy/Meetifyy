import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MessagesService } from '../messages/messages.service';
import { computeMatchScore } from './instant-match.scoring';

// Accept timers mirror matchConstants.js
const ACCEPT_TIMER_MAP: Record<string, number> = {
  study: 30, coding: 30, sports: 60, coffee: 30,
  food: 30, gaming: 30, walk: 60, movie: 30,
  event: 30, chat: 30, library: 30, other: 30,
};
const ACCEPT_TIMER_TODAY = 90;
const QUEUE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface JoinQueueDto {
  userId: string;
  campus: string;
  activity: string;
  timePreference: string;
  optionalDetail?: string;
  location?: {
    area?: string;
    gps?: { latitude: number; longitude: number };
  };
}

export interface MatchFoundPayload {
  matchId: string;
  candidate: {
    id: string;
    username: string;
    displayName: string;
    avatar: string | null;
    major: string | null;
    interests: string[];
    bio: string | null;
  };
  activity: string;
  area: string | null;
  timer: number;
}

export interface QueueStats {
  count: number;
  avgWaitSecs: number;
}

// Injected lazily to avoid circular dependency
export let realtimeGatewayRef: {
  emitMatchFound: (userId: string, p: MatchFoundPayload) => void;
  emitMatchAccepted: (userId: string, p: { chatId: string }) => void;
  emitMatchDeclined: (userId: string, p: { reason: string }) => void;
  emitSearchResumed: (userId: string) => void;
  emitQueueStats: (userId: string, stats: QueueStats) => void;
} | null = null;

export function setRealtimeGatewayRef(ref: typeof realtimeGatewayRef) {
  realtimeGatewayRef = ref;
}

@Injectable()
export class InstantMatchService {
  private readonly logger = new Logger(InstantMatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messagesService: MessagesService,
  ) {}

  // ─── Accept timer ────────────────────────────────────────────────────────────

  private getAcceptTimer(activity: string, timePreference: string): number {
    if (timePreference === 'today') return ACCEPT_TIMER_TODAY;
    const outdoor = ['sports', 'walk'];
    return outdoor.includes(activity) ? 60 : (ACCEPT_TIMER_MAP[activity] ?? 30);
  }

  // ─── Join Queue ───────────────────────────────────────────────────────────────

  async joinQueue(dto: JoinQueueDto): Promise<void> {
    const expiresAt = new Date(Date.now() + QUEUE_TTL_MS);

    await this.prisma.matchQueueEntry.upsert({
      where: { userId: dto.userId },
      create: {
        userId: dto.userId,
        campus: dto.campus,
        activity: dto.activity,
        timePreference: dto.timePreference,
        optionalDetail: dto.optionalDetail ?? null,
        area: dto.location?.area ?? null,
        latitude: dto.location?.gps?.latitude ?? null,
        longitude: dto.location?.gps?.longitude ?? null,
        expiresAt,
      },
      update: {
        campus: dto.campus,
        activity: dto.activity,
        timePreference: dto.timePreference,
        optionalDetail: dto.optionalDetail ?? null,
        area: dto.location?.area ?? null,
        latitude: dto.location?.gps?.latitude ?? null,
        longitude: dto.location?.gps?.longitude ?? null,
        joinedAt: new Date(),
        expiresAt,
      },
    });

    this.logger.log(`User ${dto.userId} joined queue for [${dto.activity}] on [${dto.campus}]`);

    // Push queue stats to the joining user immediately
    const stats = await this.getQueueStats(dto.campus, dto.activity, dto.timePreference);
    realtimeGatewayRef?.emitQueueStats(dto.userId, stats);

    // Try to find a match
    await this.tryMatch(dto.userId);
  }

  // ─── Cancel Queue ─────────────────────────────────────────────────────────────

  async cancelQueue(userId: string): Promise<void> {
    await this.prisma.matchQueueEntry.deleteMany({ where: { userId } });
    this.logger.log(`User ${userId} left the queue`);
  }

  // ─── Try Match ────────────────────────────────────────────────────────────────

  async tryMatch(userId: string): Promise<void> {
    const myEntry = await this.prisma.matchQueueEntry.findUnique({ where: { userId } });
    if (!myEntry) return;

    // Find all candidates on same campus + activity + timePreference (excluding self)
    const candidates = await this.prisma.matchQueueEntry.findMany({
      where: {
        campus: myEntry.campus,
        activity: myEntry.activity,
        timePreference: myEntry.timePreference,
        userId: { not: userId },
        expiresAt: { gt: new Date() },
      },
      include: {
        user: {
          select: { id: true, username: true, displayName: true, avatar: true, major: true, interests: true, bio: true },
        },
      },
    });

    if (candidates.length === 0) return;

    // Score and pick best candidate
    const myContext = {
      area: myEntry.area,
      optionalDetail: myEntry.optionalDetail,
      latitude: myEntry.latitude,
      longitude: myEntry.longitude,
      interests: [] as string[], // profile interests added per-user below
    };

    let bestScore = -1;
    let bestCandidate: typeof candidates[0] | null = null;

    // Fetch my interests for scoring
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { interests: true },
    });
    myContext.interests = me?.interests ?? [];

    for (const candidate of candidates) {
      const candidateContext = {
        area: candidate.area,
        optionalDetail: candidate.optionalDetail,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        interests: candidate.user.interests ?? [],
      };
      const score = computeMatchScore(myContext, candidateContext);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    if (!bestCandidate) return;

    // Remove both from queue
    await this.prisma.matchQueueEntry.deleteMany({
      where: { userId: { in: [userId, bestCandidate.userId] } },
    });

    const timer = this.getAcceptTimer(myEntry.activity, myEntry.timePreference);
    const matchExpiresAt = new Date(Date.now() + timer * 1000 + 5000); // +5s buffer

    // Create match session
    const session = await this.prisma.matchSession.create({
      data: {
        userAId: userId,
        userBId: bestCandidate.userId,
        activity: myEntry.activity,
        expiresAt: matchExpiresAt,
      },
    });

    const area = myEntry.area ?? bestCandidate.area ?? null;

    // Emit match:found to both users
    const buildPayload = (candidate: typeof bestCandidate): MatchFoundPayload => ({
      matchId: session.id,
      candidate: {
        id: candidate!.user.id,
        username: candidate!.user.username,
        displayName: candidate!.user.displayName,
        avatar: candidate!.user.avatar,
        major: candidate!.user.major,
        interests: candidate!.user.interests,
        bio: candidate!.user.bio,
      },
      activity: myEntry.activity,
      area,
      timer,
    });

    // For userA (me), candidate is bestCandidate
    const meUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, displayName: true, avatar: true, major: true, interests: true, bio: true },
    });

    realtimeGatewayRef?.emitMatchFound(userId, buildPayload(bestCandidate));
    realtimeGatewayRef?.emitMatchFound(bestCandidate.userId, {
      matchId: session.id,
      candidate: {
        id: meUser!.id,
        username: meUser!.username,
        displayName: meUser!.displayName,
        avatar: meUser!.avatar,
        major: meUser!.major,
        interests: meUser!.interests,
        bio: meUser!.bio,
      },
      activity: myEntry.activity,
      area,
      timer,
    });

    this.logger.log(`Match created: ${session.id} between ${userId} and ${bestCandidate.userId}`);
  }

  // ─── Respond to Match ─────────────────────────────────────────────────────────

  async respondToMatch(userId: string, matchId: string, action: 'accept' | 'decline'): Promise<void> {
    const session = await this.prisma.matchSession.findUnique({ where: { id: matchId } });
    if (!session) throw new NotFoundException('Match session not found');
    if (session.status !== 'PENDING') throw new BadRequestException('Match is no longer active');

    const isUserA = session.userAId === userId;
    const isUserB = session.userBId === userId;
    if (!isUserA && !isUserB) throw new BadRequestException('Not part of this match');

    const otherUserId = isUserA ? session.userBId : session.userAId;

    if (action === 'decline') {
      await this.prisma.matchSession.update({
        where: { id: matchId },
        data: { status: 'DECLINED' },
      });

      realtimeGatewayRef?.emitMatchDeclined(userId, { reason: 'You declined the match' });
      realtimeGatewayRef?.emitMatchDeclined(otherUserId, { reason: 'The other student was unavailable' });

      // Re-queue the other user so they resume searching
      const otherEntry = await this.prisma.matchQueueEntry.findUnique({ where: { userId: otherUserId } });
      if (!otherEntry) {
        // They were removed from queue when matched; re-add them
        realtimeGatewayRef?.emitSearchResumed(otherUserId);
        // We don't automatically re-queue since we don't have their original request stored
        // The frontend will call queue:join again on search:resumed
      }
      return;
    }

    // action === 'accept'
    const updatedSession = await this.prisma.matchSession.update({
      where: { id: matchId },
      data: isUserA ? { aAccepted: true } : { bAccepted: true },
    });

    const bothAccepted = updatedSession.aAccepted && updatedSession.bAccepted;

    if (bothAccepted) {
      // Create DM conversation
      const conv = await this.messagesService.createInstantMatchConversation(
        session.userAId,
        session.userBId,
        session.activity,
      );

      await this.prisma.matchSession.update({
        where: { id: matchId },
        data: { status: 'ACCEPTED', conversationId: conv.id },
      });

      realtimeGatewayRef?.emitMatchAccepted(session.userAId, { chatId: conv.id });
      realtimeGatewayRef?.emitMatchAccepted(session.userBId, { chatId: conv.id });

      this.logger.log(`Match ${matchId} accepted — conversation ${conv.id} created`);
    } else {
      this.logger.log(`Match ${matchId}: one side accepted, waiting for other...`);
    }
  }

  // ─── Queue Stats ──────────────────────────────────────────────────────────────

  async getQueueStats(campus: string, activity: string, timePreference: string): Promise<QueueStats> {
    const count = await this.prisma.matchQueueEntry.count({
      where: {
        campus,
        activity,
        timePreference,
        expiresAt: { gt: new Date() },
      },
    });

    return { count, avgWaitSecs: 120 };
  }

  // ─── Expire Stale (called by BullMQ processor) ────────────────────────────────

  async expireStale(): Promise<void> {
    const now = new Date();

    // Expire queue entries
    await this.prisma.matchQueueEntry.deleteMany({ where: { expiresAt: { lt: now } } });

    // Expire pending match sessions
    const expiredSessions = await this.prisma.matchSession.findMany({
      where: { status: 'PENDING', expiresAt: { lt: now } },
    });

    for (const session of expiredSessions) {
      await this.prisma.matchSession.update({
        where: { id: session.id },
        data: { status: 'EXPIRED' },
      });
      realtimeGatewayRef?.emitMatchDeclined(session.userAId, { reason: 'Match timed out' });
      realtimeGatewayRef?.emitMatchDeclined(session.userBId, { reason: 'Match timed out' });
      realtimeGatewayRef?.emitSearchResumed(session.userAId);
      realtimeGatewayRef?.emitSearchResumed(session.userBId);
    }

    if (expiredSessions.length > 0) {
      this.logger.log(`Expired ${expiredSessions.length} stale match session(s)`);
    }
  }
}
