import { Injectable, Logger } from '@nestjs/common';
import { render } from '@react-email/render';
import { createElement } from 'react';

import { PrismaService } from '../prisma/prisma.service';
import { config } from '../config';
import { htmlToPlainText } from '../common/utils/sanitize-html.util';
import { SUPPORT_CATEGORY_LABELS } from '../support/support.constants';
import { SupportRequestReceivedEmail } from './templates/support-request-received';
import { SupportReplyEmail } from './templates/support-reply';
import { SupportAttachmentItem } from './templates/components/SupportDetails';

/** Job names handled by this builder. Kept here so the processor imports one thing. */
export const SUPPORT_EMAIL_JOBS = {
  requestReceived: 'send-support-request-received',
  reply: 'send-support-reply',
} as const;

export type SupportEmailJobName =
  (typeof SUPPORT_EMAIL_JOBS)[keyof typeof SUPPORT_EMAIL_JOBS];

/**
 * Where the worker should record this message's delivery outcome. Null for the
 * internal notification, which has no user-visible row to annotate.
 */
export type DeliveryTarget = {
  model: 'supportTicket' | 'supportMessage';
  id: string;
} | null;

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
 * Assembles support emails from the database.
 *
 * Queue jobs carry only a row id. Loading the content here rather than in the
 * enqueuing service means the message body - which includes the user's own
 * words and, for replies, an admin's - never sits in Redis, and a job that is
 * retried renders the ticket's current status rather than a stale snapshot.
 */
@Injectable()
export class SupportEmailBuilder {
  private readonly logger = new Logger(SupportEmailBuilder.name);

  constructor(private readonly prisma: PrismaService) {}

  async build(
    jobName: SupportEmailJobName,
    rowId: string,
  ): Promise<BuiltEmail | null> {
    switch (jobName) {
      case SUPPORT_EMAIL_JOBS.requestReceived:
        return this.buildRequestReceived(rowId);
      case SUPPORT_EMAIL_JOBS.reply:
        return this.buildReply(rowId);
      default:
        return null;
    }
  }

  private async buildRequestReceived(
    ticketId: string,
  ): Promise<BuiltEmail | null> {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) {
      this.logger.error(
        `support_email.ticket_missing ${JSON.stringify({ ticketId })}`,
      );
      return null;
    }

    const mediaBaseUrl =
      config.app.apiBaseUrl || config.app.backendUrl || config.app.frontendUrl;
    const attachments = resolveAttachmentItems(
      ticket.attachments,
      mediaBaseUrl,
    );

    const element = createElement(SupportRequestReceivedEmail, {
      name: ticket.name,
      email: ticket.email,
      ticketNumber: ticket.ticketNumber,
      categoryLabel:
        SUPPORT_CATEGORY_LABELS[ticket.category] || 'Support Request',
      subject: ticket.subject,
      description: ticket.description,
      attachments,
      helpCentreUrl: config.support.helpCentreUrl,
    });

    return {
      to: ticket.email,
      // Subject clearly identifies the support request ID and Meetifyy branding
      subject: `Support request received: #${ticket.ticketNumber} | Meetifyy`,
      html: await render(element),
      text: await render(element, { plainText: true }),
      replyTo: undefined,
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
      this.logger.error(
        `support_email.message_missing ${JSON.stringify({ messageId })}`,
      );
      return null;
    }

    // Belt and braces check: internal notes must never be emailed to a user.
    if (message.isInternal) {
      this.logger.error(
        `support_email.internal_note_blocked ${JSON.stringify({ messageId, ticketNumber: message.ticket.ticketNumber })}`,
      );
      return null;
    }

    const { ticket } = message;
    const element = createElement(SupportReplyEmail, {
      ticketNumber: ticket.ticketNumber,
      replyHtml: message.body,
      helpCentreUrl: config.support.helpCentreUrl,
    });

    return {
      to: ticket.email,
      // Standardized subject format: Update on your support request #{Support ID} | Meetifyy
      subject: `Update on your support request #${ticket.ticketNumber} | Meetifyy`,
      html: await render(element),
      text: await render(element, { plainText: true }),
      replyTo: undefined,
      deliveryTarget: { model: 'supportMessage', id: message.id },
      logContext: {
        ticketNumber: ticket.ticketNumber,
        kind: 'admin-reply',
        messageId: message.id,
      },
    };
  }
}

/** Resolves structured attachment metadata into clean names and accessible media links. */
function resolveAttachmentItems(
  attachments: unknown,
  baseUrl: string,
): SupportAttachmentItem[] {
  if (!Array.isArray(attachments)) return [];
  const items: SupportAttachmentItem[] = [];
  for (const file of attachments) {
    if (!file || typeof file !== 'object') continue;
    const f = file as Record<string, unknown>;
    const filename =
      typeof f.filename === 'string' && f.filename.length > 0
        ? f.filename
        : 'attachment';
    const key =
      typeof f.key === 'string'
        ? f.key
        : typeof f.storageKey === 'string'
          ? f.storageKey
          : undefined;
    const url = key ? `${baseUrl}/api/media/${key}` : undefined;
    const size =
      typeof f.size === 'number'
        ? f.size
        : typeof f.fileSize === 'number'
          ? f.fileSize
          : undefined;
    items.push({ filename, url, size });
  }
  return items;
}

/** Exported for the reply preview in the Admin Dashboard. */
export { htmlToPlainText };
