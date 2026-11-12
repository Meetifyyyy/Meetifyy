import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { errorMessage } from '../common/utils/error.util';
import { CloudflareR2Provider } from './providers/cloudflare-r2.provider';
import {
  relocatePrivateMedia,
  type RelocationReport,
} from './private-media-relocation';

/** Held for the whole run; long enough for a capped batch, short enough to self-heal. */
export const PRIVATE_MEDIA_LOCK_KEY = 'private-media-relocation';
export const PRIVATE_MEDIA_LOCK_TTL_MS = 30 * 60 * 1000;

interface RelocationSettings {
  isTest: boolean;
  storage: {
    provider: string;
    r2: { bucketName: string; verificationBucketName: string };
  };
}

/**
 * Whether this process should register the janitor at all.
 *
 * Only for R2, and only when a private bucket exists and is not the main one:
 * with one bucket there is nowhere to move to. Not under Jest, where nothing
 * should open a Redis or storage connection at boot.
 */
export function shouldRunPrivateMediaRelocation(
  settings: RelocationSettings,
): boolean {
  const { provider, r2 } = settings.storage;
  return (
    !settings.isTest &&
    provider === 'r2' &&
    r2.verificationBucketName !== '' &&
    r2.verificationBucketName !== r2.bucketName
  );
}

/**
 * Moves conversation, voice, support and verification objects that were stored
 * in the main (public) bucket before their prefix was routed to the private one.
 *
 * It runs on every boot in the background and is idempotent: once the backlog
 * is gone, a boot costs one empty listing per prefix. A Redis lock lets only
 * one replica work at a time; the others skip. Running inside the API means
 * each environment cleans itself with its own credentials, so nobody has to
 * hold production keys to do it.
 *
 * Only counts are logged — an object key must never reach a log.
 */
@Injectable()
export class PrivateMediaJanitor implements OnApplicationBootstrap {
  private readonly logger = new Logger(PrivateMediaJanitor.name);

  constructor(
    @Inject('STORAGE_PROVIDER') private readonly storage: CloudflareR2Provider,
    private readonly redis: RedisService,
  ) {}

  onApplicationBootstrap(): void {
    // Fire-and-forget on purpose: listing and copying are many round trips to
    // storage, and boot (and the health check behind it) must not wait for
    // housekeeping. run() never rejects.
    void this.run();
  }

  /** One locked pass. Never throws. */
  async run(): Promise<void> {
    try {
      const target = this.storage.getRelocationTarget();
      if (!target) return;

      const outcome = await this.redis.runIfLockFree(
        PRIVATE_MEDIA_LOCK_KEY,
        PRIVATE_MEDIA_LOCK_TTL_MS,
        () =>
          relocatePrivateMedia(target, {
            apply: true,
            // The object has left the bucket this replica may have cached.
            onRelocated: (key) => this.storage.forgetReadBucket(key),
          }),
      );
      // Another replica is on it.
      if (!outcome.ran) return;

      this.report(outcome.value);
    } catch (err) {
      // A failed pass leaves the objects where they are for the next boot. It
      // must never be a failed boot.
      this.logger.warn(
        `private media relocation stopped: ${errorMessage(err)}`,
      );
    }
  }

  private report({ total, byPrefix, capped, errors }: RelocationReport): void {
    if (total.scanned === 0 && total.failed === 0) return;
    const line = `private.media.relocation ${JSON.stringify({ total, byPrefix, capped, errors })}`;
    if (total.failed > 0) this.logger.warn(line);
    else this.logger.log(line);
  }
}
