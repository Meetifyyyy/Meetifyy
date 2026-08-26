import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  EmailDeliveryStatus,
  Prisma,
  SupportAuthorType,
  SupportStatus,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/email.service';
import { htmlToPlainText, sanitizeReplyHtml } from '../../common/utils/sanitize-html.util';
import { TICKET_NUMBER_PATTERN } from '../../support/utils/ticket-number.util';
import {
  AddInternalNoteDto,
  AssignTicketDto,
  ListSupportTicketsDto,
  SendReplyDto,
  UpdateTicketPriorityDto,
  UpdateTicketStatusDto,
} from './dto/admin-support.dto';

/** Author/admin fields shared by the list and detail queries. */
const ADMIN_SELECT = { id: true, name: true, email: true } as const;
const USER_SELECT = { id: true, username: true, displayName: true, avatar: true, email: true } as const;

/**
 * Timestamps that must move with a status change.
 *
 * Kept as a single mapping rather than a chain of ifs because status is set
 * from three different places (the status endpoint, a reply, a reopen) and all
 * three have to agree about what "resolved" does to `resolvedAt`.
 */
// Typed as the two bare columns rather than as SupportTicketUpdateInput: the
// checked variant is mutually exclusive with the unchecked one, so spreading it
// alongside a scalar foreign key like `assignedAdminId` makes Prisma reject the
// whole object.
function timestampsForStatus(status: SupportStatus): { resolvedAt?: Date | null; closedAt?: Date | null } {
  switch (status) {
    case SupportStatus.RESOLVED:
      return { resolvedAt: new Date(), closedAt: null };
    case SupportStatus.CLOSED:
      return { closedAt: new Date() };
    // Reopening clears both, so a ticket that comes back does not still claim
    // to have been resolved at some point in the past.
    case SupportStatus.OPEN:
    case SupportStatus.IN_PROGRESS:
    case SupportStatus.WAITING_FOR_USER:
      return { resolvedAt: null, closedAt: null };
  }
}

@Injectable()
export class AdminSupportService {
  private readonly logger = new Logger(AdminSupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  // ── Queue ────────────────────────────────────────────────────────────────

  async listTickets(query: ListSupportTicketsDto) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));

    const where: Prisma.SupportTicketWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.category) where.category = query.category;
    if (query.priority) where.priority = query.priority;

    // "unassigned" is a real filter - it is the queue an admin picks work from
    // - and is not expressible as simply omitting the parameter.
    if (query.assignedAdminId === 'unassigned') where.assignedAdminId = null;
    else if (query.assignedAdminId) where.assignedAdminId = query.assignedAdminId;

    const search = query.search?.trim();
    if (search) {
      const insensitive = Prisma.QueryMode.insensitive;
      // A request ID is the one search an admin does from a user's email, so
      // it is matched exactly and case-insensitively rather than as a
      // substring - "MFT-8K4P2Q" should not also return unrelated subjects
      // that happen to contain the string.
      where.OR = TICKET_NUMBER_PATTERN.test(search.toUpperCase())
        ? [{ ticketNumber: search.toUpperCase() }]
        : [
            { ticketNumber: { contains: search, mode: insensitive } },
            { email: { contains: search, mode: insensitive } },
            { subject: { contains: search, mode: insensitive } },
            { name: { contains: search, mode: insensitive } },
            { user: { username: { contains: search, mode: insensitive } } },
          ];
    }

    const [total, tickets] = await Promise.all([
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: this.orderBy(query.sort),
        select: {
          id: true,
          ticketNumber: true,
          email: true,
          name: true,
          category: true,
          subject: true,
          status: true,
          priority: true,
          emailStatus: true,
          createdAt: true,
          updatedAt: true,
          resolvedAt: true,
          attachments: true,
          user: { select: USER_SELECT },
          assignedAdmin: { select: ADMIN_SELECT },
          // The list shows a reply count, which must exclude internal notes -
          // otherwise a ticket nobody has answered looks answered.
          _count: { select: { messages: { where: { isInternal: false } } } },
        },
      }),
    ]);

    return {
      data: tickets,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  private orderBy(sort: ListSupportTicketsDto['sort']): Prisma.SupportTicketOrderByWithRelationInput[] {
    switch (sort) {
      case 'oldest':
        return [{ createdAt: 'asc' }];
      case 'updated':
        return [{ updatedAt: 'desc' }];
      case 'priority':
        // Enum order is LOW, NORMAL, HIGH, URGENT, so descending puts URGENT
        // first - which is the only useful reading of "sort by priority".
        return [{ priority: 'desc' }, { createdAt: 'desc' }];
      default:
        return [{ createdAt: 'desc' }];
    }
  }

  /** Counts for the queue's filter chips, in one round trip. */
  async getQueueStats() {
    const [byStatus, byPriority, unassigned, failedEmails] = await Promise.all([
      this.prisma.supportTicket.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.supportTicket.groupBy({ by: ['priority'], _count: { _all: true } }),
      this.prisma.supportTicket.count({
        where: { assignedAdminId: null, status: { notIn: [SupportStatus.RESOLVED, SupportStatus.CLOSED] } },
      }),
      // Surfaced as a chip because a failed confirmation is invisible
      // otherwise: the user believes support has their request and support has
      // no reason to look at it.
      this.prisma.supportTicket.count({ where: { emailStatus: EmailDeliveryStatus.FAILED } }),
    ]);

    return {
      byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
      byPriority: Object.fromEntries(byPriority.map((row) => [row.priority, row._count._all])),
      unassigned,
      failedEmails,
    };
  }

  async getTicketById(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        user: { select: USER_SELECT },
        assignedAdmin: { select: ADMIN_SELECT },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!ticket) throw new NotFoundException('Ticket not found');

    // The admin authors are resolved in one query rather than by including the
    // relation on every message - SupportMessage stores an admin id, not a
    // relation, so that the thread survives an admin account being removed.
    const adminIds = Array.from(
      new Set(ticket.messages.map((message) => message.authorAdminId).filter((v): v is string => Boolean(v))),
    );
    const admins = adminIds.length
      ? await this.prisma.superAdmin.findMany({ where: { id: { in: adminIds } }, select: ADMIN_SELECT })
      : [];
    const adminsById = new Map(admins.map((admin) => [admin.id, admin]));

    return {
      ...ticket,
      messages: ticket.messages.map((message) => ({
        ...message,
        author: message.authorAdminId ? (adminsById.get(message.authorAdminId) ?? null) : null,
      })),
    };
  }

  /** The assignee picker. Inactive admins are omitted - they cannot pick work up. */
  async listAssignableAdmins() {
    return this.prisma.superAdmin.findMany({
      where: { isActive: true },
      select: ADMIN_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  // ── Triage ───────────────────────────────────────────────────────────────

  async updateTicketStatus(id: string, dto: UpdateTicketStatusDto) {
    await this.requireTicket(id);
    return this.prisma.supportTicket.update({
      where: { id },
      data: { status: dto.status, ...timestampsForStatus(dto.status) },
      select: { id: true, ticketNumber: true, status: true, resolvedAt: true, closedAt: true, updatedAt: true },
    });
  }

  async updateTicketPriority(id: string, dto: UpdateTicketPriorityDto) {
    await this.requireTicket(id);
    return this.prisma.supportTicket.update({
      where: { id },
      data: { priority: dto.priority },
      select: { id: true, ticketNumber: true, priority: true, updatedAt: true },
    });
  }

  async assignTicket(id: string, dto: AssignTicketDto) {
    const ticket = await this.requireTicket(id);

    if (dto.adminId) {
      const assignee = await this.prisma.superAdmin.findUnique({
        where: { id: dto.adminId },
        select: { id: true, isActive: true },
      });
      if (!assignee) throw new NotFoundException('That administrator could not be found');
      if (!assignee.isActive) throw new BadRequestException('That administrator account is disabled');
    }

    return this.prisma.supportTicket.update({
      where: { id },
      data: {
        assignedAdminId: dto.adminId ?? null,
        // Assigning an untouched ticket moves it out of the "new" queue - it
        // now has an owner, so leaving it as New would keep it in everyone
        // else's unhandled list. Any later status is the admin's own decision
        // and is left alone.
        ...(dto.adminId && ticket.status === SupportStatus.OPEN
          ? { status: SupportStatus.IN_PROGRESS, ...timestampsForStatus(SupportStatus.IN_PROGRESS) }
          : {}),
      },
      select: {
        id: true,
        ticketNumber: true,
        assignedAdminId: true,
        assignedAdmin: { select: ADMIN_SELECT },
        status: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Records an admin-only note. Never emailed, never returned by any public
   * endpoint, and flagged `isInternal` so the reply builder's second check
   * (see SupportEmailBuilder) also refuses to send it.
   */
  async addInternalNote(id: string, dto: AddInternalNoteDto, adminId: string) {
    await this.requireTicket(id);
    return this.prisma.supportMessage.create({
      data: {
        ticketId: id,
        authorType: SupportAuthorType.ADMIN,
        authorAdminId: adminId,
        // Notes are plain text - there is no reason for an internal jotting to
        // carry markup, and not sanitizing rich text is how it ends up
        // rendered unescaped in the thread view.
        body: htmlToPlainText(dto.body) || dto.body,
        isInternal: true,
      },
    });
  }

  // ── Replying ─────────────────────────────────────────────────────────────

  /**
   * Writes an admin's reply and queues the email to the user.
   *
   * The reply is committed before the email is queued, and the two outcomes are
   * reported separately. If delivery fails the admin's words are still on the
   * ticket and marked FAILED, so the response can be retried rather than
   * silently lost - which is what happens when a send failure rolls back the
   * message it was supposed to deliver.
   */
  async replyToTicket(ticketId: string, dto: SendReplyDto, adminId: string) {
    const ticket = await this.requireTicket(ticketId);

    const body = sanitizeReplyHtml(dto.body);
    // Sanitizing can legitimately empty a body that was nothing but markup.
    // Sending that would deliver a blank email over the user's signature.
    if (htmlToPlainText(body).length === 0) {
      throw new BadRequestException('The reply is empty once formatting is removed. Write some text before sending.');
    }

    // The status is applied first so the email - which renders from the
    // ticket's current state - reports the status the admin chose to send,
    // not the one it had a moment ago.
    const status = dto.status ?? (ticket.status === SupportStatus.OPEN ? SupportStatus.IN_PROGRESS : ticket.status);

    const { message } = await this.prisma.$transaction(async (tx) => {
      await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          status,
          ...timestampsForStatus(status),
          // An admin replying to an unassigned ticket takes ownership of it;
          // leaving it unassigned means it stays in everyone's queue.
          ...(ticket.assignedAdminId ? {} : { assignedAdminId: adminId }),
        },
      });

      const created = await tx.supportMessage.create({
        data: {
          ticketId,
          authorType: SupportAuthorType.ADMIN,
          authorAdminId: adminId,
          body,
          isInternal: false,
          emailStatus: EmailDeliveryStatus.PENDING,
        },
      });

      if (dto.internalNote) {
        await tx.supportMessage.create({
          data: {
            ticketId,
            authorType: SupportAuthorType.ADMIN,
            authorAdminId: adminId,
            body: htmlToPlainText(dto.internalNote) || dto.internalNote,
            isInternal: true,
          },
        });
      }

      return { message: created };
    });

    const queued = await this.queueReplyEmail(message.id, ticket.ticketNumber);

    return {
      message,
      status,
      // The client uses this to distinguish "sent" from "saved but not
      // delivered". `queued` only means the job was accepted - the delivery
      // outcome arrives later on the message's own emailStatus.
      emailQueued: queued,
    };
  }

  /**
   * Re-queues the email for a reply whose delivery previously failed.
   *
   * Only failed replies can be retried: re-sending a delivered one would mail
   * the user the same message twice, and a pending one already has a job.
   */
  async retryReplyEmail(ticketId: string, messageId: string) {
    const ticket = await this.requireTicket(ticketId);
    const message = await this.prisma.supportMessage.findFirst({
      where: { id: messageId, ticketId },
      select: { id: true, isInternal: true, emailStatus: true },
    });

    if (!message) throw new NotFoundException('That reply could not be found on this ticket');
    if (message.isInternal) throw new BadRequestException('Internal notes are not sent to the user');
    if (message.emailStatus !== EmailDeliveryStatus.FAILED) {
      throw new BadRequestException('Only a reply whose delivery failed can be resent');
    }

    await this.prisma.supportMessage.update({
      where: { id: messageId },
      data: { emailStatus: EmailDeliveryStatus.PENDING, emailError: null },
    });

    const queued = await this.queueReplyEmail(messageId, ticket.ticketNumber);
    return { emailQueued: queued };
  }

  /** Re-queues the confirmation email for a ticket whose original send failed. */
  async retryConfirmationEmail(ticketId: string) {
    const ticket = await this.requireTicket(ticketId);
    if (ticket.emailStatus !== EmailDeliveryStatus.FAILED) {
      throw new BadRequestException('Only a confirmation whose delivery failed can be resent');
    }

    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { emailStatus: EmailDeliveryStatus.PENDING, emailError: null },
    });

    try {
      await this.email.sendSupportRequestReceivedEmail(ticketId);
      return { emailQueued: true };
    } catch (error) {
      await this.markConfirmationUnqueueable(ticketId, error as Error, ticket.ticketNumber);
      return { emailQueued: false };
    }
  }

  private async queueReplyEmail(messageId: string, ticketNumber: string): Promise<boolean> {
    try {
      await this.email.sendSupportReplyEmail(messageId);
      return true;
    } catch (error) {
      // Could not even reach the queue. Recorded on the message so the admin
      // sees an actionable failure instead of a reply stuck on "pending".
      this.logger.error(
        `admin_support.reply_enqueue_failed ${JSON.stringify({
          ticketNumber,
          messageId,
          error: (error as Error).message,
        })}`,
      );
      await this.prisma.supportMessage
        .update({
          where: { id: messageId },
          data: {
            emailStatus: EmailDeliveryStatus.FAILED,
            emailError: 'The email could not be queued for delivery. Try resending.',
          },
        })
        .catch(() => {});
      return false;
    }
  }

  private async markConfirmationUnqueueable(ticketId: string, error: Error, ticketNumber: string) {
    this.logger.error(
      `admin_support.confirmation_enqueue_failed ${JSON.stringify({ ticketNumber, error: error.message })}`,
    );
    await this.prisma.supportTicket
      .update({
        where: { id: ticketId },
        data: {
          emailStatus: EmailDeliveryStatus.FAILED,
          emailError: 'The email could not be queued for delivery. Try resending.',
        },
      })
      .catch(() => {});
  }

  /**
   * Renders what the user would receive, without sending anything.
   *
   * Returns the sanitized body rather than the raw input, so the preview shows
   * the effect of sanitization - an admin who pastes markup that will be
   * stripped finds out before they send, not afterwards.
   */
  previewReply(body: string) {
    const sanitized = sanitizeReplyHtml(body);
    return {
      html: sanitized,
      plainText: htmlToPlainText(sanitized),
      wasModified: sanitized !== body,
    };
  }

  private async requireTicket(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: {
        id: true,
        ticketNumber: true,
        status: true,
        assignedAdminId: true,
        emailStatus: true,
        email: true,
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }
}
