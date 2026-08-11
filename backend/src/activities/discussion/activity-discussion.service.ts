import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventService } from '../../events/domain-event.service';

const MAX_MESSAGE_LENGTH = 2000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Lightweight, activity-scoped discussion. Unlike the old activity group chat,
 * there are no participants, roles, membership or conversation rows — anyone who
 * can view the activity can read and post. Messages are keyed directly by
 * activityId and retrieved newest-first via the
 * ([activityId, createdAt desc, id desc]) index for fast cursor pagination.
 */
@Injectable()
export class ActivityDiscussionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly domainEventService: DomainEventService,
  ) {}

  private static readonly messageSelect = {
    id: true,
    text: true,
    createdAt: true,
    userId: true,
    user: { select: { id: true, username: true, displayName: true, avatar: true } },
  } as const;

  private format(m: any, activityId: string) {
    return {
      id: m.id,
      activityId,
      text: m.text,
      createdAt: m.createdAt,
      userId: m.userId,
      user: {
        id: m.user?.id || m.userId,
        username: m.user?.username || '',
        displayName: m.user?.displayName || m.user?.username || 'Member',
        avatar: m.user?.avatar || null,
      },
    };
  }

  private async assertActivityExists(activityId: string) {
    const activity = await this.prisma.crewActivity.findFirst({
      where: { id: activityId, deletedAt: null },
      select: { id: true },
    });
    if (!activity) throw new NotFoundException('Activity not found');
  }

  /**
   * Returns a page of messages in chronological order (oldest → newest) so the
   * client can render/prepend directly. `nextCursor` is the id of the oldest
   * message returned; pass it back as `before` to load older messages.
   */
  async getMessages(activityId: string, before?: string, limit: number = DEFAULT_PAGE_SIZE) {
    const take = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);

    let cursorFilter: any = {};
    if (before) {
      const cursorMsg = await this.prisma.activityDiscussionMessage.findUnique({
        where: { id: before },
        select: { createdAt: true, id: true },
      });
      if (cursorMsg) {
        cursorFilter = {
          OR: [
            { createdAt: { lt: cursorMsg.createdAt } },
            { createdAt: cursorMsg.createdAt, id: { lt: cursorMsg.id } },
          ],
        };
      }
    }

    const rows = await this.prisma.activityDiscussionMessage.findMany({
      where: { activityId, ...cursorFilter },
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
      throw new BadRequestException(`Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`);
    }

    await this.assertActivityExists(activityId);

    const created = await this.prisma.activityDiscussionMessage.create({
      data: { activityId, userId, text: trimmed },
      select: ActivityDiscussionService.messageSelect,
    });

    const message = this.format(created, activityId);

    // Fan out to everyone currently viewing the activity (they joined the
    // `activity_<id>` socket room). Room-only broadcast — no participant set.
    this.domainEventService.emit('activity_discussion.created', { activityId, message });

    return message;
  }
}
