import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { StorageProvider } from './providers/storage-provider.interface';
import { config } from '../config';

export type ReplaceableEntityType =
  | 'USER_AVATAR'
  | 'USER_COVER'
  | 'COMMUNITY_AVATAR'
  | 'COMMUNITY_COVER'
  | 'GROUP_AVATAR'
  | 'ACTIVITY_COVER'
  | 'CAMPUS_EVENT_POSTER'
  | 'COLLEGE_LOGO'
  | 'COLLEGE_BANNER';

export interface CleanupResult {
  success: boolean;
  deletedKeys: string[];
  skippedKeys: { key: string; reason: string }[];
  errors: { key: string; error: string }[];
}

@Injectable()
export class MediaCleanupService {
  private readonly logger = new Logger(MediaCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('STORAGE_PROVIDER') private readonly storageProvider: StorageProvider,
  ) {}

  /**
   * Robustly extracts the canonical R2 storage key from any URL, path, or key string.
   * Returns null if the string is empty, external (e.g. unsplash/giphy), data URI, or blob URL.
   */
  extractStorageKey(urlOrKey: string | null | undefined): string | null {
    if (!urlOrKey || typeof urlOrKey !== 'string') return null;
    const trimmed = urlOrKey.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
      return null;
    }

    // Check if it's an external third-party domain (e.g. Unsplash, Giphy, GitHub avatars, Google)
    if (
      trimmed.includes('images.unsplash.com') ||
      trimmed.includes('media.giphy.com') ||
      trimmed.includes('giphy.com') ||
      trimmed.includes('avatars.githubusercontent.com') ||
      trimmed.includes('googleusercontent.com')
    ) {
      return null;
    }

    // Strip query parameters and hashes
    let clean = trimmed.split('?')[0].split('#')[0];

    // Strip API prefix (both relative and absolute origin forms)
    clean = clean.replace(/^https?:\/\/[^/]+\/api\/media\//i, '');
    if (clean.startsWith('/api/media/')) {
      clean = clean.replace('/api/media/', '');
    }

    // Strip full public origin URL if present (e.g. https://pub-8cd...r2.dev/...)
    const publicUrl = config.storage.publicUrl || config.storage.r2.publicUrl;
    if (publicUrl && clean.startsWith(publicUrl)) {
      clean = clean.substring(publicUrl.length).replace(/^\/+/, '');
    }

    // Match generic R2 pub domains or custom CDN
    const r2UrlPattern = /^https?:\/\/[a-zA-Z0-9.-]+\.r2\.dev\//i;
    clean = clean.replace(r2UrlPattern, '');

    const cdnPattern = /^https?:\/\/cdn\.meetifyy\.app\//i;
    clean = clean.replace(cdnPattern, '');

    const r2DomainPattern = /^https?:\/\/(?:r2|storage)\.meetifyy\.app\//i;
    clean = clean.replace(r2DomainPattern, '');

    // Match Supabase storage URL format if legacy: .../storage/v1/object/public/{bucket}/{key}
    const supabasePattern =
      /^https?:\/\/[a-zA-Z0-9.-]+\.supabase\.co\/storage\/v1\/object\/public\/[a-zA-Z0-9_-]+\//i;
    clean = clean.replace(supabasePattern, '');

    // Clean leading slashes
    clean = clean.replace(/^\/+/, '');

    // Validate storage key pattern: folder/filename.ext or nested folders
    if (!/^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9._-]+)+$/.test(clean)) {
      return null;
    }

    return clean;
  }

  /**
   * Guard: returns true if the key is a shared platform asset, default cover/avatar, or preset media.
   * These assets must NEVER be deleted.
   */
  isProtectedKey(key: string): boolean {
    if (!key) return true;
    const lower = key.toLowerCase();
    return (
      lower.startsWith('defaults/') ||
      lower.startsWith('v2-defaults/') ||
      lower.startsWith('presets/') ||
      lower.startsWith('system/') ||
      lower.startsWith('assets/') ||
      lower.startsWith('mock-') ||
      lower.startsWith('support/') ||
      lower.includes('preset-') ||
      lower.includes('default-')
    );
  }

  /**
   * Cross-checks all active database references across the entire application.
   * Returns true if the key is currently referenced anywhere.
   */
  async isKeyReferencedInDb(
    key: string,
    excludeScope?: { entityType: ReplaceableEntityType; entityId: string },
  ): Promise<boolean> {
    if (!key) return false;

    // Search across User avatar & cover with field-precise exclusion
    if (excludeScope?.entityType === 'USER_AVATAR') {
      const userRef = await this.prisma.user.findFirst({
        where: {
          OR: [
            { avatar: { contains: key }, id: { not: excludeScope.entityId } },
            { cover: { contains: key } },
          ],
        },
        select: { id: true },
      });
      if (userRef) return true;
    } else if (excludeScope?.entityType === 'USER_COVER') {
      const userRef = await this.prisma.user.findFirst({
        where: {
          OR: [
            { avatar: { contains: key } },
            { cover: { contains: key }, id: { not: excludeScope.entityId } },
          ],
        },
        select: { id: true },
      });
      if (userRef) return true;
    } else {
      const userRef = await this.prisma.user.findFirst({
        where: {
          OR: [{ avatar: { contains: key } }, { cover: { contains: key } }],
        },
        select: { id: true },
      });
      if (userRef) return true;
    }

    // Search across Community avatar & cover with field-precise exclusion
    if (excludeScope?.entityType === 'COMMUNITY_AVATAR') {
      const communityRef = await this.prisma.community.findFirst({
        where: {
          OR: [
            { avatarKey: { contains: key }, id: { not: excludeScope.entityId } },
            { coverKey: { contains: key } },
          ],
          deletedAt: null,
        },
        select: { id: true },
      });
      if (communityRef) return true;
    } else if (excludeScope?.entityType === 'COMMUNITY_COVER') {
      const communityRef = await this.prisma.community.findFirst({
        where: {
          OR: [
            { avatarKey: { contains: key } },
            { coverKey: { contains: key }, id: { not: excludeScope.entityId } },
          ],
          deletedAt: null,
        },
        select: { id: true },
      });
      if (communityRef) return true;
    } else {
      const communityRef = await this.prisma.community.findFirst({
        where: {
          OR: [{ avatarKey: { contains: key } }, { coverKey: { contains: key } }],
          deletedAt: null,
        },
        select: { id: true },
      });
      if (communityRef) return true;
    }

    // Search across Conversation / Group avatar
    const convRef = await this.prisma.conversation.findFirst({
      where: {
        avatarKey: { contains: key },
        ...(excludeScope?.entityType === 'GROUP_AVATAR'
          ? { id: { not: excludeScope.entityId } }
          : {}),
      },
      select: { id: true },
    });
    if (convRef) return true;

    // Search across CrewActivity coverImage
    const activityRef = await this.prisma.crewActivity.findFirst({
      where: {
        coverImage: { contains: key },
        deletedAt: null,
        ...(excludeScope?.entityType === 'ACTIVITY_COVER'
          ? { id: { not: excludeScope.entityId } }
          : {}),
      },
      select: { id: true },
    });
    if (activityRef) return true;

    // Search across CampusEvent posterUrl
    const eventRef = await this.prisma.campusEvent.findFirst({
      where: {
        posterUrl: { contains: key },
        deletedAt: null,
        ...(excludeScope?.entityType === 'CAMPUS_EVENT_POSTER'
          ? { id: { not: excludeScope.entityId } }
          : {}),
      },
      select: { id: true },
    });
    if (eventRef) return true;

    // Search across College logoKey & bannerKey with field-precise exclusion
    if (excludeScope?.entityType === 'COLLEGE_LOGO') {
      const collegeRef = await this.prisma.college.findFirst({
        where: {
          OR: [
            { logoKey: { contains: key }, id: { not: excludeScope.entityId } },
            { bannerKey: { contains: key } },
          ],
        },
        select: { id: true },
      });
      if (collegeRef) return true;
    } else if (excludeScope?.entityType === 'COLLEGE_BANNER') {
      const collegeRef = await this.prisma.college.findFirst({
        where: {
          OR: [
            { logoKey: { contains: key } },
            { bannerKey: { contains: key }, id: { not: excludeScope.entityId } },
          ],
        },
        select: { id: true },
      });
      if (collegeRef) return true;
    } else {
      const collegeRef = await this.prisma.college.findFirst({
        where: {
          OR: [{ logoKey: { contains: key } }, { bannerKey: { contains: key } }],
        },
        select: { id: true },
      });
      if (collegeRef) return true;
    }

    // Search across Media relations (active posts, chat attachments)
    const mediaWithPostOrAttach = await this.prisma.media.findFirst({
      where: {
        objectKey: key,
        OR: [
          { postId: { not: null } },
          { messageAttachments: { some: {} } },
          { coverActivities: { some: { deletedAt: null } } },
          { campusEventPosters: { some: { deletedAt: null } } },
        ],
      },
      select: { id: true },
    });
    if (mediaWithPostOrAttach) return true;

    return false;
  }

  /**
   * Safely handles replacing media for an entity.
   * Called strictly AFTER the new upload and database update have succeeded.
   */
  async handleMediaReplacement(
    entityType: ReplaceableEntityType,
    entityId: string,
    oldMediaRef: string | null | undefined,
    newMediaRef: string | null | undefined,
    ownerId?: string,
  ): Promise<CleanupResult> {
    const result: CleanupResult = {
      success: true,
      deletedKeys: [],
      skippedKeys: [],
      errors: [],
    };

    const oldKey = this.extractStorageKey(oldMediaRef);
    const newKey = this.extractStorageKey(newMediaRef);

    // If there was no old key or the key didn't change, nothing to delete
    if (!oldKey || oldKey === newKey) {
      if (oldKey === newKey && oldKey) {
        result.skippedKeys.push({ key: oldKey, reason: 'Key unchanged' });
      }
      return result;
    }

    // Check if the old key is a protected system/default/preset asset
    if (this.isProtectedKey(oldKey)) {
      result.skippedKeys.push({
        key: oldKey,
        reason: 'Protected system/default/preset asset',
      });
      this.logger.log(
        `Skipping deletion of protected key: ${oldKey} (entity: ${entityType}/${entityId})`,
      );
      return result;
    }

    // Check if the old key is still referenced elsewhere in the database
    const isReferenced = await this.isKeyReferencedInDb(oldKey, {
      entityType,
      entityId,
    });
    if (isReferenced) {
      result.skippedKeys.push({
        key: oldKey,
        reason: 'Key is still actively referenced elsewhere in database',
      });
      this.logger.log(`Skipping deletion of shared/referenced key: ${oldKey}`);
      return result;
    }

    // Safe to delete from R2
    try {
      const deleted = await this.storageProvider.delete(oldKey);
      if (deleted) {
        result.deletedKeys.push(oldKey);
        this.logger.log(
          `Successfully deleted replaced media from R2: ${oldKey} (entity: ${entityType}/${entityId})`,
        );

        // Clean up database Media row if exists
        await this.prisma.media
          .deleteMany({
            where: { objectKey: oldKey },
          })
          .catch(() => {});
      } else {
        result.errors.push({
          key: oldKey,
          error: 'Storage provider delete returned false',
        });
      }
    } catch (err: any) {
      this.logger.error(
        `Failed to delete replaced media ${oldKey} from R2: ${err?.message || err}`,
      );
      result.errors.push({ key: oldKey, error: err?.message || String(err) });
      result.success = false;
      // Do not throw: DB update remains valid and active!
    }

    // Also audit & clean up older unreferenced remnant files for this entity
    if (ownerId || entityId) {
      const effectiveOwner = ownerId || entityId;
      await this.cleanupEntityMediaHistory(
        entityType,
        entityId,
        [newKey].filter(Boolean) as string[],
        effectiveOwner,
      ).catch(() => {});
    }

    return result;
  }

  /**
   * Audits and removes previous remnant files for the same entity and media type
   * that are no longer referenced or actively used anywhere.
   */
  async cleanupEntityMediaHistory(
    entityType: ReplaceableEntityType,
    entityId: string,
    activeKeys: string[],
    ownerId: string,
  ): Promise<CleanupResult> {
    const result: CleanupResult = {
      success: true,
      deletedKeys: [],
      skippedKeys: [],
      errors: [],
    };

    if (!ownerId) return result;

    const folder = this.getFolderForEntityType(entityType);
    if (!folder) return result;

    try {
      // Find candidate Media rows owned by this user/entity in this folder
      const candidates = await this.prisma.media.findMany({
        where: {
          ownerId,
          objectKey: { startsWith: `${folder}/` },
          postId: null,
        },
        select: { objectKey: true },
      });

      for (const candidate of candidates) {
        const key = candidate.objectKey;

        // Skip active keys
        if (activeKeys.includes(key)) {
          result.skippedKeys.push({
            key,
            reason: 'Currently active media key',
          });
          continue;
        }

        // Skip protected assets
        if (this.isProtectedKey(key)) {
          result.skippedKeys.push({
            key,
            reason: 'Protected system/default asset',
          });
          continue;
        }

        // Check if referenced elsewhere
        const isReferenced = await this.isKeyReferencedInDb(key);
        if (isReferenced) {
          result.skippedKeys.push({
            key,
            reason: 'Referenced elsewhere in database',
          });
          continue;
        }

        // Confirmed unused -> delete from R2 and delete Media row
        try {
          await this.storageProvider.delete(key);
          await this.prisma.media.deleteMany({ where: { objectKey: key } });
          result.deletedKeys.push(key);
          this.logger.log(
            `Cleaned up historical unreferenced media: ${key} (owner: ${ownerId})`,
          );
        } catch (err: any) {
          result.errors.push({ key, error: err?.message || String(err) });
        }
      }
    } catch (e: any) {
      this.logger.warn(
        `Historical media cleanup failed for owner ${ownerId}: ${e?.message || e}`,
      );
    }

    return result;
  }

  /**
   * Helper to clean up newly uploaded file if subsequent DB update fails.
   */
  async discardFailedNewUpload(
    newKeyOrUrl: string | null | undefined,
    userId?: string,
  ): Promise<boolean> {
    const key = this.extractStorageKey(newKeyOrUrl);
    if (!key || this.isProtectedKey(key)) return false;

    try {
      await this.storageProvider.delete(key);
      if (userId) {
        await this.prisma.media.deleteMany({
          where: { objectKey: key, ownerId: userId, postId: null },
        });
      } else {
        await this.prisma.media.deleteMany({
          where: { objectKey: key, postId: null },
        });
      }
      this.logger.log(`Discarded failed new upload from R2: ${key}`);
      return true;
    } catch (err: any) {
      this.logger.warn(
        `Failed to discard unattached upload ${key}: ${err?.message || err}`,
      );
      return false;
    }
  }

  /**
   * Dedicated permanent deletion of a storage object and its Media database record.
   * Ensures that the database Media row is removed ONLY AFTER physical R2 deletion succeeds.
   * If R2 deletion fails, the Media row is preserved so the cleanup can be retried.
   */
  async deletePermanently(
    keyOrUrl: string | null | undefined,
    excludeScope?: { entityType: ReplaceableEntityType; entityId: string },
  ): Promise<{
    success: boolean;
    key?: string;
    error?: string;
    skipped?: boolean;
    reason?: string;
  }> {
    const key = this.extractStorageKey(keyOrUrl);
    if (!key) {
      return { success: false, skipped: true, reason: 'Invalid or external key' };
    }

    if (this.isProtectedKey(key)) {
      this.logger.log(`deletePermanently: skipping protected key ${key}`);
      return {
        success: false,
        skipped: true,
        reason: 'Protected platform asset',
      };
    }

    const isReferenced = await this.isKeyReferencedInDb(key, excludeScope);
    if (isReferenced) {
      this.logger.log(
        `deletePermanently: key ${key} is still referenced elsewhere in DB`,
      );
      return {
        success: false,
        skipped: true,
        reason: 'Referenced elsewhere in DB',
      };
    }

    try {
      const deleted = await this.storageProvider.delete(key);
      if (deleted) {
        await this.prisma.media
          .deleteMany({ where: { objectKey: key } })
          .catch(() => {});
        this.logger.log(
          `deletePermanently: successfully deleted ${key} from R2 and DB`,
        );
        return { success: true, key };
      } else {
        this.logger.warn(
          `deletePermanently: storage provider delete returned false for ${key}`,
        );
        return {
          success: false,
          key,
          error: 'Storage provider delete returned false',
        };
      }
    } catch (err: any) {
      this.logger.error(
        `deletePermanently: failed to delete ${key} from R2: ${err?.message || err}`,
      );
      return { success: false, key, error: err?.message || String(err) };
    }
  }

  /**
   * Deletes multiple media objects permanently.
   */
  async deleteEntityMedia(
    keysOrUrls: (string | null | undefined)[],
  ): Promise<CleanupResult> {
    const result: CleanupResult = {
      success: true,
      deletedKeys: [],
      skippedKeys: [],
      errors: [],
    };

    for (const item of keysOrUrls) {
      const outcome = await this.deletePermanently(item);
      if (outcome.success && outcome.key) {
        result.deletedKeys.push(outcome.key);
      } else if (outcome.skipped && outcome.reason) {
        result.skippedKeys.push({
          key: outcome.key || String(item),
          reason: outcome.reason,
        });
      } else if (outcome.error) {
        result.errors.push({
          key: outcome.key || String(item),
          error: outcome.error,
        });
        result.success = false;
      }
    }

    return result;
  }

  /**
   * Asynchronously queues media deletion with retry capability.
   * If R2 is temporarily down, retries up to 3 times with exponential backoff.
   * Pending Media rows remain in the DB if all retries fail, ensuring no untracked orphans.
   */
  async queueMediaDeletion(
    keysOrUrls: (string | null | undefined)[],
  ): Promise<void> {
    const validKeys = keysOrUrls
      .map((k) => this.extractStorageKey(k))
      .filter((k): k is string => Boolean(k && !this.isProtectedKey(k)));

    if (validKeys.length === 0) return;

    setImmediate(async () => {
      let pending = [...validKeys];
      for (let attempt = 1; attempt <= 3 && pending.length > 0; attempt++) {
        const nextPending: string[] = [];
        for (const key of pending) {
          const res = await this.deletePermanently(key);
          if (!res.success && !res.skipped) {
            nextPending.push(key);
          }
        }
        pending = nextPending;
        if (pending.length > 0 && attempt < 3) {
          const delayMs = attempt * 2000;
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      if (pending.length > 0) {
        this.logger.error(
          `queueMediaDeletion: exhausted retries for ${pending.length} media keys: ${pending.join(', ')} (Media rows preserved in DB for recovery)`,
        );
      }
    });
  }

  private getFolderForEntityType(type: ReplaceableEntityType): string | null {
    switch (type) {
      case 'USER_AVATAR':
        return 'avatars';
      case 'USER_COVER':
        return 'profile-covers';
      case 'COMMUNITY_AVATAR':
        return 'community-icons';
      case 'COMMUNITY_COVER':
        return 'community-covers';
      case 'GROUP_AVATAR':
        return 'groups';
      case 'ACTIVITY_COVER':
        return 'activities';
      case 'CAMPUS_EVENT_POSTER':
        return 'events';
      case 'COLLEGE_LOGO':
      case 'COLLEGE_BANNER':
        return 'colleges';
      default:
        return null;
    }
  }
}
