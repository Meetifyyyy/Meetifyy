import {
  Injectable,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationStatus } from '@prisma/client';
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

    // Claim the transition instead of checking and then writing. The previous
    // read-then-write left a window in which a double-clicked submit button, or
    // two open tabs, both passed the status check and both wrote — producing
    // duplicate work for reviewers and a status update that raced with itself.
    // A conditional update lets exactly one submission through.
    const claimed = await this.prisma.user.updateMany({
      where: { id: userId, verificationStatus: { in: SUBMITTABLE_FROM } },
      data: { verificationStatus: VerificationStatus.PENDING },
    });

    if (claimed.count === 0) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { verificationStatus: true },
      });
      if (!user) throw new BadRequestException('User not found');
      throw new ConflictException(
        `Cannot submit verification while status is ${user.verificationStatus}`,
      );
    }

    // Belt-and-braces: uploads into `verification/` are already created
    // private, so this only repairs rows predating that. It is not the thing
    // protecting the documents — the storage layer refuses the whole prefix.
    await this.prisma.media.updateMany({
      where: { id: { in: [selfieMediaId, idCardMediaId] } },
      data: { visibility: 'private' },
    });

    const request = await this.prisma.verificationRequest.upsert({
      where: { userId },
      create: {
        userId,
        selfieMediaId,
        idCardMediaId,
        status: VerificationStatus.PENDING,
      },
      update: {
        selfieMediaId,
        idCardMediaId,
        status: VerificationStatus.PENDING,
        rejectionReason: null,
        reviewerId: null,
      },
    });

    // Submitting drops an account to PENDING, which is not an eligible state.
    // Announce it so open sessions and DM partners stop offering actions the
    // server will now refuse.
    await this.verificationAccess.announceStatusChange(
      userId,
      VerificationStatus.PENDING,
    );

    this.logger.log(
      `verification:submitted user=${userId} request=${request.id}`,
    );

    return request;
  }

  async getStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { verificationStatus: true },
    });

    const request = await this.prisma.verificationRequest.findUnique({
      where: { userId },
      select: {
        status: true,
        rejectionReason: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      status: user?.verificationStatus || VerificationStatus.UNVERIFIED,
      request: request || null,
    };
  }
}
