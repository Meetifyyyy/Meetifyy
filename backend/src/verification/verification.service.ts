import {
  Injectable,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import sharp from 'sharp';
import { Prisma, VerificationMethod, VerificationStatus } from '@prisma/client';
import { VerificationAccessService } from '../common/verification/verification-access.service';
import {
  LIVE_CAPTURE_KEY,
  StorageService,
  type VerificationCaptureKind,
} from '../uploads/uploads.service';
import { sniffMimeType } from '../uploads/attachment-inspection.util';

/** The states from which a user may start (or restart) verification. */
const SUBMITTABLE_FROM: VerificationStatus[] = [
  VerificationStatus.UNVERIFIED,
  VerificationStatus.REJECTED,
  VerificationStatus.RESUBMISSION_REQUIRED,
];

/**
 * Limits on one live capture. A camera frame from the app is a JPEG of a few
 * hundred KB; anything far outside these is not one.
 */
export const LIVE_CAPTURE_LIMITS = {
  maxBytes: 8 * 1024 * 1024,
  /** Decoding bomb guard: ~40 MP. */
  maxInputPixels: 40_000_000,
  /** Shorter edge. Below this an ID is unreadable and a face unrecognisable. */
  minEdgePx: 480,
  /** Stored size: long edge scaled down to this. */
  storedLongEdgePx: 2048,
  /** A capture must be submitted within this long, or it is taken again. */
  maxAgeMs: 30 * 60 * 1000,
  acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
} as const;

/** Which capture each method needs, as stored in the key and the row. */
const KIND_FOR_METHOD: Record<VerificationMethod, VerificationCaptureKind> = {
  [VerificationMethod.LIVE_SELFIE]: 'selfie',
  [VerificationMethod.LIVE_GOVERNMENT_ID]: 'id',
};

/** The upload as the multipart interceptor hands it over; nothing else is read. */
export interface CaptureUpload {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

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
    private readonly storage: StorageService,
  ) {}

  /**
   * Stores one live camera capture for a later submission.
   *
   * What "live" can and cannot mean on a server: the bytes of a camera frame
   * and of a saved photo look the same once they arrive, so no upload endpoint
   * can prove a camera took them. The guarantee is built from the parts that
   * can be enforced:
   *
   *   - the app only ever produces these from the camera (getUserMedia); it has
   *     no file picker for verification at all;
   *   - this is the only way to create a `verification/live-*` object, so a
   *     submission can tell a live capture from a generic upload by its key;
   *   - the image is decoded and RE-ENCODED here, so what a reviewer opens is a
   *     plain JPEG the server wrote: no EXIF (location, device), no embedded
   *     payload, nothing a crafted file could carry through;
   *   - a capture must be submitted within LIVE_CAPTURE_LIMITS.maxAgeMs, so an
   *     old capture cannot be held back and replayed later;
   *   - the endpoint is rate limited per user.
   *
   * The reviewer's judgement remains the real check that the photo is a live
   * person or a real ID; this makes sure they are judging a fresh capture.
   */
  async captureDocument(
    userId: string,
    kind: VerificationCaptureKind,
    file: CaptureUpload | undefined,
  ): Promise<{ mediaId: string }> {
    const label = kind === 'selfie' ? 'selfie' : 'ID photo';
    if (!file?.buffer?.length) {
      throw new BadRequestException(`No ${label} was received`);
    }
    if (file.size > LIVE_CAPTURE_LIMITS.maxBytes) {
      throw new BadRequestException(`That ${label} is too large`);
    }
    // The declared type comes from the same untrusted body as the bytes; both
    // must agree and both must be an accepted image type.
    const sniffed = sniffMimeType(file.buffer);
    const accepted: readonly string[] = LIVE_CAPTURE_LIMITS.acceptedTypes;
    if (!sniffed || !accepted.includes(sniffed) || sniffed !== file.mimetype) {
      throw new BadRequestException(`That ${label} is not a valid photo`);
    }

    // Only an account that can submit may capture: otherwise a verified or
    // pending account could fill the private bucket with captures that will
    // never be reviewed.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { verificationStatus: true },
    });
    if (!user) throw new BadRequestException('User not found');
    if (!SUBMITTABLE_FROM.includes(user.verificationStatus)) {
      throw new ConflictException(
        `Cannot capture verification photos while status is ${user.verificationStatus}`,
      );
    }

    let jpeg: Buffer;
    let width: number;
    let height: number;
    try {
      const image = sharp(file.buffer, {
        limitInputPixels: LIVE_CAPTURE_LIMITS.maxInputPixels,
        failOn: 'error',
      }).rotate();
      const { data, info } = await image
        .resize({
          width: LIVE_CAPTURE_LIMITS.storedLongEdgePx,
          height: LIVE_CAPTURE_LIMITS.storedLongEdgePx,
          fit: 'inside',
          withoutEnlargement: true,
        })
        // sharp drops all metadata unless asked to keep it; nothing is kept.
        .jpeg({ quality: 90, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      jpeg = data;
      width = info.width;
      height = info.height;
    } catch {
      throw new BadRequestException(`That ${label} could not be read`);
    }
    if (Math.min(width, height) < LIVE_CAPTURE_LIMITS.minEdgePx) {
      throw new BadRequestException(
        `That ${label} is too small to review. Please take it again.`,
      );
    }

    const stored = await this.storage.storeVerificationCapture(
      userId,
      kind,
      jpeg,
      width,
      height,
    );
    this.logger.log(
      `verification:captured user=${userId} kind=${kind} media=${stored.mediaId}`,
    );
    return { mediaId: stored.mediaId };
  }

  /**
   * Submits ONE live capture for review: a selfie or a government ID.
   *
   * The document must be the caller's own, a live capture of the kind the
   * method names (proven by its key, which only captureDocument writes), and
   * fresh. Everything else (the atomic status claim, attempt numbering, the
   * partial unique index on pending requests) is shared with the legacy path.
   */
  async submitLiveVerification(
    userId: string,
    method: VerificationMethod,
    mediaId: string,
  ) {
    const kind = KIND_FOR_METHOD[method];
    if (!kind) throw new BadRequestException('Unknown verification method');
    const label = kind === 'selfie' ? 'selfie' : 'ID photo';

    const media = await this.assertUsableDocument(mediaId, userId, label);
    const match = LIVE_CAPTURE_KEY.exec(media.objectKey ?? '');
    if (!match) {
      throw new BadRequestException(
        `Your ${label} must be taken with the camera in the app`,
      );
    }
    if (match[1] !== kind) {
      throw new BadRequestException(`That photo is not a ${label}`);
    }
    if (Date.now() - media.createdAt.getTime() > LIVE_CAPTURE_LIMITS.maxAgeMs) {
      throw new BadRequestException(
        `Your ${label} was taken too long ago. Please take it again.`,
      );
    }
    // One capture backs one attempt. A document already attached to an
    // earlier attempt (say, a rejected one) cannot be submitted again.
    const reused = await this.prisma.verificationRequest.count({
      where: { OR: [{ selfieMediaId: mediaId }, { idCardMediaId: mediaId }] },
    });
    if (reused > 0) {
      throw new BadRequestException(
        `That ${label} was already submitted. Please take a new one.`,
      );
    }

    return this.createAttempt(userId, {
      method,
      selfieMediaId: kind === 'selfie' ? mediaId : null,
      idCardMediaId: kind === 'id' ? mediaId : null,
    });
  }

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
      select: {
        id: true,
        ownerId: true,
        mimeType: true,
        objectKey: true,
        createdAt: true,
      },
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

    return this.createAttempt(userId, {
      method: null,
      selfieMediaId,
      idCardMediaId,
    });
  }

  /**
   * The status claim, the attempt row and the announcement, shared by both
   * submission paths once their documents have been checked.
   */
  private async createAttempt(
    userId: string,
    documents: {
      method: VerificationMethod | null;
      selfieMediaId: string | null;
      idCardMediaId: string | null;
    },
  ): Promise<{ id: string; attemptNumber: number }> {
    const { method, selfieMediaId, idCardMediaId } = documents;
    const documentIds = [selfieMediaId, idCardMediaId].filter(
      (id): id is string => Boolean(id),
    );

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
          where: { id: { in: documentIds } },
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
            method,
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
        `attempt=${request.attemptNumber} method=${method ?? 'LEGACY'}`,
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
          method: true,
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
