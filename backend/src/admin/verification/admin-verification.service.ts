import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VerificationStatus } from '@prisma/client';
import { VerificationAccessService } from '../../common/verification/verification-access.service';
import { StorageService } from '../../uploads/uploads.service';
import { errorMessage } from '../../common/utils/error.util';

/** How long a reviewer's link to a private document lives. */
const REVIEW_URL_TTL_SECONDS = 300;

/** A reviewer-signed document URL, or the reason there is none. */
export interface ReviewerDocumentUrl {
  url: string | null;
  /** True only when an object exists and signing it failed; false for "never uploaded". */
  signError: boolean;
}

@Injectable()
export class AdminVerificationService {
  /** Reviewer decisions are auditable. Ids and statuses only — no documents. */
  private readonly logger = new Logger(AdminVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly verificationAccess: VerificationAccessService,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Attaches a short-lived signed URL to each document on a request.
   *
   * The admin UI reads `selfieMedia.url` / `idCardMedia.url`, but the raw
   * `media` row has no such field — so the reviewer screen rendered its
   * "no image" placeholder for every request and approvals were being made
   * without anyone seeing the documents.
   *
   * The URLs are signed and short-lived rather than public: these objects are
   * private, and the reviewer is not their owner. Five minutes is enough to
   * open both images and expires well before a copied link is useful.
   */
  private async withDocumentUrls<
    T extends {
      selfieMedia?: { objectKey: string } | null;
      idCardMedia?: { objectKey: string } | null;
    },
  >(
    requests: T[],
  ): Promise<
    (Omit<T, 'selfieMedia' | 'idCardMedia'> & {
      selfieMedia: (NonNullable<T['selfieMedia']> & ReviewerDocumentUrl) | null;
      idCardMedia: (NonNullable<T['idCardMedia']> & ReviewerDocumentUrl) | null;
    })[]
  > {
    return Promise.all(
      requests.map(async (req) => {
        const [selfie, idCard] = await Promise.all([
          this.signReviewerDocument(req.selfieMedia),
          this.signReviewerDocument(req.idCardMedia),
        ]);
        return {
          ...req,
          // A purged request has no documents to sign for — the retention sweep
          // removed them after the decision — and its relation is null here.
          selfieMedia: req.selfieMedia
            ? { ...req.selfieMedia, ...selfie }
            : null,
          idCardMedia: req.idCardMedia
            ? { ...req.idCardMedia, ...idCard }
            : null,
        };
      }),
    );
  }

  /**
   * One document's reviewer URL, and whether getting it failed.
   *
   * `url: null` used to mean two different things — nothing was ever uploaded,
   * and signing failed — and the review screen rendered both as "No ID card
   * uploaded". A reviewer looking at a transient storage error was told the
   * student had not submitted a document. `signError` separates them: it is true
   * only when there IS a stored object and a URL for it could not be produced.
   */
  private async signReviewerDocument(
    media: { objectKey: string } | null | undefined,
  ): Promise<ReviewerDocumentUrl> {
    if (!media?.objectKey) return { url: null, signError: false };
    try {
      const url = await this.storageService.getReviewerSignedUrl(
        media.objectKey,
        REVIEW_URL_TTL_SECONDS,
      );
      return url ? { url, signError: false } : { url: null, signError: true };
    } catch (error) {
      // The key is an object path, not a document; the error is storage's.
      this.logger.warn(
        `Could not sign a verification document: ${errorMessage(error)}`,
      );
      return { url: null, signError: true };
    }
  }

  /**
   * Fresh reviewer URLs for one request.
   *
   * The URLs in the list expire after five minutes and the page can stay open
   * far longer, so a link that fails (or is about to be opened) asks for new
   * ones here instead of making the reviewer reload the whole queue. Same
   * guard, same TTL, same private objects — nothing is published.
   */
  async getDocumentUrls(id: string): Promise<{
    selfie: ReviewerDocumentUrl;
    idCard: ReviewerDocumentUrl;
  }> {
    const request = await this.prisma.verificationRequest.findUnique({
      where: { id },
      select: {
        selfieMedia: { select: { objectKey: true } },
        idCardMedia: { select: { objectKey: true } },
      },
    });
    if (!request) {
      throw new NotFoundException('Verification request not found');
    }
    const [selfie, idCard] = await Promise.all([
      this.signReviewerDocument(request.selfieMedia),
      this.signReviewerDocument(request.idCardMedia),
    ]);
    return { selfie, idCard };
  }

  async listRequests(
    status?: VerificationStatus,
    limit: number = 20,
    offset: number = 0,
  ) {
    const where = status ? { status } : {};

    const [total, requests] = await Promise.all([
      this.prisma.verificationRequest.count({ where }),
      this.prisma.verificationRequest.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              displayName: true,
              username: true,
              avatar: true,
            },
          },
          selfieMedia: true,
          idCardMedia: true,
        },
      }),
    ]);

    // What this user tried before, so a reviewer looking at attempt 3 can see
    // why 1 and 2 were turned down instead of re-deriving it. Attempts are
    // retained now, so this context exists; one extra query covers the page.
    const userIds = [...new Set(requests.map((r) => r.userId))];
    const priorAttempts = userIds.length
      ? await this.prisma.verificationRequest.findMany({
          where: { userId: { in: userIds } },
          select: {
            id: true,
            userId: true,
            attemptNumber: true,
            status: true,
            rejectionReason: true,
            reviewedAt: true,
            createdAt: true,
          },
          orderBy: { attemptNumber: 'desc' },
        })
      : [];

    const withHistory = requests.map((request) => ({
      ...request,
      previousAttempts: priorAttempts.filter(
        (a) =>
          a.userId === request.userId &&
          a.attemptNumber < request.attemptNumber,
      ),
    }));

    return { total, requests: await this.withDocumentUrls(withHistory) };
  }

  /**
   * Which statuses a reviewer may move a request to, given where it is now.
   *
   * A decision is only meaningful on a request that is actually awaiting one,
   * and PENDING is reachable only by the user submitting — a reviewer cannot
   * put an account back into the queue on its behalf. Revocation of an already
   * VERIFIED account is allowed, because that is a real moderation action.
   */
  private static readonly ALLOWED_TRANSITIONS: Record<
    VerificationStatus,
    VerificationStatus[]
  > = {
    [VerificationStatus.PENDING]: [
      VerificationStatus.VERIFIED,
      VerificationStatus.REJECTED,
      VerificationStatus.RESUBMISSION_REQUIRED,
    ],
    // Revoking access after the fact.
    [VerificationStatus.VERIFIED]: [
      VerificationStatus.REJECTED,
      VerificationStatus.UNVERIFIED,
    ],
    // Terminal until the user resubmits, which is their action, not a
    // reviewer's.
    [VerificationStatus.REJECTED]: [],
    [VerificationStatus.RESUBMISSION_REQUIRED]: [],
    [VerificationStatus.UNVERIFIED]: [],
  };

  async updateStatus(
    id: string,
    status: VerificationStatus,
    // A JSON body field: the global pipe converts only query and route
    // params, so an array or object arrives here as sent.
    adminNotes?: unknown,
    reviewerId?: string,
  ) {
    if (!Object.values(VerificationStatus).includes(status)) {
      throw new BadRequestException(`Unknown verification status: ${status}`);
    }
    if (adminNotes != null && typeof adminNotes !== 'string') {
      throw new BadRequestException('adminNotes must be a string');
    }
    const notes = adminNotes ?? undefined;

    const request = await this.prisma.verificationRequest.findUnique({
      where: { id },
    });

    if (!request) {
      throw new NotFoundException('Verification request not found');
    }

    const allowed =
      AdminVerificationService.ALLOWED_TRANSITIONS[request.status] || [];
    if (!allowed.includes(status)) {
      throw new ConflictException(
        `Cannot move a ${request.status} request to ${status}`,
      );
    }

    // Claim the transition rather than assume it. Two reviewers acting on the
    // same request at the same moment — or one reviewer double-clicking — both
    // passed the read above; this conditional update lets exactly one of them
    // win. The loser gets a 409 instead of silently overwriting the decision
    // that already landed, which is what made "approve and reject at the same
    // time" resolve to whichever request happened to write last.
    const claimed = await this.prisma.verificationRequest.updateMany({
      where: { id, status: request.status },
      data: {
        status,
        // Persist the reason the reviewer gave. It was accepted by the
        // controller and then dropped on the floor, so a rejected user was
        // told only that they had been rejected — the column existed and was
        // always null, and the UI had nothing to show them.
        rejectionReason:
          status === VerificationStatus.REJECTED ||
          status === VerificationStatus.RESUBMISSION_REQUIRED
            ? notes?.slice(0, 500) || null
            : null,
        // Who decided. Read from the verified admin session, so a review is
        // attributable to a person rather than to "an admin". The column
        // existed and was never written, because the endpoint authenticated
        // against the wrong identity table entirely.
        ...(reviewerId ? { reviewerId } : {}),
        // When it was decided. `updatedAt` moves on any write, so it cannot be
        // shown to the user as "reviewed on" — this records the decision itself.
        reviewedAt: new Date(),
      },
    });

    if (claimed.count === 0) {
      // Worth a warning rather than a silent 409: it means two reviewers were
      // acting on the same request at the same moment.
      this.logger.warn(
        `verification:review-race request=${id} attempted=${status}`,
      );
      throw new ConflictException(
        'This request was already reviewed by someone else',
      );
    }

    const [updatedRequest, updatedUser] = await this.prisma.$transaction([
      this.prisma.verificationRequest.findUniqueOrThrow({ where: { id } }),
      this.prisma.user.update({
        where: { id: request.userId },
        data: {
          verificationStatus: status,
        },
      }),
    ]);

    this.logger.log(
      `verification:reviewed request=${id} user=${request.userId} ` +
        `${request.status}->${status} reviewer=${reviewerId ?? 'unknown'}`,
    );

    // An approval or a rejection changes who this person may message, and the
    // other side of every open DM is holding a composer decided before this
    // moment. Announce it so those threads flip immediately instead of
    // discovering the change by having a send rejected.
    await this.verificationAccess.announceStatusChange(
      request.userId,
      updatedUser.verificationStatus,
    );

    return {
      request: updatedRequest,
      user: {
        id: updatedUser.id,
        verificationStatus: updatedUser.verificationStatus,
      },
    };
  }
}
