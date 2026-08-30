import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  CreateCampusEventDto,
  UpdateCampusEventDto,
  CampusEventScope,
} from './dto/campus-event.dto';
import {
  assertCoherentEventTimes,
  sanitizeRegistrationUrl,
} from './campus-event.util';
import { MediaCleanupService } from '../uploads/media-cleanup.service';

// Columns returned for cards/detail. Kept lean to avoid over-fetching.
const EVENT_SELECT = {
  id: true,
  campusId: true,
  title: true,
  description: true,
  posterUrl: true,
  eventDate: true,
  startTime: true,
  endTime: true,
  hostedBy: true,
  venue: true,
  registrationUrl: true,
  status: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  creator: {
    select: { id: true, username: true, displayName: true, avatar: true },
  },
} as const;

@Injectable()
export class CampusEventsService {
  private readonly logger = new Logger(CampusEventsService.name);
  private readonly redis: Redis | null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redisService?: RedisService,
    @Optional() private readonly mediaCleanupService?: MediaCleanupService,
  ) {
    this.redis = this.redisService?.getClient() ?? null;
  }

  // ── Caching (per campus+scope, short TTL, invalidated on any mutation) ────────
  private listCacheKey(
    campusId: string,
    scope: CampusEventScope,
    limit: number,
    cursor?: string,
  ) {
    return `campus-events:${campusId}:${scope}:${limit}:${cursor || 'none'}`;
  }

  private async invalidateCampus(campusId: string) {
    if (!this.redis) return;
    try {
      const keys = await this.redis.keys(`campus-events:${campusId}:*`);
      if (keys.length > 0) await this.redis.del(...keys);
    } catch {
      /* non-fatal */
    }
  }

  // ── Authorization helpers ────────────────────────────────────────────────────
  /** Loads the acting user and asserts they hold the Campus Representative role. */
  private async requireCampusRep(userId: string) {
    if (!userId) throw new ForbiddenException('Authentication required.');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, collegeId: true, isCampusRep: true, role: true },
    });
    if (!user) throw new ForbiddenException('User not found.');
    if (!user.isCampusRep) {
      throw new ForbiddenException(
        'Only Campus Representatives can manage campus events.',
      );
    }
    if (!user.collegeId) {
      throw new ForbiddenException(
        'Campus Representative is not associated with a campus.',
      );
    }
    return user;
  }

  /**
   * Validates a client-supplied poster reference before it is persisted. Accepts
   * either a bare storage key or a `/api/media/<key>` URL, and requires that the
   * referenced Media row exists AND is owned by the acting user — so an event can
   * never be pointed at someone else's (or a non-existent) object. Returns the
   * normalized bare key, or null when no poster is provided.
   */
  private async resolvePosterKey(
    posterUrl: string | undefined | null,
    userId: string,
  ): Promise<string | null> {
    if (posterUrl === undefined || posterUrl === null) return null;
    const key = String(posterUrl).replace('/api/media/', '').trim();
    if (!key) return null; // empty string clears the poster
    if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/.test(key)) {
      throw new BadRequestException('Invalid poster reference.');
    }
    const media = await this.prisma.media.findUnique({
      where: { objectKey: key },
      select: { ownerId: true },
    });
    if (!media || media.ownerId !== userId) {
      throw new BadRequestException(
        'Poster image not found or not owned by you.',
      );
    }
    return key;
  }

  /** Lazily flips PUBLISHED events whose endTime has passed to EXPIRED. Fire-and-forget. */
  private autoExpire(campusId: string) {
    const now = new Date();
    this.prisma.campusEvent
      .updateMany({
        where: {
          campusId,
          status: 'PUBLISHED',
          endTime: { lt: now },
          deletedAt: null,
        },
        data: { status: 'EXPIRED' },
      })
      .catch(() => {});
  }

  // ── Reads ────────────────────────────────────────────────────────────────────
  async listByScope(
    userId: string,
    scope: CampusEventScope,
    opts: { campusId?: string; limit?: number; cursor?: string } = {},
  ) {
    const limit = Math.min(Math.max(opts.limit || 20, 1), 50);

    // Resolve campus: explicit param, else the caller's campus.
    let campusId = opts.campusId;
    if (!campusId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { collegeId: true },
      });
      campusId = user?.collegeId || undefined;
    }
    if (!campusId) return { events: [], nextCursor: undefined };

    const cacheKey = this.listCacheKey(campusId, scope, limit, opts.cursor);
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch {
        /* ignore */
      }
    }

    // Best-effort expiry sweep before reading (never blocks the response).
    this.autoExpire(campusId);

    const now = new Date();
    const baseWhere: any = { campusId, deletedAt: null };
    let where: any;
    let orderBy: any;

    if (scope === 'upcoming') {
      where = { ...baseWhere, status: 'PUBLISHED', startTime: { gt: now } };
      orderBy = [{ startTime: 'asc' }, { id: 'asc' }];
    } else if (scope === 'ongoing') {
      where = {
        ...baseWhere,
        status: 'PUBLISHED',
        startTime: { lte: now },
        endTime: { gte: now },
      };
      orderBy = [{ startTime: 'asc' }, { id: 'asc' }];
    } else {
      // past: already-expired OR published-but-ended (covers the pre-sweep window).
      where = {
        ...baseWhere,
        OR: [
          { status: 'EXPIRED' },
          { status: 'PUBLISHED', endTime: { lt: now } },
        ],
      };
      orderBy = [{ endTime: 'desc' }, { id: 'desc' }];
    }

    // Cursor: opaque `${sortValueISO}|${id}`.
    if (opts.cursor) {
      const [ts, id] = opts.cursor.split('|');
      const date = new Date(ts);
      if (!isNaN(date.getTime()) && id) {
        if (scope === 'past') {
          where.AND = [
            {
              OR: [
                { endTime: { lt: date } },
                { endTime: date, id: { lt: id } },
              ],
            },
          ];
        } else {
          where.AND = [
            {
              OR: [
                { startTime: { gt: date } },
                { startTime: date, id: { gt: id } },
              ],
            },
          ];
        }
      }
    }

    const rows = await this.prisma.campusEvent.findMany({
      where,
      orderBy,
      take: limit + 1,
      select: EVENT_SELECT,
    });

    let nextCursor: string | undefined;
    if (rows.length > limit) {
      const next = rows.pop()!;
      const sortVal = scope === 'past' ? next.endTime : next.startTime;
      nextCursor = `${sortVal.toISOString()}|${next.id}`;
    }

    const response = { events: rows, nextCursor };
    if (this.redis) {
      this.redis.setex(cacheKey, 30, JSON.stringify(response)).catch(() => {});
    }
    return response;
  }

  async getById(id: string, userId: string) {
    const event = await this.prisma.campusEvent.findFirst({
      where: { id, deletedAt: null },
      select: EVENT_SELECT,
    });
    if (!event) throw new NotFoundException('Campus event not found.');

    // Drafts are only visible to their creator (a rep managing their own events).
    if (event.status === 'DRAFT' && event.createdBy !== userId) {
      throw new NotFoundException('Campus event not found.');
    }

    // Reflect time-derived expiry immediately in the single-item view.
    if (event.status === 'PUBLISHED' && event.endTime < new Date()) {
      (event as any).status = 'EXPIRED';
      this.autoExpire(event.campusId);
    }
    return event;
  }

  // ── Mutations (Campus Representative only) ────────────────────────────────────
  async create(userId: string, dto: CreateCampusEventDto) {
    const user = await this.requireCampusRep(userId);

    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);
    const eventDate = new Date(dto.eventDate);
    if (isNaN(eventDate.getTime()))
      throw new BadRequestException('Invalid event date.');
    assertCoherentEventTimes(startTime, endTime);

    const registrationUrl = sanitizeRegistrationUrl(dto.registrationUrl);

    if (!dto.venue || !dto.venue.trim()) {
      throw new BadRequestException('Venue is required.');
    }

    const posterKey = await this.resolvePosterKey(dto.posterUrl, user.id);

    let created: any;
    try {
      created = await this.prisma.campusEvent.create({
        data: {
          campusId: user.collegeId!,
          title: dto.title,
          description: dto.description ?? null,
          posterUrl: posterKey,
          eventDate,
          startTime,
          endTime,
          hostedBy: dto.hostedBy,
          venue: dto.venue.trim(),
          registrationUrl,
          createdBy: user.id,
          status: 'DRAFT',
        },
        select: EVENT_SELECT,
      });
    } catch (err) {
      if (posterKey) {
        this.mediaCleanupService
          ?.discardFailedNewUpload(posterKey, user.id)
          .catch(() => {});
      }
      throw err;
    }

    await this.invalidateCampus(user.collegeId!);
    return created;
  }

  /** Loads an event and asserts the acting user is a rep who owns it. */
  private async requireOwnedEvent(userId: string, eventId: string) {
    const user = await this.requireCampusRep(userId);
    const event = await this.prisma.campusEvent.findFirst({
      where: { id: eventId, deletedAt: null },
      select: {
        id: true,
        campusId: true,
        createdBy: true,
        status: true,
        posterUrl: true,
      },
    });
    if (!event) throw new NotFoundException('Campus event not found.');
    // Ownership + campus-boundary enforcement.
    if (event.createdBy !== user.id || event.campusId !== user.collegeId) {
      throw new ForbiddenException(
        'You can only modify your own campus events.',
      );
    }
    return { user, event };
  }

  async update(userId: string, eventId: string, dto: UpdateCampusEventDto) {
    const { event } = await this.requireOwnedEvent(userId, eventId);

    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.posterUrl !== undefined)
      data.posterUrl = await this.resolvePosterKey(dto.posterUrl, userId);
    if (dto.hostedBy !== undefined) data.hostedBy = dto.hostedBy;
    if (dto.venue !== undefined) {
      if (!dto.venue.trim())
        throw new BadRequestException('Venue cannot be empty.');
      data.venue = dto.venue.trim();
    }
    if (dto.eventDate !== undefined) {
      const d = new Date(dto.eventDate);
      if (isNaN(d.getTime()))
        throw new BadRequestException('Invalid event date.');
      data.eventDate = d;
    }
    if (dto.registrationUrl !== undefined) {
      data.registrationUrl = sanitizeRegistrationUrl(dto.registrationUrl);
    }

    // Time coherence: validate against the effective (new-or-existing) values.
    if (dto.startTime !== undefined || dto.endTime !== undefined) {
      const existing = await this.prisma.campusEvent.findUnique({
        where: { id: eventId },
        select: { startTime: true, endTime: true },
      });
      const startTime =
        dto.startTime !== undefined
          ? new Date(dto.startTime)
          : existing!.startTime;
      const endTime =
        dto.endTime !== undefined ? new Date(dto.endTime) : existing!.endTime;
      assertCoherentEventTimes(startTime, endTime);
      data.startTime = startTime;
      data.endTime = endTime;
    }

    let updated: any;
    try {
      updated = await this.prisma.campusEvent.update({
        where: { id: eventId },
        data,
        select: EVENT_SELECT,
      });
    } catch (err) {
      if (data.posterUrl) {
        this.mediaCleanupService
          ?.discardFailedNewUpload(data.posterUrl, userId)
          .catch(() => {});
      }
      throw err;
    }

    this.mediaCleanupService?.replaceEntityMedia({
      entityType: 'CAMPUS_EVENT_POSTER',
      entityId: eventId,
      previous: event.posterUrl,
      next: updated.posterUrl,
      ownerId: userId,
      submitted: data.posterUrl !== undefined,
    });

    await this.invalidateCampus(event.campusId);
    return updated;
  }

  async publish(userId: string, eventId: string) {
    const { event } = await this.requireOwnedEvent(userId, eventId);

    if (event.status === 'PUBLISHED') return this.getById(eventId, userId);
    if (event.status === 'EXPIRED') {
      throw new BadRequestException('Expired events cannot be published.');
    }

    // Guard against publishing an event that is already over.
    const full = await this.prisma.campusEvent.findUnique({
      where: { id: eventId },
      select: { endTime: true },
    });
    const status = full && full.endTime < new Date() ? 'EXPIRED' : 'PUBLISHED';

    const updated = await this.prisma.campusEvent.update({
      where: { id: eventId },
      data: { status },
      select: EVENT_SELECT,
    });

    await this.invalidateCampus(event.campusId);
    return updated;
  }

  async remove(userId: string, eventId: string) {
    const { event } = await this.requireOwnedEvent(userId, eventId);
    await this.prisma.campusEvent.update({
      where: { id: eventId },
      data: { deletedAt: new Date() },
    });
    if (event.posterUrl && this.mediaCleanupService) {
      this.mediaCleanupService.queueMediaDeletion([event.posterUrl]);
    }
    await this.invalidateCampus(event.campusId);
    return { success: true };
  }

  /** Events created by the acting representative (any status) — for their management view. */
  async listMine(userId: string) {
    const user = await this.requireCampusRep(userId);
    const events = await this.prisma.campusEvent.findMany({
      where: { createdBy: user.id, deletedAt: null },
      orderBy: [{ startTime: 'desc' }],
      take: 100,
      select: EVENT_SELECT,
    });
    return { events };
  }
}
