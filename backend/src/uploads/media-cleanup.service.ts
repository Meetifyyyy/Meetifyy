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

    // Check if it's an external third-party domain (e.g. Unsplash, Giphy,
    // GitHub avatars, Google, DiceBear generated avatars).
    //
    // DiceBear is on this list because those URLs are genuinely stored as
    // `Media.objectKey` — an externally-hosted avatar still gets a row so the
    // `avatarMediaId` relation has something to point at, and three live
    // accounts use one today. They were already rejected below, but only
    // because the storage-key regex happens to fail on `://`. Naming them makes
    // the intent explicit rather than leaving a data shape this method handles
    // by accident.
    if (
      trimmed.includes('images.unsplash.com') ||
      trimmed.includes('media.giphy.com') ||
      trimmed.includes('giphy.com') ||
      trimmed.includes('avatars.githubusercontent.com') ||
      trimmed.includes('googleusercontent.com') ||
      trimmed.includes('api.dicebear.com')
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
   * The derived variants that travel with a storage key.
   *
   * The upload pipeline does not produce one file per image. For every folder
   * behind the six replaceable media types — avatars, profile-covers,
   * communities, community-icons, community-covers, groups, events — it also
   * uploads a `<key>_thumb.webp` that lists and grids render instead of the
   * full image. Cleanup that only knows about the primary key gets this wrong
   * in both directions at once:
   *
   *  - it leaves the OLD thumbnail behind on every replacement, and
   *  - the historical sweep, seeing a NEW thumbnail that no entity column
   *    mentions, deletes the file that was just uploaded.
   *
   * The second was the more damaging: it is not orphan accumulation but data
   * loss on the happy path, and it was live — six of thirteen entity images in
   * the bucket had no thumbnail, across user avatars, user covers, community
   * avatars, community covers and group avatars.
   *
   * Mirrors `deriveThumbnailKey` on the client, which decides where the variant
   * is written. Returns the key itself plus anything derived from it.
   */
  variantKeysFor(key: string | null | undefined): string[] {
    if (!key) return [];
    if (/_thumb\.[a-z0-9]+$/i.test(key)) return [key];
    const match = key.match(
      /^([a-z0-9_-]+)\/([A-Za-z0-9._-]+)\.(webp|jpe?g|png|gif|mp4|webm|ogv|mov)$/i,
    );
    if (!match) return [key];
    const [, folder, name] = match;
    return [key, `${folder}/${name}_thumb.webp`];
  }

  /**
   * Every key that must survive, given the keys an entity actively points at.
   * Expands each into its variant family so a fresh thumbnail is never mistaken
   * for a leftover.
   */
  activeKeyFamily(keys: (string | null | undefined)[]): Set<string> {
    const family = new Set<string>();
    for (const k of keys) {
      const normalized = this.extractStorageKey(k) ?? k ?? null;
      this.variantKeysFor(normalized).forEach((v) => family.add(v));
    }
    return family;
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

    // A thumbnail is alive exactly when the image it was derived from is alive.
    // Nothing stores a thumbnail key in an entity column — the client derives it
    // at render time — so asking about one directly always answered "not
    // referenced", and any sweep that reached it would delete a live entity's
    // thumbnail. Resolving it to its base is what makes that impossible,
    // whichever folder the sweep happened to be looking in.
    const thumbMatch = key.match(
      /^([a-z0-9_-]+)\/([A-Za-z0-9._-]+)_thumb\.[a-z0-9]+$/i,
    );
    if (thumbMatch) {
      const [, folder, name] = thumbMatch;
      for (const ext of ['webp', 'jpg', 'jpeg', 'png', 'gif', 'mp4', 'webm']) {
        if (await this.isKeyReferencedInDb(`${folder}/${name}.${ext}`, excludeScope)) {
          return true;
        }
      }
      return false;
    }

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

    // Search across Media relations (active posts, chat attachments), and
    // across verification documents.
    //
    // Verification is the one entity that references media by row id rather
    // than by storing a key in a column, so none of the checks above can see
    // it. No sweep reaches `verification/` today — `getFoldersForEntityType`
    // never returns it — but that is a property of the current callers, not of
    // this method, and this method is the thing every future caller will trust.
    // An identity document deleted out from under a pending review is not a
    // recoverable mistake.
    const mediaWithPostOrAttach = await this.prisma.media.findFirst({
      where: {
        objectKey: key,
        OR: [
          { postId: { not: null } },
          { messageAttachments: { some: {} } },
          { coverActivities: { some: { deletedAt: null } } },
          { campusEventPosters: { some: { deletedAt: null } } },
          { verificationSelfies: { some: {} } },
          { verificationIdCards: { some: {} } },
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

    // Delete the old key AND everything derived from it. The thumbnail is a
    // separate object with its own Media row; deleting only the primary left
    // one orphan behind on every single replacement, of every media type.
    //
    // Guarded against the case where the replacement reuses part of the old
    // family — re-uploading the same image, or a variant the new key also
    // claims — which must never delete what the entity now points at.
    const keepAlive = this.activeKeyFamily([newKey]);
    const oldFamily = this.variantKeysFor(oldKey).filter(
      (k) => !keepAlive.has(k),
    );

    for (const key of oldFamily) {
      try {
        const deleted = await this.storageProvider.delete(key);
        if (deleted) {
          result.deletedKeys.push(key);
          this.logger.log(
            `Successfully deleted replaced media from R2: ${key} (entity: ${entityType}/${entityId})`,
          );

          // Clean up database Media row if exists
          await this.prisma.media
            .deleteMany({
              where: { objectKey: key },
            })
            .catch(() => {});
        } else if (key === oldKey) {
          // A missing derived variant is unremarkable — not every upload
          // produces one, and a folder outside the thumbnail set never does.
          // A missing primary is worth reporting.
          result.errors.push({
            key,
            error: 'Storage provider delete returned false',
          });
        }
      } catch (err: any) {
        this.logger.error(
          `Failed to delete replaced media ${key} from R2: ${err?.message || err}`,
        );
        result.errors.push({ key, error: err?.message || String(err) });
        result.success = false;
        // Do not throw: DB update remains valid and active!
      }
    }

    // Also audit & clean up older unreferenced remnant files for this entity
    if (ownerId || entityId) {
      const effectiveOwner = ownerId || entityId;
      await this.cleanupEntityMediaHistory(
        entityType,
        entityId,
        // The family, not the bare key: passing only the primary is what made
        // the sweep below delete the thumbnail that had just been uploaded.
        Array.from(this.activeKeyFamily([newKey])),
        effectiveOwner,
      ).catch(() => {});
    }

    return result;
  }

  /**
   * The whole "media was replaced, tidy up after it" step, in one call.
   *
   * Every call site was repeating the same three-part guard before reaching
   * `handleMediaReplacement` — was this field even submitted, was there a
   * previous value, did it actually change — and then the same
   * `.catch(() => {})`. Seven copies of that across six services is exactly the
   * duplication that lets one of them quietly drift: miss the `!== undefined`
   * check and editing a display name deletes an avatar; miss the changed-check
   * and re-saving the same image deletes the image.
   *
   * Deliberately fire-and-forget and never throwing. It is called strictly
   * *after* the database update has succeeded, so a storage failure here must
   * leave the user's save intact — an orphaned file is a cost, a failed profile
   * update is a bug. Failures are logged by the methods underneath.
   *
   * `submitted` distinguishes "the caller did not touch this field" from "the
   * caller cleared it": only the latter should delete anything.
   */
  replaceEntityMedia(args: {
    entityType: ReplaceableEntityType;
    entityId: string;
    previous: string | null | undefined;
    next: string | null | undefined;
    ownerId?: string;
    submitted?: boolean;
  }): void {
    const { entityType, entityId, previous, next, ownerId } = args;
    const submitted = args.submitted !== false;

    if (!submitted) return;
    if (!previous) return;
    if (previous === next) return;

    void this.handleMediaReplacement(
      entityType,
      entityId,
      previous,
      next,
      ownerId,
    ).catch((err) => {
      this.logger.error(
        `Media replacement cleanup failed for ${entityType}/${entityId}: ${
          (err as Error)?.message || err
        }`,
      );
    });
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

    const folders = this.getFoldersForEntityType(entityType);
    if (folders.length === 0) return result;

    try {
      // Candidate Media rows owned by this user/entity in any folder this
      // media type is uploaded to.
      const candidates = await this.prisma.media.findMany({
        where: {
          ownerId,
          OR: folders.map((folder) => ({
            objectKey: { startsWith: `${folder}/` },
          })),
          postId: null,
        },
        select: { objectKey: true },
      });

      // Expanded here as well as at the call site, so a caller that passes only
      // primary keys still cannot cause a live thumbnail to be swept.
      const active = this.activeKeyFamily(activeKeys);

      for (const candidate of candidates) {
        const key = candidate.objectKey;

        // Skip active keys
        if (active.has(key)) {
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

  /**
   * Every storage folder a given media type actually lands in.
   *
   * Deliberately a list, because two of these have more than one and the
   * single-folder version quietly did nothing for them: a group avatar is
   * uploaded to `avatars/` (the chat details panel) while this returned
   * `groups/`, and a community avatar goes to `communities/` from the create
   * dialog but `community-icons/` from the editor. The historical sweep looked
   * in a folder those files were never in, so it always found nothing.
   *
   * Widening the sweep is only safe because `isKeyReferencedInDb` is the thing
   * that decides deletion, and it now resolves a thumbnail to its base — so a
   * group-avatar replacement scanning `avatars/` cannot take the owner's
   * profile picture, or its thumbnail, with it.
   */
  private getFoldersForEntityType(type: ReplaceableEntityType): string[] {
    switch (type) {
      case 'USER_AVATAR':
        return ['avatars'];
      case 'USER_COVER':
        return ['profile-covers'];
      case 'COMMUNITY_AVATAR':
        return ['community-icons', 'communities'];
      case 'COMMUNITY_COVER':
        return ['community-covers', 'communities'];
      case 'GROUP_AVATAR':
        return ['groups', 'avatars'];
      case 'ACTIVITY_COVER':
        return ['activities'];
      case 'CAMPUS_EVENT_POSTER':
        return ['events'];
      case 'COLLEGE_LOGO':
      case 'COLLEGE_BANNER':
        return ['colleges'];
      default:
        return [];
    }
  }
}
