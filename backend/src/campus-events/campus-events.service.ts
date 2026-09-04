import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { Prisma } from '@prisma/client';
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
import { parseKeysetCursor } from '../common/pagination.util';
import type { UserIdentityLike } from '../common/users/deleted-user';
import {
  isUnavailableUser,
  DELETED_USER_DISPLAY_NAME,
  DELETED_USER_USERNAME,
} from '../common/users/deleted-user';

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
    select: {
      id: true,
      username: true,
      displayName: true,
      avatar: true,
      // Required by `presentEventCreator`. A campus rep who deletes their
      // account leaves their published events in place — students have them in
      // their calendars — so the event outlives the identity and the identity
      // has to be substituted rather than dropped with it.
      accountStatus: true,
      deletedAt: true,
    },
  },
} as const;

/**
 * The narrower projection the discovery lists use.
 *
 * A card paints a poster, a title, a date and a host. `EVENT_SELECT` above also
 * carries the full `creator` relation, `campusId`, `createdBy`, `eventDate`,
 * `createdAt` and `updatedAt` — none of which is read anywhere in the campus
 * features, and together roughly a quarter of each row on the wire. Three
 * scopes are requested when the Events page opens, at up to 20 rows each, so
 * that quarter is paid three times before anything is painted.
 *
 * `description`, `venue`, `registrationUrl` and `endTime` stay: a campus rep's
 * Edit action opens the form directly from the list row, and the form fills
 * every one of those fields from it. Dropping them here would trade a payload
 * win for a broken edit dialog.
 */
const EVENT_LIST_SELECT = {
  id: true,
  title: true,
  description: true,
  posterUrl: true,
  startTime: true,
  endTime: true,
  hostedBy: true,
  venue: true,
  registrationUrl: true,
  status: true,
} as const;

/**
 * Substitutes the tombstone for a deleted event creator.
 *
 * Applied on the two paths another student can read — discovery and the single
 * event — rather than on create/update/publish/listMine, where the creator is
 * by definition the live caller. Applied BEFORE the discovery response is
 * cached, so a 30s cache entry cannot hold the real identity.
 */
function presentEventCreator<T extends { creator?: unknown }>(event: T): T {
  const creator = event.creator as UserIdentityLike | null | undefined;
  if (!creator || !isUnavailableUser(creator)) return event;
  return {
    ...event,
    creator: {
      id: creator.id,
      username: DELETED_USER_USERNAME,
      displayName: DELETED_USER_DISPLAY_NAME,
      avatar: null,
      isDeleted: true,
      profileAvailable: false,
    },
  };
}

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

  /** Set of live cache keys for one campus, so invalidation never scans. */
  private listTagKey(campusId: string) {
    return `campus-events:tag:${campusId}`;
  }

  /**
   * Register a cache key against its campus tag-Set.
   *
   * The alternative — and what this used to do at invalidation time — is
   * `KEYS campus-events:<campus>:*`. `KEYS` is O(total keyspace) and Redis is
   * single-threaded, so it stalls *every other client* for the duration: in
   * this deployment that is the session store and the job queues, not just
   * this cache. It ran on every event create, update, publish and delete.
   *
   * The same tag-Set pattern already exists in CommunitiesService; this brings
   * campus events in line with it.
   */
  private registerListCacheKey(campusId: string, redisKey: string) {
    if (!this.redis) return;
    const tag = this.listTagKey(campusId);
    this.redis.sadd(tag, redisKey).catch(() => {});
    // Safety TTL well above the 30s entry TTL, so an abandoned tag cannot leak.
    this.redis.expire(tag, 300).catch(() => {});
  }

  private async invalidateCampus(campusId: string) {
    if (!this.redis) return;
    try {
      const tag = this.listTagKey(campusId);
      const keys = await this.redis.smembers(tag);
      if (keys.length > 0) await this.redis.del(...keys);
      await this.redis.del(tag);
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
    //
    // Parsed through the shared helper, which also settles the TYPE of the
    // value. `cursor` is declared `string`, but Express turns
    // `?cursor=a&cursor=b` into an array, so calling `.split` on it directly
    // threw `TypeError: split is not a function` — a 500 from a URL anyone
    // could construct. A malformed or wrong-typed cursor now falls back to the
    // first page, which is what a client mistake should cost.
    const cursor = parseKeysetCursor(opts.cursor);
    if (cursor) {
      const { date, id } = cursor;
      if (scope === 'past') {
        where.AND = [
          {
            OR: [{ endTime: { lt: date } }, { endTime: date, id: { lt: id } }],
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

    const rows = await this.prisma.campusEvent.findMany({
      where,
      orderBy,
      take: limit + 1,
      select: EVENT_LIST_SELECT,
    });

    /**
     * The cursor must name the last row this page RETURNS, not the extra row
     * fetched to detect that another page exists.
     *
     * It used to name the extra row — `rows.pop()` — and then drop it. Because
     * the cursor comparison is strict (`>` for upcoming/ongoing, `<` for past),
     * the next page started *after* that row, so the popped event was never
     * returned by any page: one event silently vanished at every page boundary.
     * Invisible below 20 events per scope, which is why it survived.
     *
     * `getDirectory` already did this correctly; this brings the event scopes
     * in line with it.
     */
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];
    let nextCursor: string | undefined;
    if (hasMore && last) {
      const sortVal = scope === 'past' ? last.endTime : last.startTime;
      nextCursor = `${sortVal.toISOString()}|${last.id}`;
    }

    // No `presentEventCreator` here: the list no longer selects `creator`, so
    // there is no identity to substitute. The single-event read still does.
    const response = { events: pageRows, nextCursor };
    if (this.redis) {
      this.redis.setex(cacheKey, 30, JSON.stringify(response)).catch(() => {});
      this.registerListCacheKey(campusId, cacheKey);
    }
    return response;
  }

  async getById(id: string, userId: string) {
    const found = await this.prisma.campusEvent.findFirst({
      where: { id, deletedAt: null },
      select: EVENT_SELECT,
    });
    if (!found) throw new NotFoundException('Campus event not found.');
    const event = presentEventCreator(found);

    /**
     * Campus boundary.
     *
     * Discovery is scoped to the caller's college, but this read was not: any
     * verified account holding an event id could fetch another college's event
     * in full — title, description, venue, organiser and the creator's identity
     * — simply by asking for it. The id is a UUID, so it was not trivially
     * enumerable, but "hard to guess" is not an access control, and event ids
     * travel in shared links.
     *
     * 404 rather than 403 on purpose: a 403 would confirm that an event with
     * this id exists on some other campus.
     */
    const viewer = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { collegeId: true },
    });
    if (!viewer?.collegeId || viewer.collegeId !== event.campusId) {
      throw new NotFoundException('Campus event not found.');
    }

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
    const idempotencyKey = dto.idempotencyKey ?? null;

    /**
     * Fast path for an obvious retry: the client resent a key we have already
     * committed. Returning the existing event is what makes the endpoint safe
     * to retry after a timeout.
     *
     * This read alone is not the guarantee — two simultaneous requests can both
     * miss it — which is why the unique index is the real mechanism and the
     * P2002 branch below is the one that actually closes the race.
     */
    if (idempotencyKey) {
      const existing = await this.prisma.campusEvent.findFirst({
        where: { createdBy: user.id, idempotencyKey, deletedAt: null },
        select: EVENT_SELECT,
      });
      if (existing) {
        return dto.publish && existing.status === 'DRAFT'
          ? this.publish(user.id, existing.id)
          : existing;
      }
    }

    // Publishing at creation time keeps the event out of the half-created state
    // the old create-then-publish pair could strand it in.
    const initialStatus =
      dto.publish && endTime >= new Date() ? 'PUBLISHED' : 'DRAFT';

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
          status: initialStatus,
          idempotencyKey,
        },
        select: EVENT_SELECT,
      });
    } catch (err: unknown) {
      // P2002 on (createdBy, idempotencyKey): a concurrent request with the
      // same key won the insert. That is a duplicate submission, not an error —
      // hand back the event that did get created. The poster is deliberately
      // NOT discarded here: the winning row references the same key.
      const isUniqueViolation =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002';
      if (isUniqueViolation && idempotencyKey) {
        const winner = await this.prisma.campusEvent.findFirst({
          where: { createdBy: user.id, idempotencyKey },
          select: EVENT_SELECT,
        });
        if (winner) {
          this.logger.log(
            `Idempotent create collapsed to existing event ${winner.id} (rep ${user.id})`,
          );
          return winner;
        }
      }
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
        // Carried so `update` and `publish` do not each issue a second
        // findUnique for the same row they were just handed.
        startTime: true,
        endTime: true,
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

    // Time coherence: validate against the effective (new-or-existing) values,
    // reusing the row `requireOwnedEvent` already loaded.
    if (dto.startTime !== undefined || dto.endTime !== undefined) {
      const startTime =
        dto.startTime !== undefined ? new Date(dto.startTime) : event.startTime;
      const endTime =
        dto.endTime !== undefined ? new Date(dto.endTime) : event.endTime;
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

    // Guard against publishing an event that is already over — again from the
    // row already in hand rather than a fresh read.
    const status = event.endTime < new Date() ? 'EXPIRED' : 'PUBLISHED';

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

  /**
   * Events created by the acting representative (any status) — their management
   * view.
   *
   * Keyset-paginated on the same `(startTime desc, id desc)` the list is sorted
   * by, matching `listByScope`'s cursor format. It previously returned a flat
   * `take: 100` with no cursor: bounded, so never a runaway query, but a rep
   * who had run more than a hundred events simply could not reach the older
   * ones — they were silently absent with nothing to indicate more existed.
   *
   * `EVENT_LIST_SELECT` rather than the full `EVENT_SELECT`: this is a list of
   * cards, and the `creator` relation it would otherwise join is by definition
   * the caller on every row.
   *
   * The response keeps its `{ events }` shape and gains `nextCursor`, so the
   * existing client hook is unaffected.
   */
  async listMine(
    userId: string,
    opts: { limit?: number; cursor?: string } = {},
  ) {
    const user = await this.requireCampusRep(userId);
    const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 50);

    const where: Prisma.CampusEventWhereInput = {
      createdBy: user.id,
      deletedAt: null,
    };
    // Same parse as listByScope — see the note there on why the type of this
    // value cannot be taken on trust.
    const cursor = parseKeysetCursor(opts.cursor);
    if (cursor) {
      where.OR = [
        { startTime: { lt: cursor.date } },
        { startTime: cursor.date, id: { lt: cursor.id } },
      ];
    }

    const rows = await this.prisma.campusEvent.findMany({
      where,
      orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: EVENT_LIST_SELECT,
    });

    // Cursor from the last returned row, not the peeked one — see listByScope.
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && last
        ? `${last.startTime.toISOString()}|${last.id}`
        : undefined;
    return { events: pageRows, nextCursor };
  }
}
