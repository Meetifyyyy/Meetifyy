import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SupportAuthorType, SupportCategory } from '@prisma/client';
import { createHash } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { config } from '../config';
import { generateTicketNumber } from '../support/utils/ticket-number.util';

/** How long a user must wait before filing another appeal. */
const APPEAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * The suspension screen and its appeal.
 *
 * An appeal is a support ticket in the `SUSPENSION_APPEAL` category rather than
 * a parallel model: appeals then inherit the reply threading, assignment,
 * status workflow and email delivery the support desk already has, and the
 * admin queue shows them as their own section by filtering on the category.
 */
@Injectable()
export class SuspensionService {
  private readonly logger = new Logger(SuspensionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The suspension screen's content, resolved server-side.
   *
   * Returns `suspended: false` for a healthy account so the client can clear
   * the screen the moment a suspension is lifted, without a sign-out.
   */
  async getStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, accountStatus: true },
    });
    if (!user) throw new NotFoundException('Account not found');

    if (user.accountStatus !== 'SUSPENDED') {
      return { suspended: false, accountStatus: user.accountStatus };
    }

    // The most recent appeal, so the screen can show progress instead of
    // inviting the same person to file the same appeal repeatedly.
    const latestAppeal = await this.prisma.supportTicket.findFirst({
      where: { userId, category: SupportCategory.SUSPENSION_APPEAL },
      orderBy: { createdAt: 'desc' },
      select: {
        ticketNumber: true,
        status: true,
        createdAt: true,
      },
    });

    const canAppealAt = latestAppeal
      ? new Date(latestAppeal.createdAt.getTime() + APPEAL_COOLDOWN_MS)
      : null;

    return {
      suspended: true,
      accountStatus: user.accountStatus,
      email: user.email,
      latestAppeal: latestAppeal
        ? {
            ticketNumber: latestAppeal.ticketNumber,
            status: latestAppeal.status,
            submittedAt: latestAppeal.createdAt.toISOString(),
          }
        : null,
      // Null means "may appeal now"; a future instant means the cooldown is
      // still running. Computed here so the client cannot shorten it.
      canAppealAt:
        canAppealAt && canAppealAt.getTime() > Date.now()
          ? canAppealAt.toISOString()
          : null,
    };
  }

  /**
   * Files an appeal as a support ticket.
   *
   * The account is re-read rather than trusted from the request: a session can
   * outlive the suspension that justified it, and an unsuspended user must not
   * be able to open appeal tickets.
   */
  async submitAppeal(
    userId: string,
    message: string,
    context: { ip: string; userAgent: string | null },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        username: true,
        accountStatus: true,
      },
    });
    if (!user) throw new NotFoundException('Account not found');

    if (user.accountStatus !== 'SUSPENDED') {
      throw new ForbiddenException(
        'This account is not suspended, so there is nothing to appeal.',
      );
    }

    const previous = await this.prisma.supportTicket.findFirst({
      where: { userId, category: SupportCategory.SUSPENSION_APPEAL },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, status: true, ticketNumber: true },
    });

    // One open appeal at a time, then a cooldown. Without this the review queue
    // can be flooded from a single account, which is exactly the behaviour a
    // suspension is often responding to.
    if (previous) {
      const isOpen =
        previous.status === 'OPEN' || previous.status === 'IN_PROGRESS';
      if (isOpen) {
        throw new BadRequestException(
          `Your appeal ${previous.ticketNumber} is already with the review team. You will get an email when there is a decision.`,
        );
      }
      const elapsed = Date.now() - previous.createdAt.getTime();
      if (elapsed < APPEAL_COOLDOWN_MS) {
        const hours = Math.ceil((APPEAL_COOLDOWN_MS - elapsed) / 3_600_000);
        throw new BadRequestException(
          `You can submit another appeal in ${hours} hour${hours === 1 ? '' : 's'}.`,
        );
      }
    }

    const ticket = await this.createAppealTicket({
      userId: user.id,
      email: user.email,
      name: user.displayName || user.username || null,
      category: SupportCategory.SUSPENSION_APPEAL,
      subject: `Suspension appeal — @${user.username ?? user.id}`,
      description: message.trim(),
      // Appeals are time-sensitive: the person is locked out of the product
      // while it sits in the queue.
      priority: 'HIGH',
      ipHash: this.hashIp(context.ip),
      browserInfo: context.userAgent
        ? { userAgent: context.userAgent }
        : Prisma.DbNull,
      pageContext: '/suspended',
    });

    this.logger.log(
      `suspension.appeal_filed user=${user.id} ticket=${ticket.ticketNumber}`,
    );

    return {
      ticketNumber: ticket.ticketNumber,
      status: ticket.status,
      submittedAt: ticket.createdAt.toISOString(),
    };
  }

  /**
   * Mirrors the support desk's own creation path, including the retry on a
   * ticket-number collision — the unique index, not the generator's entropy, is
   * what guarantees uniqueness.
   */
  private async createAppealTicket(
    data: Omit<Prisma.SupportTicketUncheckedCreateInput, 'ticketNumber'>,
  ) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const ticketNumber = generateTicketNumber();
      try {
        return await this.prisma.supportTicket.create({
          data: {
            ...data,
            ticketNumber,
            messages: {
              create: {
                authorType: SupportAuthorType.USER,
                senderId: data.userId ?? null,
                body: data.description,
                isInternal: false,
              },
            },
          },
        });
      } catch (error) {
        const isCollision =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          (error.meta?.target as string[] | undefined)?.includes(
            'ticketNumber',
          );
        if (!isCollision) throw error;
      }
    }
    throw new Error('Could not allocate a unique appeal ID after 5 attempts');
  }

  private hashIp(ip: string): string {
    return createHash('sha256')
      .update(`${config.support.ipHashSalt}:${ip}`)
      .digest('hex')
      .slice(0, 32);
  }
}
