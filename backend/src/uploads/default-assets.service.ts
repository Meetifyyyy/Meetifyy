import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import type { StorageProvider } from './providers/storage-provider.interface';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The four default images every user and community starts with.
 *
 * These are real WebP files (see `assets/defaults/`, regenerable with the
 * `generate.py` beside them), uploaded into the same bucket as any other
 * image and registered as Media rows. That is the whole point: a default
 * cover has to *be* an image, stored and referenced like one, so it flows
 * through every avatar/cover code path unchanged — the CDN, the derived
 * thumbnail, the `/api/media/` resolver, the crop-and-replace editor. A
 * CSS gradient behind an empty `src` would have needed a special case at
 * every one of those points, and would have been the thing that broke the
 * next time someone touched image handling.
 *
 * Keys are deterministic and content-addressed by version, so re-deploying
 * is idempotent and a redesign is a one-line bump that leaves the old asset
 * untouched for records still pointing at it.
 */

/** Bump when the artwork changes; old keys stay valid for existing rows. */
const ASSET_VERSION = 'v1';

export type DefaultAssetName =
  | 'community-cover'
  | 'profile-cover'
  | 'community-avatar'
  | 'profile-avatar';

const ASSETS: DefaultAssetName[] = [
  'community-cover',
  'profile-cover',
  'community-avatar',
  'profile-avatar',
];

@Injectable()
export class DefaultAssetsService implements OnModuleInit {
  private readonly logger = new Logger(DefaultAssetsService.name);
  private readonly providerName: string;
  private readonly bucketName: string;

  /** name -> storage key, populated on boot. */
  private readonly keys = new Map<DefaultAssetName, string>();

  constructor(
    @Inject('STORAGE_PROVIDER') private readonly storageProvider: StorageProvider,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.providerName = this.config.get<string>('app.storageProvider') || 'supabase';
    this.bucketName =
      this.providerName === 'r2'
        ? this.config.get<string>('r2.bucketName') || 'meetifyy-dev'
        : this.config.get<string>('supabase.bucketName') || 'meetifyy-dev';
  }

  async onModuleInit() {
    // Never block boot on storage. If the upload fails the keys stay empty
    // and callers fall back to null, which every consumer already handles —
    // a flaky bucket must not stop the API from starting.
    try {
      await this.ensureUploaded();
      await this.backfillExisting();
    } catch (err) {
      this.logger.error(`Could not publish default assets: ${(err as Error)?.message}`);
    }
  }

  /**
   * Gives records created before this feature the same stored defaults new
   * ones get.
   *
   * Done here rather than in a migration because the storage keys are not
   * known until the assets are published — a migration cannot upload to the
   * bucket. Only rows with a genuinely absent image are touched: an empty
   * string counts as absent (older code wrote those), but anything a user
   * chose is left exactly as it is.
   *
   * Runs on every boot and is naturally idempotent, since a row it has
   * already filled no longer matches.
   */
  private async backfillExisting(): Promise<void> {
    // `{ in: [null, ''] }` looks like it matches both, and does not. Prisma
    // compiles it to `IN (NULL, '')`, and SQL's three-valued logic means
    // `x = NULL` is never true — so a NULL column never matched and the
    // backfill silently updated nothing at all. An explicit OR is the only
    // form that catches both.
    const isMissing = (field: string) => ({
      OR: [{ [field]: null }, { [field]: '' }],
    }) as any;

    const communityAvatar = this.refFor('community-avatar');
    const communityCover = this.refFor('community-cover');
    const profileAvatar = this.refFor('profile-avatar');
    const profileCover = this.refFor('profile-cover');

    const results: string[] = [];

    if (communityAvatar) {
      const { count } = await this.prisma.community.updateMany({
        where: isMissing('avatarKey'),
        data: { avatarKey: communityAvatar },
      });
      if (count) results.push(`${count} community avatars`);
    }
    if (communityCover) {
      const { count } = await this.prisma.community.updateMany({
        where: isMissing('coverKey'),
        data: { coverKey: communityCover },
      });
      if (count) results.push(`${count} community covers`);
    }
    if (profileAvatar) {
      const { count } = await this.prisma.user.updateMany({
        where: isMissing('avatar'),
        data: { avatar: profileAvatar },
      });
      if (count) results.push(`${count} profile avatars`);
    }
    if (profileCover) {
      const { count } = await this.prisma.user.updateMany({
        where: isMissing('cover'),
        data: { cover: profileCover },
      });
      if (count) results.push(`${count} profile covers`);
    }

    if (results.length) this.logger.log(`Backfilled defaults: ${results.join(', ')}`);
  }

  /** The storage key for a default, or null if it could not be published. */
  keyFor(name: DefaultAssetName): string | null {
    return this.keys.get(name) ?? null;
  }

  /** The reference stored on a User/Community row — the same `/api/media/`
   *  shape an uploaded image gets, so nothing downstream can tell them apart. */
  refFor(name: DefaultAssetName): string | null {
    const key = this.keyFor(name);
    return key ? `/api/media/${key}` : null;
  }

  private storageKey(name: DefaultAssetName): string {
    return `defaults/${name}-${ASSET_VERSION}.webp`;
  }

  /**
   * Uploads any default missing from storage and registers its Media row.
   * Idempotent: an existing object is left alone, so this is safe to run on
   * every boot and on every replica.
   */
  async ensureUploaded(): Promise<void> {
    for (const name of ASSETS) {
      const key = this.storageKey(name);
      try {
        const alreadyThere = await this.storageProvider.exists(key).catch(() => false);

        if (!alreadyThere) {
          const filePath = this.assetPath(name);
          if (!fs.existsSync(filePath)) {
            this.logger.warn(`Default asset missing from disk: ${filePath}`);
            continue;
          }
          const buffer = fs.readFileSync(filePath);
          await this.storageProvider.upload(key, buffer, 'image/webp');
          this.logger.log(`Published default asset ${key} (${buffer.length} bytes)`);
        }

        await this.registerMedia(name, key);
        this.keys.set(name, key);
      } catch (err) {
        this.logger.error(`Failed to publish default asset ${name}: ${(err as Error)?.message}`);
      }
    }
  }

  /**
   * Registers the Media row that makes a default indistinguishable from an
   * upload. `ownerId` is deliberately null — these belong to no user, and
   * the ownership check that guards deletion therefore refuses everyone.
   */
  private async registerMedia(name: DefaultAssetName, key: string): Promise<void> {
    const dimensions = name.endsWith('cover')
      ? { width: 1600, height: 400 }
      : { width: 512, height: 512 };

    const data = {
      objectKey: key,
      provider: this.providerName,
      bucket: this.bucketName,
      storageKey: key,
      type: 'IMAGE' as const,
      mimeType: 'image/webp',
      fileSize: this.fileSize(name),
      ...dimensions,
    };

    await this.prisma.media.upsert({
      where: { objectKey: key },
      create: data,
      update: { bucket: this.bucketName, provider: this.providerName },
    });
  }

  private fileSize(name: DefaultAssetName): number {
    try {
      return fs.statSync(this.assetPath(name)).size;
    } catch {
      return 0;
    }
  }

  /**
   * Resolves the asset on disk.
   *
   * `__dirname` is `dist/uploads` in a built image but `src/uploads` under
   * ts-node, and the assets are not compiled — so walk up to the package root
   * and look there. Both candidates are tried rather than assuming a build
   * step copies them.
   */
  private assetPath(name: DefaultAssetName): string {
    const candidates = [
      path.join(__dirname, '..', '..', 'assets', 'defaults', `${name}.webp`),
      path.join(__dirname, '..', '..', '..', 'assets', 'defaults', `${name}.webp`),
      path.join(process.cwd(), 'assets', 'defaults', `${name}.webp`),
    ];
    return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
  }
}
