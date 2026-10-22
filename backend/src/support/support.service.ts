import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EmailDeliveryStatus,
  Prisma,
  SupportAuthorType,
  SupportCategory,
  SupportPriority,
  SupportRequestType,
  SupportStatus,
} from '@prisma/client';
import { createHash } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { config } from '../config';
import { errorMessage } from '../common/utils/error.util';
import {
  CreateAccountSupportRequestDto,
  CreateSupportRequestDto,
  SupportRequestFieldsDto,
} from './dto/create-support-request.dto';
import {
  DEFAULT_PRIORITY_BY_CATEGORY,
  SUPPORT_ATTACHMENT_LIMITS,
  SUPPORT_CATEGORY_LABELS,
} from './support.constants';

/** "Your requests" shows recent history, not an archive. */
const MY_REQUESTS_LIMIT = 50;

const MY_REQUEST_SELECT = {
  ticketNumber: true,
  type: true,
  subject: true,
  category: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SupportTicketSelect;

export interface MyRequestSummary {
  ticketNumber: string;
  type: SupportRequestType;
  subject: string;
  category: SupportCategory;
  categoryLabel: string;
  status: SupportStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MyRequestDetail extends MyRequestSummary {
  description: string;
  resolvedAt: string | null;
  messages: {
    id: string;
    from: SupportAuthorType;
    body: string;
    createdAt: string;
  }[];
}

function toSummary(
  row: Prisma.SupportTicketGetPayload<{ select: typeof MY_REQUEST_SELECT }>,
): MyRequestSummary {
  return {
    ticketNumber: row.ticketNumber,
    type: row.type,
    subject: row.subject,
    category: row.category,
    categoryLabel: SUPPORT_CATEGORY_LABELS[row.category],
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Where to reply to an account: the verified college address first, then the
 * sign-in address, never the internal `@meetifyy.user` placeholder that some
 * accounts carry in place of a real one.
 */
export function replyAddressFor(user: {
  email: string;
  collegeEmail: string | null;
}): string | null {
  for (const candidate of [user.collegeEmail, user.email]) {
    const email = candidate?.trim().toLowerCase();
    if (email && !email.endsWith('@meetifyy.user')) return email;
  }
  return null;
}
import { generateTicketNumber } from './utils/ticket-number.util';
import { sanitizeFilename } from '../uploads/attachment-inspection.util';

/**
 * Patterns that look like a credential a user has pasted into the description
 * by mistake ("my password is hunter2", an API key, a bearer token).
 *
 * Support text is read by admins and copied into emails, so a secret in it is
 * a secret in several more places than the user intended. It is redacted at
 * the boundary rather than rejected: telling someone their bug report was
 * refused because of something they cannot see is worse than quietly removing
 * the value and telling them it was removed.
 */
const CREDENTIAL_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern:
      /\b(pass(?:word|phrase|wd)?|pwd|secret|api[_-]?key|token|otp|auth|credential)\b\s*(?:is|:|=|->)\s*\S+/gi,
    replacement: '$1: [redacted]',
  },
  // Bearer / JWT-shaped values, wherever they appear.
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g,
    replacement: 'Bearer [redacted]',
  },
  {
    pattern:
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: '[redacted token]',
  },
  // Common provider key prefixes.
  {
    pattern: /\b(sk|pk|rk|re)_(live|test)_[A-Za-z0-9]{16,}\b/g,
    replacement: '[redacted key]',
  },
];

export interface RequestContext {
  ip: string;
  userAgent: string | null;
  userId: string | null;
}

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  /**
   * Creates a support request from the public form.
   *
   * Ticket creation and email delivery are deliberately independent: the ticket
   * is committed first and the confirmation is queued afterwards. A mail
   * problem therefore downgrades to a tracked `emailStatus`, never to a failed
   * submission - the user's report is already safely recorded and telling them
   * otherwise would only make them file it again.
   */
  async createRequest(dto: CreateSupportRequestDto, context: RequestContext) {
    // Honeypot. Answered with the same shape as a success so a scripted
    // submitter gets no signal that it was caught, but nothing is stored.
    if (dto.website && dto.website.trim().length > 0) {
      this.logger.warn(
        `support.honeypot_tripped ${JSON.stringify({ ipHash: this.hashIp(context.ip) })}`,
      );
      return {
        ticketNumber: generateTicketNumber(),
        status: 'OPEN',
        createdAt: new Date().toISOString(),
      };
    }

    return this.fileTicket(
      dto,
      {
        name: dto.name.trim(),
        email: dto.email.trim().toLowerCase(),
        // Only trusted when the caller actually presented a valid session. An
        // anonymous submitter cannot claim to be an account by filling a field.
        userId: context.userId,
      },
      context,
    );
  }

  /**
   * A request filed from inside the app by a signed-in user. The name and the
   * reply address are the account's own, read here rather than taken from the
   * body, so the ticket is always linked to the account that filed it.
   *
   * This exists because the public route cannot guarantee that link: it treats
   * an expired access token as "anonymous" (it must, for the locked-out case),
   * so a signed-in user whose token had lapsed filed an unlinked ticket that
   * never appeared in "Your requests". Behind `JwtGuard`, a lapsed token is a
   * 401 that the client renews and retries.
   */
  async createRequestForUser(
    userId: string,
    dto: CreateAccountSupportRequestDto,
    context: RequestContext,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, email: true, collegeEmail: true },
    });
    if (!user) throw new NotFoundException('Account not found');

    const email = replyAddressFor(user);
    if (!email) {
      throw new BadRequestException(
        'Your account has no email address we can reply to. Use the form on the Help & Support page instead.',
      );
    }

    return this.fileTicket(
      dto,
      { name: user.displayName.trim() || 'Meetifyy user', email, userId },
      { ...context, userId },
    );
  }

  /**
   * Stores the ticket and queues the confirmation. Ticket creation and email
   * delivery are deliberately independent: the ticket is committed first, so a
   * mail problem downgrades to a tracked `emailStatus`, never to a failed
   * submission - telling the user otherwise would only make them file it again.
   */
  private async fileTicket(
    dto: SupportRequestFieldsDto,
    from: { name: string; email: string; userId: string | null },
    context: RequestContext,
  ) {
    const { text: description, redacted } = redactCredentials(dto.description);
    const { text: subject } = redactCredentials(dto.subject);
    const type = dto.type ?? SupportRequestType.PROBLEM;

    const attachments = await this.resolveAttachments(dto.attachments ?? []);

    const ticket = await this.createTicketWithUniqueNumber({
      email: from.email,
      name: from.name,
      category: dto.category,
      type,
      subject,
      description,
      attachments: attachments.length ? attachments : Prisma.DbNull,
      // An idea is never urgent, whatever area it is about.
      priority:
        type === SupportRequestType.IDEA
          ? SupportPriority.LOW
          : (DEFAULT_PRIORITY_BY_CATEGORY[dto.category] ??
            SupportPriority.NORMAL),
      userId: from.userId,
      browserInfo: this.buildBrowserInfo(dto, context),
      pageContext: dto.pageContext ?? null,
      ipHash: this.hashIp(context.ip),
    });

    this.logger.log(
      `support.request_created ${JSON.stringify({
        // Never the description or the subject: both are user text.
        ticketNumber: ticket.ticketNumber,
        type,
        category: ticket.category,
        priority: ticket.priority,
        authenticated: Boolean(from.userId),
        attachments: attachments.length,
        credentialsRedacted: redacted,
      })}`,
    );

    await this.dispatchNewTicketEmails(ticket);

    // Deliberately narrow: no internal id, no priority, no assignment, no
    // admin metadata. The ticket number is the user's whole handle on this.
    return {
      ticketNumber: ticket.ticketNumber,
      type,
      status: ticket.status,
      createdAt: ticket.createdAt.toISOString(),
      redactedSensitiveContent: redacted,
    };
  }

  /**
   * The account's own tickets for the "Your requests" list. A narrow select:
   * no description, messages, priority, assignment or diagnostics.
   */
  async listRequestsForUser(
    userId: string,
  ): Promise<{ requests: MyRequestSummary[] }> {
    const rows = await this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: MY_REQUESTS_LIMIT,
      select: MY_REQUEST_SELECT,
    });
    return { requests: rows.map(toSummary) };
  }

  /**
   * One of the account's own tickets, with what the user wrote and every reply
   * the team sent them. Looked up by number AND owner in one query, so another
   * account's number is indistinguishable from one that does not exist.
   * Internal notes are excluded in the query, not filtered afterwards.
   */
  async getRequestForUser(
    userId: string,
    ticketNumber: string,
  ): Promise<MyRequestDetail> {
    const row = await this.prisma.supportTicket.findFirst({
      where: { userId, ticketNumber },
      select: {
        ...MY_REQUEST_SELECT,
        description: true,
        resolvedAt: true,
        messages: {
          where: { isInternal: false },
          orderBy: { createdAt: 'asc' },
          select: { id: true, authorType: true, body: true, createdAt: true },
        },
      },
    });
    if (!row) throw new NotFoundException('Request not found');

    return {
      ...toSummary(row),
      description: row.description,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      messages: row.messages.map((m) => ({
        id: m.id,
        // The user sees "you", "Meetifyy support" or a status note, never which admin.
        from: m.authorType,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Inserts the ticket, retrying on the astronomically unlikely event that the
   * generated number is already taken. The unique index - not the generator's
   * entropy - is what actually guarantees uniqueness, so the collision has to
   * be handled rather than assumed away.
   */
  private async createTicketWithUniqueNumber(
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
              // The opening message is the user's own description, so the
              // thread reads as a conversation from the first entry rather
              // than starting with the admin's reply.
              create: {
                authorType: SupportAuthorType.USER,
                senderId: data.userId ?? null,
                body: data.description,
                isInternal: false,
                attachments:
                  data.attachments === Prisma.DbNull
                    ? Prisma.DbNull
                    : (data.attachments as Prisma.InputJsonValue),
              },
            },
          },
        });
      } catch (error) {
        const isTicketNumberCollision =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          (error.meta?.target as string[] | undefined)?.includes(
            'ticketNumber',
          );

        if (!isTicketNumberCollision) throw error;
        this.logger.warn(
          `support.ticket_number_collision ${JSON.stringify({ ticketNumber, attempt })}`,
        );
      }
    }

    throw new Error(
      'Could not allocate a unique support request ID after 5 attempts',
    );
  }

  /**
   * Queues the confirmation email to the person who filed the request.
   *
   * Not awaited for its delivery outcome - it is a queue job, and the worker
   * records the result back onto the ticket. A failure to even enqueue is
   * logged and swallowed, because the ticket is already committed and the
   * request is visible in the Admin Dashboard either way.
   *
   * There is deliberately no internal "new ticket" email: new requests reach
   * the team through the Support section of the Admin Dashboard, so there is
   * no shared mailbox that has to exist for the queue to be seen.
   */
  private async dispatchNewTicketEmails(ticket: {
    id: string;
    ticketNumber: string;
    email: string;
  }) {
    try {
      await this.email.sendSupportRequestReceivedEmail(ticket.id);
    } catch (error) {
      this.logger.error(
        `support.confirmation_enqueue_failed ${JSON.stringify({
          ticketNumber: ticket.ticketNumber,
          error: errorMessage(error),
        })}`,
      );
      await this.prisma.supportTicket
        .update({
          where: { id: ticket.id },
          data: {
            emailStatus: EmailDeliveryStatus.FAILED,
            emailError: 'Could not queue confirmation email',
          },
        })
        .catch(() => {});
    }
  }

  /**
   * Turns the storage keys the client submitted into attachment records.
   *
   * The client sends keys, never metadata: filename, size and type are read
   * back from the Media row the upload endpoint created, so a caller cannot
   * describe a 2 KB text file as a 5 MB image, and cannot reference an object
   * that was never uploaded through the support endpoint.
   */
  private async resolveAttachments(
    refs: Array<{ key: string; filename?: string }>,
  ) {
    const keys = refs.map((ref) => ref.key);
    if (keys.length === 0) return [];
    if (keys.length > SUPPORT_ATTACHMENT_LIMITS.maxFiles) {
      throw new BadRequestException(
        `You can attach at most ${SUPPORT_ATTACHMENT_LIMITS.maxFiles} files.`,
      );
    }

    const unique = Array.from(new Set(keys));
    const media = await this.prisma.media.findMany({
      // The prefix check is what stops a key from any other folder - a private
      // chat image, another user's avatar - being attached to a ticket and
      // rendered in the admin view.
      where: { objectKey: { in: unique, startsWith: 'support/' } },
      select: { id: true, objectKey: true, mimeType: true, fileSize: true },
    });

    if (media.length !== unique.length) {
      throw new BadRequestException(
        'One or more attachments could not be found. Please re-upload and try again.',
      );
    }

    const filenamesByKey = new Map(refs.map((ref) => [ref.key, ref.filename]));

    return media.map((m) => ({
      key: m.objectKey,
      mediaId: m.id,
      mimeType: m.mimeType,
      size: m.fileSize,
      // Display only, and sanitized rather than trusted: it travels into an
      // admin's browser and into two emails. Falls back to the extension when
      // the client sends nothing usable.
      filename: sanitizeFilename(
        filenamesByKey.get(m.objectKey) ||
          `attachment.${m.mimeType.split('/')[1] ?? 'bin'}`,
      ),
    }));
  }

  private buildBrowserInfo(
    dto: SupportRequestFieldsDto,
    context: RequestContext,
  ): Prisma.InputJsonValue {
    return {
      ...(dto.browserInfo ?? {}),
      // The header is the authoritative record; the client-reported fields
      // above are a convenience and can disagree with it.
      userAgent: context.userAgent?.slice(0, 500) ?? null,
    };
  }

  /**
   * The raw address is never stored. A salted hash is enough to recognise
   * repeat submitters and correlate abuse without keeping the address itself
   * on a record that support staff read routinely.
   */
  private hashIp(ip: string): string {
    return createHash('sha256')
      .update(`${config.support.ipHashSalt}:${ip}`)
      .digest('hex')
      .slice(0, 32);
  }
}

/**
 * Applies the credential patterns above, reporting whether anything matched so
 * the user can be told their message was edited.
 */
export function redactCredentials(input: string): {
  text: string;
  redacted: boolean;
} {
  let text = input ?? '';
  let redacted = false;

  for (const { pattern, replacement } of CREDENTIAL_PATTERNS) {
    // `pattern` is a shared /g regex; `replace` does not carry lastIndex
    // between calls the way `test` would, so it is safe to reuse.
    const next = text.replace(pattern, replacement);
    if (next !== text) redacted = true;
    text = next;
  }

  return { text, redacted };
}
