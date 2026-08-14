import { Injectable, Logger } from '@nestjs/common';
import { MentionSource, NotificationEntityType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { MentionDto } from '../common/dto/mention.dto';

export interface SanitizedMention {
  userId: string;
  username: string;
  start: number;
  end: number;
}

export interface MentionActor {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
}

/**
 * Central authority for @mention handling across posts, comments, and messages.
 * Two responsibilities, kept separate on purpose:
 *   1. sanitize()          — turn an untrusted client claim into a provably real mention
 *   2. persistAndNotify()  — index it for "mentions of me" lookups + fire one notification
 */
@Injectable()
export class MentionsService {
  private readonly logger = new Logger('MentionsService');

  // Hard ceiling on mentions processed per post/comment/message. Prevents a
  // single oversized payload from fanning out into hundreds of notification
  // writes — legitimate use never approaches this.
  private static readonly MAX_MENTIONS_PER_ITEM = 25;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationFactory: NotificationFactory,
  ) {}

  /**
   * Re-derives the true mention set from first principles instead of trusting
   * the client payload. A mention only survives if:
   *   - its [start, end) span is in-bounds for the actual saved text
   *   - text.slice(start, end) is exactly "@username" (case-insensitive)
   *   - it isn't a self-mention or a duplicate userId
   *   - the userId resolves to a real, non-deleted account (one batched query)
   * Without this, a malicious client could claim arbitrary start/end/userId
   * triples and spam-notify any user regardless of what the post actually says.
   */
  async sanitize(
    text: string,
    rawMentions: MentionDto[] | null | undefined,
    actorId: string,
  ): Promise<SanitizedMention[]> {
    if (!text || !Array.isArray(rawMentions) || rawMentions.length === 0) return [];

    const seenUserIds = new Set<string>();
    const structurallyValid: MentionDto[] = [];

    // Scan at most 4x the cap so a huge garbage payload can't force an
    // unbounded loop before we even get to the per-item cap.
    for (const m of rawMentions.slice(0, MentionsService.MAX_MENTIONS_PER_ITEM * 4)) {
      if (!m || typeof m.userId !== 'string' || typeof m.username !== 'string') continue;
      if (typeof m.start !== 'number' || typeof m.end !== 'number') continue;
      if (!Number.isInteger(m.start) || !Number.isInteger(m.end)) continue;
      if (m.start < 0 || m.end <= m.start || m.end > text.length) continue;
      if (m.userId === actorId) continue; // no self-mention notifications
      if (seenUserIds.has(m.userId)) continue; // one notification per user per item

      const claimed = text.slice(m.start, m.end);
      if (claimed.toLowerCase() !== `@${m.username}`.toLowerCase()) continue;

      seenUserIds.add(m.userId);
      structurallyValid.push(m);
      if (structurallyValid.length >= MentionsService.MAX_MENTIONS_PER_ITEM) break;
    }

    if (structurallyValid.length === 0) return [];

    // One batched existence check for the whole set — never N+1.
    const candidateIds = structurallyValid.map((m) => m.userId);
    const realUsers = await this.prisma.user.findMany({
      where: { id: { in: candidateIds }, deletedAt: null },
      select: { id: true, username: true },
    });
    const realUserMap = new Map(realUsers.map((u) => [u.id, u.username]));

    return structurallyValid
      .filter((m) => realUserMap.has(m.userId))
      // Store the DB's current username, not the client's stale snapshot —
      // keeps rendering correct even if the mentioned user renamed since.
      .map((m) => ({
        userId: m.userId,
        username: realUserMap.get(m.userId) as string,
        start: m.start,
        end: m.end,
      }));
  }

  /**
   * Indexes each sanitized mention (idempotent — duplicate calls no-op via
   * the unique constraint) and fires one MENTION notification per uniquely
   * tagged user. Fire-and-forget by contract: a notification failure must
   * never roll back the post/comment/message that already committed, so every
   * failure is caught, logged, and swallowed here rather than propagated.
   */
  async persistAndNotify(params: {
    mentions: SanitizedMention[];
    sourceType: MentionSource;
    sourceId: string;
    actor: MentionActor;
    entityType: NotificationEntityType;
    entityId: string;
    contextText: string;
    extraMetadata?: Record<string, any>;
  }): Promise<void> {
    const { mentions, sourceType, sourceId, actor, entityType, entityId, contextText, extraMetadata } = params;
    if (!mentions || mentions.length === 0) return;

    try {
      await this.prisma.mention.createMany({
        data: mentions.map((m) => ({
          userId: m.userId,
          sourceType,
          sourceId,
          actorId: actor.id,
        })),
        skipDuplicates: true,
      });
    } catch (err) {
      this.logger.error(`Failed to persist Mention index rows for ${sourceType}:${sourceId}`, err as Error);
    }

    const results = await Promise.allSettled(
      mentions.map((m) => {
        const dto = this.notificationFactory.createMention(
          actor,
          m.userId,
          entityType,
          entityId,
          contextText,
          extraMetadata,
        );
        return this.notificationsService.createNotification(dto);
      }),
    );

    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        this.logger.warn(
          `Failed to deliver mention notification user=${mentions[i].userId} source=${sourceType}:${sourceId}: ${r.reason}`,
        );
      }
    });
  }
}
