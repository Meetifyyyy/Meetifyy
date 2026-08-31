import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../uploads/uploads.service';

/**
 * Collects verification uploads that were never submitted.
 *
 * Submitted documents are retained indefinitely — that is a deliberate product
 * decision and nothing here changes it. This service exists for the files that
 * never became part of a request at all: someone opened Settings, picked a
 * photo of their ID, and closed the tab. Those are referenced by nothing, so no
 * other cleanup path in the app can see them, and they would otherwise sit in
 * the bucket forever. They are ID photos, which makes "forever" the wrong
 * default for something nobody ever asked us to keep.
 *
 * The client already discards uploads when a submission *fails*. This covers
 * the case it cannot: the browser going away between the upload and the submit.
 *
 * Two properties make this safe, and both are enforced in the query rather than
 * in a comment:
 *
 *   - it only ever looks under `verification/`;
 *   - it only selects rows with no verification request on either side of the
 *     relation, so a submitted document is invisible to it — including one
 *     submitted a second after the sweep started, because the age floor means
 *     nothing recent is in scope in the first place.
 */
@Injectable()
export class VerificationUploadCollectorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(VerificationUploadCollectorService.name);
  private timer?: NodeJS.Timeout;

  private static readonly SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
  private static readonly BATCH = 500;

  /**
   * How long an unsubmitted upload is left alone.
   *
   * An upload writes the object and its row before the submission that claims
   * them, so anything recent is indistinguishable from a submission still in
   * progress. A day's grace makes that race impossible and costs nothing — a
   * genuinely abandoned file is still abandoned tomorrow.
   */
  private get graceMs(): number {
    const raw = Number(process.env.VERIFICATION_ABANDONED_UPLOAD_HOURS);
    const hours = Number.isFinite(raw) && raw > 0 ? raw : 24;
    return hours * 60 * 60 * 1000;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async onModuleInit() {
    await this.sweep();
    this.timer = setInterval(
      () => void this.sweep(),
      VerificationUploadCollectorService.SWEEP_INTERVAL_MS,
    );
    // A pending interval must not hold the process open on shutdown.
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass. Idempotent, and never throws — it runs from a timer. */
  async sweep(): Promise<number> {
    try {
      const abandoned = await this.prisma.media.findMany({
        where: {
          objectKey: { startsWith: 'verification/' },
          createdAt: { lt: new Date(Date.now() - this.graceMs) },
          // Never submitted, on either side. This is what makes a retained
          // document unreachable from here.
          verificationSelfies: { none: {} },
          verificationIdCards: { none: {} },
        },
        select: { id: true, objectKey: true },
        take: VerificationUploadCollectorService.BATCH,
      });

      if (abandoned.length === 0) return 0;

      await Promise.all(
        abandoned.map((m) =>
          this.storageService.delete(m.objectKey).catch((err) => {
            // Logged rather than retried forever; the row still goes, so a
            // permanently stuck object is findable here instead of making
            // every future sweep re-attempt it.
            this.logger.warn(
              `verification:abandoned could not delete ${m.objectKey}: ${
                (err as Error)?.message
              }`,
            );
          }),
        ),
      );

      await this.prisma.media.deleteMany({
        where: { id: { in: abandoned.map((m) => m.id) } },
      });

      this.logger.log(
        `verification:abandoned collected ${abandoned.length} unsubmitted upload(s)`,
      );
      return abandoned.length;
    } catch (err) {
      this.logger.error(
        `verification:abandoned sweep failed: ${(err as Error)?.message}`,
      );
      return 0;
    }
  }
}
