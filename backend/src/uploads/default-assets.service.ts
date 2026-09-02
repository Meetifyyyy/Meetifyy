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
 * Keys are deterministic and content-addressed by version, so re-deploying is
 * idempotent and a redesign is a one-line bump. The old object is left in the
 * bucket — anything still holding its URL keeps resolving — but records are
 * not left behind on it: `repointOutdatedDefaults` moves every row still
 * carrying a previous version's default onto the current one, so new art
 * reaches the people who never chose a picture, not just new sign-ups.
 */

/**
 * Bump when the artwork changes; old keys stay valid for existing rows.
 *
 * Covers are no longer managed here — they render as theme-aware empty states
 * via CSS (--empty-cover-bg). Only avatar defaults remain.
 *
 * Bumping this MOVES existing records onto the new artwork (see
 * `repointOutdatedDefaults`). Only rows the platform assigned a default are
 * touched; a picture anyone actually chose is never a `defaults/` key and so
 * can never match.
 */
const ASSET_VERSION = 'v2';

export type DefaultAssetName = 'community-avatar' | 'profile-avatar';

const ASSETS: DefaultAssetName[] = ['community-avatar', 'profile-avatar'];

/**
 * Resolves a default asset on disk.
 *
 * `__dirname` is `dist/uploads` in a built image but `src/uploads` under
 * ts-node, and the assets are not compiled — so walk up to the package root
 * and look there. Both candidates are tried rather than assuming a build
 * step copies them.
 */
export function defaultAssetFilePath(name: DefaultAssetName): string {
  const candidates = [
    path.join(__dirname, '..', '..', 'assets', 'defaults', `${name}.webp`),
    path.join(__dirname, '..', '..', '..', 'assets', 'defaults', `${name}.webp`),
    path.join(process.cwd(), 'assets', 'defaults', `${name}.webp`),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

/**
 * The bundled file backing a `defaults/` storage key, or null when the key is
 * not a current-version default asset.
 *
 * These four images ship inside the container, so answering for them from disk
 * is both correct and unconditional. Going out to the bucket for them instead
 * made the platform's own artwork depend on the longest chain in the system —
 * a `Media` row, its `visibility`, an R2 `HeadObject`, and a correctly
 * configured `R2_PUBLIC_URL` — and any one of those failing downgraded every
 * account that never chose a picture to the miss fallback. That is exactly what
 * production was doing: `defaults/profile-avatar-v2.webp` failed to resolve and
 * served the placeholder SVG, while `defaults/community-avatar-v2.webp`, an
 * identical object uploaded in the same run, resolved normally.
 *
 * Only the current version is served from disk. An older version's key belongs
 * to artwork this build no longer has, so it still goes to the bucket, where
 * the object it was uploaded as is retained.
 */
export function bundledDefaultAssetPath(key: string): string | null {
  for (const name of ASSETS) {
    if (key !== `defaults/${name}-${ASSET_VERSION}.webp`) continue;
    const filePath = defaultAssetFilePath(name);
    return fs.existsSync(filePath) ? filePath : null;
  }
  return null;
}

@Injectable()
export class DefaultAssetsService implements OnModuleInit {
  private readonly logger = new Logger(DefaultAssetsService.name);
  private readonly providerName: string;
  private readonly bucketName: string;

  /** name -> storage key, populated on boot. */
  private readonly keys = new Map<DefaultAssetName, string>();

  constructor(
    @Inject('STORAGE_PROVIDER')
    private readonly storageProvider: StorageProvider,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.providerName = this.config.get<string>('app.storageProvider') || 'r2';
    this.bucketName =
      this.config.get<string>('r2.bucketName') || 'meetifyy-dev';
  }

  async onModuleInit() {
    // Never block boot on storage. If the upload fails the keys stay empty
    // and callers fall back to null, which every consumer already handles —
    // a flaky bucket must not stop the API from starting.
    try {
      await this.ensureUploaded();
      await this.backfillExisting();
      await this.repointOutdatedDefaults();
    } catch (err: any) {
      if (err?.message?.includes('Cannot use a pool after calling end')) return;
      this.logger.error(
        `Could not publish default assets: ${(err as Error)?.message}`,
      );
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
    const isMissing = (field: string) =>
      ({
        OR: [{ [field]: null }, { [field]: '' }],
      }) as any;

    const communityAvatar = this.refFor('community-avatar');
    const profileAvatar = this.refFor('profile-avatar');

    const results: string[] = [];

    if (communityAvatar) {
      const { count } = await this.prisma.community.updateMany({
        where: isMissing('avatarKey'),
        data: { avatarKey: communityAvatar },
      });
      if (count) results.push(`${count} community avatars`);
    }
    if (profileAvatar) {
      const { count } = await this.prisma.user.updateMany({
        where: isMissing('avatar'),
        data: { avatar: profileAvatar },
      });
      if (count) results.push(`${count} profile avatars`);
    }

    if (results.length)
      this.logger.log(`Backfilled defaults: ${results.join(', ')}`);
  }

  /**
   * Moves records still carrying an OLDER version's default onto the current
   * one.
   *
   * Without this, bumping the version only reaches accounts created after the
   * deploy: everyone who never picked a cover keeps the ref they were assigned
   * on day one, so a redesign lands on nobody and the product shows two
   * generations of artwork side by side forever.
   *
   * What makes this safe to run against live rows is that a `defaults/` key is
   * never something a person chose. Uploads land under `covers/`, `avatars/`,
   * `community-covers/` and friends; only this service ever writes a
   * `defaults/` ref, and it writes it only where the field was empty. So
   * "starts with the prefix for this asset, and is not the current version" is
   * exactly the set of records displaying stale platform artwork, and nothing
   * else — a chosen picture cannot match the pattern however old it is.
   *
   * Idempotent: a second run matches nothing, because the first one already
   * moved every row onto the value it now compares against.
   */
  private async repointOutdatedDefaults(): Promise<void> {
    const results: string[] = [];

    const move = async (
      name: DefaultAssetName,
      field: string,
      updateMany: (args: {
        where: any;
        data: any;
      }) => Promise<{ count: number }>,
    ): Promise<void> => {
      const current = this.refFor(name);
      if (!current) return;

      const { count } = await updateMany({
        where: {
          AND: [
            {
              [field]: {
                startsWith: `/api/media/${this.storageKeyPrefix(name)}`,
              },
            },
            { NOT: { [field]: current } },
          ],
        },
        data: { [field]: current },
      });
      if (count) results.push(`${count} ${name}`);
    };

    // Avatars only — covers are now null/empty and handled by CSS.
    await move('profile-avatar', 'avatar', (args) =>
      this.prisma.user.updateMany(args),
    );
    await move('community-avatar', 'avatarKey', (args) =>
      this.prisma.community.updateMany(args),
    );

    if (results.length) {
      this.logger.log(
        `Moved onto ${ASSET_VERSION} defaults: ${results.join(', ')}`,
      );
    }
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

  /** Everything before the version — the part every generation of an asset
   *  shares, and therefore what identifies an outdated one. */
  private storageKeyPrefix(name: DefaultAssetName): string {
    return `defaults/${name}-`;
  }

  private storageKey(name: DefaultAssetName): string {
    return `${this.storageKeyPrefix(name)}${ASSET_VERSION}.webp`;
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
        const alreadyThere = await this.storageProvider
          .exists(key)
          .catch(() => false);

        if (!alreadyThere) {
          const filePath = this.assetPath(name);
          if (!fs.existsSync(filePath)) {
            this.logger.warn(`Default asset missing from disk: ${filePath}`);
            continue;
          }
          const buffer = fs.readFileSync(filePath);
          await this.storageProvider.upload(key, buffer, 'image/webp');
          this.logger.log(
            `Published default asset ${key} (${buffer.length} bytes)`,
          );
        }

        await this.registerMedia(name, key);
        this.keys.set(name, key);
      } catch (err) {
        this.logger.error(
          `Failed to publish default asset ${name}: ${(err as Error)?.message}`,
        );
      }
    }
  }

  /**
   * Registers the Media row that makes a default indistinguishable from an
   * upload. `ownerId` is deliberately null — these belong to no user, and
   * the ownership check that guards deletion therefore refuses everyone.
   */
  private async registerMedia(
    name: DefaultAssetName,
    key: string,
  ): Promise<void> {
    const dimensions = { width: 512, height: 512 };

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

  /** Resolves the asset on disk. See {@link defaultAssetFilePath}. */
  private assetPath(name: DefaultAssetName): string {
    return defaultAssetFilePath(name);
  }
}
