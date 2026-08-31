import {
  Injectable,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, VerificationStatus } from '@prisma/client';
import { VerificationAccessService } from '../common/verification/verification-access.service';

/** The states from which a user may start (or restart) verification. */
const SUBMITTABLE_FROM: VerificationStatus[] = [
  VerificationStatus.UNVERIFIED,
  VerificationStatus.REJECTED,
  VerificationStatus.RESUBMISSION_REQUIRED,
];

@Injectable()
export class VerificationService {
  /**
   * Verification documents are retained indefinitely, by product decision.
   *
   * Nothing deletes them: not a scheduled sweep, and not a resubmission —
   * superseding a document leaves the previous one in the bucket rather than
   * removing it. That is deliberate, so the note is here rather than absent:
   * KYC material accumulating without a retention policy is a privacy and
   * compliance exposure that grows over time, and whoever revisits this should
   * know it was chosen rather than overlooked.
   *
   * Verification lifecycle events are auditable through the app's normal
   * structured logging. Deliberately identifiers only — never the images, the
   * storage keys, or anything read off a document. `AuditLog` is not used
   * because its `adminId` is foreign-keyed to `SuperAdmin`, and a submission
   * has no admin actor at all.
   */
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly verificationAccess: VerificationAccessService,
  ) {}

  /**
   * Validates one of the two documents attached to a submission.
   *
   * Ownership alone is not enough. Without the checks below a user could point
   * a submission at any media id they happened to own — a chat photo, a video,
   * a voice note — and the reviewer would be handed something that is not a
   * document at all. The mime type is the one the server recorded at upload,
   * not a client-supplied field, and the folder check ensures the object is
   * actually stored under the private prefix rather than somewhere publicly
   * readable.
   */
  private async assertUsableDocument(
    mediaId: string,
    userId: string,
    label: string,
  ) {
    if (!mediaId || typeof mediaId !== 'string') {
      throw new BadRequestException(`Missing ${label}`);
    }
    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      select: { id: true, ownerId: true, mimeType: true, objectKey: true },
    });
    if (!media || media.ownerId !== userId) {
      throw new BadRequestException(`Invalid ${label}`);
    }
    if (!media.mimeType?.startsWith('image/')) {
      throw new BadRequestException(`${label} must be an image`);
    }
    if (!media.objectKey?.startsWith('verification/')) {
      // A document stored outside the private prefix would be publicly
      // resolvable through /api/media, so it is refused rather than accepted
      // and quietly leaked.
      throw new BadRequestException(
        `${label} must be uploaded through the verification flow`,
      );
    }
    return media;
  }

  async submitVerification(
    userId: string,
    selfieMediaId: string,
    idCardMediaId: string,
  ) {
    if (selfieMediaId === idCardMediaId) {
      throw new BadRequestException(
        'The selfie and the ID card must be two different images',
      );
    }

    await Promise.all([
      this.assertUsableDocument(selfieMediaId, userId, 'selfie'),
      this.assertUsableDocument(idCardMediaId, userId, 'id card'),
    ]);

    // Both writes go in one transaction. The account status and the attempt row
    // have to move together: claiming the status first and inserting afterwards
    // left a failed insert parked at PENDING with no request behind it —
    // unable to resubmit, and invisible to reviewers.
    let request: { id: string; attemptNumber: number };
    try {
      request = await this.prisma.$transaction(async (tx) => {
        // Claim the transition instead of checking and then writing. The
        // previous read-then-write left a window in which a double-clicked
        // submit button, or two open tabs, both passed the status check and
        // both wrote. A conditional update lets exactly one through.
        const claimed = await tx.user.updateMany({
          where: { id: userId, verificationStatus: { in: SUBMITTABLE_FROM } },
          data: { verificationStatus: VerificationStatus.PENDING },
        });

        if (claimed.count === 0) {
          const user = await tx.user.findUnique({
            where: { id: userId },
            select: { verificationStatus: true },
          });
          if (!user) throw new BadRequestException('User not found');
          throw new ConflictException(
            `Cannot submit verification while status is ${user.verificationStatus}`,
          );
        }

        // Belt-and-braces: uploads into `verification/` are already created
        // private, so this only repairs rows predating that. It is not the
        // thing protecting the documents — the storage layer refuses the
        // whole prefix.
        await tx.media.updateMany({
          where: { id: { in: [selfieMediaId, idCardMediaId] } },
          data: { visibility: 'private' },
        });

        // Attempts are numbered per user and never reused, so the history
        // reads as "Attempt 1, 2, 3" no matter how the rows were decided.
        const previous = await tx.verificationRequest.findFirst({
          where: { userId },
          orderBy: { attemptNumber: 'desc' },
          select: { attemptNumber: true },
        });

        // A new row per submission. This was an upsert keyed on the old unique
        // userId, which overwrote the previous attempt and wiped the reason it
        // had been rejected — the user lost the explanation they were meant to
        // act on, and the history could not exist.
        return tx.verificationRequest.create({
          data: {
            userId,
            attemptNumber: (previous?.attemptNumber ?? 0) + 1,
            selfieMediaId,
            idCardMediaId,
            status: VerificationStatus.PENDING,
          },
          select: { id: true, attemptNumber: true },
        });
      });
    } catch (error) {
      // The partial unique index on (userId) WHERE status = 'PENDING' is the
      // actual guarantee against duplicate open requests: two concurrent calls
      // that both somehow cleared the status claim still cannot both insert.
      // The transaction rolls the status change back along with it.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A verification request is already awaiting review',
        );
      }
      throw error;
    }

    // Submitting drops an account to PENDING, which is not an eligible state.
    // Announce it so open sessions and DM partners stop offering actions the
    // server will now refuse.
    await this.verificationAccess.announceStatusChange(
      userId,
      VerificationStatus.PENDING,
    );

    this.logger.log(
      `verification:submitted user=${userId} request=${request.id} ` +
        `attempt=${request.attemptNumber}`,
    );

    return request;
  }

  /**
   * Everything the settings screen needs to decide what to render, read from
   * the persisted attempts rather than inferred from the user's status flag.
   *
   * The panel used to key entirely off `currentUser.verificationStatus`, which
   * is a cached copy: after a refresh or a PWA reload it could still say
   * UNVERIFIED while a request sat pending in the database, and the submission
   * form would be offered again. `latest` is the authoritative answer.
   *
   * Scoped to the caller's own id throughout — a user can only ever read their
   * own attempts and their own rejection reasons. No storage keys or document
   * URLs are returned; the reviewer's signed links are not the user's to hold.
   */
  async getStatus(userId: string) {
    const [user, attempts] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { verificationStatus: true },
      }),
      this.prisma.verificationRequest.findMany({
        where: { userId },
        orderBy: { attemptNumber: 'desc' },
        select: {
          id: true,
          attemptNumber: true,
          status: true,
          rejectionReason: true,
          createdAt: true,
          reviewedAt: true,
        },
      }),
    ]);

    const latest = attempts[0] ?? null;

    return {
      status: user?.verificationStatus || VerificationStatus.UNVERIFIED,
      /** Whether a decision is outstanding. The form must stay hidden for this. */
      hasPendingRequest: latest?.status === VerificationStatus.PENDING,
      /** The current attempt, and the one whose rejection reason to surface. */
      request: latest,
      /** Newest first. Every attempt ever made, retained across resubmissions. */
      history: attempts,
    };
  }
}
