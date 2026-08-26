import { Injectable, Logger } from '@nestjs/common';
import { render } from '@react-email/render';
import { createElement } from 'react';

import { PrismaService } from '../prisma/prisma.service';
import { config } from '../config';
import { htmlToPlainText } from '../common/utils/sanitize-html.util';
import {
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_STATUS_LABELS,
  SUPPORT_STATUS_USER_MESSAGE,
} from '../support/support.constants';
import { SupportRequestReceivedEmail } from './templates/support-request-received';
import { SupportReplyEmail } from './templates/support-reply';

/** Job names handled by this builder. Kept here so the processor imports one thing. */
export const SUPPORT_EMAIL_JOBS = {
  requestReceived: 'send-support-request-received',
  reply: 'send-support-reply',
} as const;

export type SupportEmailJobName = (typeof SUPPORT_EMAIL_JOBS)[keyof typeof SUPPORT_EMAIL_JOBS];

/**
 * Where the worker should record this message's delivery outcome. Null for the
 * internal notification, which has no user-visible row to annotate.
 */
export type DeliveryTarget = { model: 'supportTicket' | 'supportMessage'; id: string } | null;

export interface BuiltEmail {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative, always produced alongside the HTML. */
  text: string;
  replyTo?: string;
  deliveryTarget: DeliveryTarget;
  /** Safe for logs: identifiers only, never body content. */
  logContext: Record<string, unknown>;
}

/**
 * Assembles the three support emails from the database.
 *
 * Queue jobs carry only a row id. Loading the content here rather than in the
 * enqueuing service means the message body - which includes the user's own
 * words and, for replies, an admin's - never sits in Redis, and a job that is
 * retried an hour later renders the ticket's *current* status rather than a
 * snapshot taken when it was queued.
 */
@Injectable()
export class SupportEmailBuilder {
  private readonly logger = new Logger(SupportEmailBuilder.name);

  constructor(private readonly prisma: PrismaService) {}

  async build(jobName: SupportEmailJobName, rowId: string): Promise<BuiltEmail | null> {
    switch (jobName) {
      case SUPPORT_EMAIL_JOBS.requestReceived:
        return this.buildRequestReceived(rowId);
      case SUPPORT_EMAIL_JOBS.reply:
        return this.buildReply(rowId);
      default:
        return null;
    }
  }

  private async buildRequestReceived(ticketId: string): Promise<BuiltEmail | null> {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      this.logger.error(`support_email.ticket_missing ${JSON.stringify({ ticketId })}`);
      return null;
    }

    const element = createElement(SupportRequestReceivedEmail, {
      name: ticket.name,
      email: ticket.email,
      ticketNumber: ticket.ticketNumber,
      categoryLabel: SUPPORT_CATEGORY_LABELS[ticket.category],
      subject: ticket.subject,
      description: ticket.description,
      submittedAt: formatTimestamp(ticket.createdAt),
      statusLabel: SUPPORT_STATUS_LABELS[ticket.status],
      attachmentNames: attachmentNames(ticket.attachments),
      deviceSummary: describeDevice(ticket.browserInfo),
      pageContext: ticket.pageContext,
      helpCentreUrl: config.support.helpCentreUrl,
    });

    return {
      to: ticket.email,
      // The ticket number goes in the subject so the user's own mail client
      // threads follow-ups together, and so an inbound reply can be matched
      // back to the ticket from the subject alone.
      subject: `[${ticket.ticketNumber}] We've received your support request`,
      html: await render(element),
      text: await render(element, { plainText: true }),
      replyTo: config.support.replyTo,
      deliveryTarget: { model: 'supportTicket', id: ticket.id },
      logContext: { ticketNumber: ticket.ticketNumber, kind: 'confirmation' },
    };
  }

  private async buildReply(messageId: string): Promise<BuiltEmail | null> {
    const message = await this.prisma.supportMessage.findUnique({
      where: { id: messageId },
      include: { ticket: true },
    });

    if (!message) {
      this.logger.error(`support_email.message_missing ${JSON.stringify({ messageId })}`);
      return null;
    }

    // Belt and braces. The admin service already refuses to enqueue a mail for
    // an internal note; this is the second, independent check, because the
    // consequence of getting it wrong is sending a user the team's private
    // notes about them.
    if (message.isInternal) {
      this.logger.error(
        `support_email.internal_note_blocked ${JSON.stringify({ messageId, ticketNumber: message.ticket.ticketNumber })}`,
      );
      return null;
    }

    const { ticket } = message;
    const element = createElement(SupportReplyEmail, {
      name: ticket.name,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      replyHtml: message.body,
      statusLabel: SUPPORT_STATUS_LABELS[ticket.status],
      statusMessage: SUPPORT_STATUS_USER_MESSAGE[ticket.status],
      repliedAt: formatTimestamp(message.createdAt),
      helpCentreUrl: config.support.helpCentreUrl,
    });

    return {
      to: ticket.email,
      // `Re:` plus the same bracketed reference the confirmation used, so this
      // lands in the thread the user already has.
      subject: `Re: [${ticket.ticketNumber}] ${ticket.subject}`,
      html: await render(element),
      text: await render(element, { plainText: true }),
      replyTo: config.support.replyTo,
      deliveryTarget: { model: 'supportMessage', id: message.id },
      logContext: { ticketNumber: ticket.ticketNumber, kind: 'admin-reply', messageId: message.id },
    };
  }
}

/** `25 August 2026 at 14:32 UTC` - unambiguous in every locale that reads it. */
function formatTimestamp(date: Date): string {
  return `${new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date)} UTC`;
}

function countAttachments(attachments: unknown): number {
  return Array.isArray(attachments) ? attachments.length : 0;
}

/**
 * Filenames of the stored attachments, for display.
 *
 * Only the names travel into the email - the files themselves are never
 * attached, so a support confirmation can never be used to bounce a payload
 * back out to an address the sender chose.
 */
function attachmentNames(attachments: unknown): string[] {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((file) => (file && typeof file === 'object' ? (file as Record<string, unknown>).filename : null))
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
}

/** "Chrome · Linux · desktop", falling back to the raw user agent. */
function describeDevice(browserInfo: unknown): string | null {
  const info = (browserInfo ?? {}) as Record<string, unknown>;
  const parts = [info.browser, info.os, info.deviceType].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  if (parts.length) return parts.join(' · ');
  return typeof info.userAgent === 'string' ? info.userAgent : null;
}

/** Exported for the reply preview in the Admin Dashboard. */
export { htmlToPlainText };
