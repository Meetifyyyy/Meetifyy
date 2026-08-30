import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import type { StorageProvider } from './providers/storage-provider.interface';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { config } from '../config';
import { SUPPORT_ATTACHMENT_LIMITS } from '../support/support.constants';
import { sanitizeFilename, sniffMimeType } from './attachment-inspection.util';
import {
  MAX_COVERED_IMAGE_SIZE_BYTES,
  MAX_MEDIA_UPLOAD_SIZE_BYTES,
  COVERED_IMAGE_SIZE_ERROR_MESSAGE,
  isCoveredImageFolder,
} from './uploads.constants';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly providerName: string;
  private readonly bucketName: string;

  constructor(
    @Inject('STORAGE_PROVIDER') private storageProvider: StorageProvider,
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.providerName = config.storage.provider;
    this.bucketName =
      this.providerName === 'r2'
        ? config.storage.r2.bucketName
        : config.auth.supabase.bucketName;
  }

  isSafeStorageKey(key: string): boolean {
    return (
      typeof key === 'string' && /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/.test(key)
    );
  }

  async userOwnsMediaKey(key: string, userId: string): Promise<boolean> {
    if (!this.isSafeStorageKey(key)) return false;
    const media = await this.prisma.media.findUnique({
      where: { objectKey: key },
      select: { ownerId: true },
    });
    return media?.ownerId === userId;
  }

  /**
   * Upload file securely (pass-through) and register Media.
   */
  async uploadFile(
    userId: string,
    file: Express.Multer.File,
    folder = 'general',
  ) {
    const safeFolder = this.normalizeFolder(folder);
    if (
      isCoveredImageFolder(safeFolder) &&
      file.size > MAX_COVERED_IMAGE_SIZE_BYTES
    ) {
      throw new BadRequestException(COVERED_IMAGE_SIZE_ERROR_MESSAGE);
    }
    const ext = this.extensionForMime(file.mimetype);
    const randomHex = require('crypto').randomBytes(16).toString('hex');
    const key = `${safeFolder}/${randomHex}.${ext}`;

    await this.storageProvider.upload(key, file.buffer, file.mimetype);

    // Register media in database
    const media = await this.prisma.media.create({
      data: {
        ownerId: userId,
        objectKey: key,
        provider: this.providerName,
        bucket: this.bucketName,
        storageKey: key, // Legacy fallback
        type: file.mimetype.startsWith('video')
          ? 'VIDEO'
          : file.mimetype.startsWith('audio')
            ? 'AUDIO'
            : 'IMAGE', // Legacy fallback
        mimeType: file.mimetype,
        fileSize: file.size,
      },
    });

    // Provide a generic, provider-agnostic URL to the frontend
    const publicUrl = `/api/media/${key}`;

    return { publicUrl, key, mediaId: media.id, media };
  }

  /**
   * Generate a presigned URL for direct client upload and register Media.
   */
  async getPresignedUrl(
    userId: string,
    filename: string,
    contentType: string,
    folder = 'general',
    fileSize = 0,
    variantKey?: string,
    width?: number,
    height?: number,
    duration?: number,
  ) {
    const safeFolder = this.normalizeFolder(folder);
    if (typeof contentType !== 'string' || !this.isAllowedMimeType(contentType))
      throw new BadRequestException('Unsupported content type');
    const requestedFileSize = Number(fileSize || 0);
    const maxAllowedSize = isCoveredImageFolder(safeFolder)
      ? MAX_COVERED_IMAGE_SIZE_BYTES
      : MAX_MEDIA_UPLOAD_SIZE_BYTES;
    if (
      !Number.isFinite(requestedFileSize) ||
      requestedFileSize < 0 ||
      requestedFileSize > maxAllowedSize
    ) {
      if (
        isCoveredImageFolder(safeFolder) &&
        requestedFileSize > MAX_COVERED_IMAGE_SIZE_BYTES
      ) {
        throw new BadRequestException(COVERED_IMAGE_SIZE_ERROR_MESSAGE);
      }
      throw new BadRequestException('Invalid file size');
    }

    // A variant key lets the client upload a derived thumbnail sharing the
    // original's key base. Restrict it hard: safe pattern, an allowed folder,
    // and a `_thumb.<ext>` suffix so it can only ever be a thumbnail variant
    // (never an arbitrary object overwrite).
    let explicitKey: string | undefined;
    if (variantKey) {
      const [vFolder] = String(variantKey).split('/');
      if (
        !this.isSafeStorageKey(variantKey) ||
        vFolder !== safeFolder ||
        !/_thumb\.(webp|jpe?g|png)$/i.test(variantKey)
      ) {
        throw new BadRequestException('Invalid variant key');
      }
      explicitKey = variantKey;
    }

    const {
      uploadUrl,
      publicUrl: providerUrl,
      key,
    } = await this.storageProvider.createSignedUploadUrl(
      filename,
      contentType,
      safeFolder,
      undefined,
      explicitKey,
    );

    const mediaData = {
      ownerId: userId,
      objectKey: key,
      provider: this.providerName,
      bucket: this.bucketName,
      storageKey: key, // Legacy fallback
      type: contentType.startsWith('video')
        ? 'VIDEO'
        : contentType.startsWith('audio')
          ? 'AUDIO'
          : 'IMAGE', // Legacy fallback
      mimeType: contentType,
      fileSize: requestedFileSize,
      width: width ? Math.round(Number(width)) : undefined,
      height: height ? Math.round(Number(height)) : undefined,
      duration: duration ? Math.round(Number(duration)) : undefined,
    };

    // Register media in database (pending state). Variant (thumbnail) keys can be
    // re-requested on a retry, so upsert to stay idempotent on the unique objectKey.
    const media = explicitKey
      ? await this.prisma.media.upsert({
          where: { objectKey: key },
          create: mediaData,
          update: mediaData,
        })
      : await this.prisma.media.create({ data: mediaData });

    // Provide a generic, provider-agnostic URL to the frontend
    const publicUrl = `/api/media/${key}`;

    return { uploadUrl, publicUrl, key, mediaId: media.id, media };
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isSafeStorageKey(key)) return false;
    try {
      return await this.storageProvider.exists(key);
    } catch {
      return false;
    }
  }

  getPublicUrl(key: string): string {
    return this.storageProvider.getPublicUrl(key);
  }

  async getResolvedPublicUrl(key: string): Promise<string | null> {
    const media = await this.prisma.media.findUnique({
      where: { objectKey: key },
      select: { provider: true, bucket: true, objectKey: true },
    });

    if (media?.provider === 'supabase') {
      return this.getSupabasePublicUrl(media.bucket, media.objectKey);
    }

    // Default to active provider if no media record found or provider is r2
    return this.getPublicUrl(key);
  }

  private getSupabasePublicUrl(bucket: string, key: string): string {
    const supabaseUrl = config.auth.supabase.url;
    if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
      return `/mock-public/${key}`;
    }
    return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${bucket}/${key}`;
  }

  private signedUrlCache = new Map<
    string,
    { url: string; expiresAt: number }
  >();

  async getSignedUrls(
    keys: string[],
    expiresIn = 3600,
  ): Promise<{ [key: string]: string }> {
    if (!keys || keys.length === 0) return {};
    const now = Date.now();
    const result: { [key: string]: string } = {};
    const uncachedKeys: string[] = [];

    for (const key of keys) {
      const cached = this.signedUrlCache.get(key);
      if (cached && cached.expiresAt > now + 60000) {
        result[key] = cached.url;
      } else {
        uncachedKeys.push(key);
      }
    }

    if (uncachedKeys.length > 0) {
      const freshUrls = await this.storageProvider.createSignedUrls(
        uncachedKeys,
        expiresIn,
      );
      const cacheExpiresAt = now + Math.max(expiresIn - 60, 300) * 1000;
      for (const [key, url] of Object.entries(freshUrls)) {
        result[key] = url;
        this.signedUrlCache.set(key, { url, expiresAt: cacheExpiresAt });
      }
    }

    return result;
  }

  async getSignedUrlsForUser(
    keys: string[],
    expiresIn: number,
    userId: string,
  ) {
    if (!keys || keys.length === 0) return {};

    const media = await this.prisma.media.findMany({
      where: { objectKey: { in: keys } },
      select: {
        objectKey: true,
        ownerId: true,
        visibility: true,
        provider: true,
        bucket: true,
      },
    });

    const mediaMap = new Map(media.map((m) => [m.objectKey, m]));
    const result: { [key: string]: string } = {};
    const keysToSign: string[] = [];

    for (const key of keys) {
      const item = mediaMap.get(key);
      const isThumbnailKey = /_thumb\.[a-z0-9]+$/i.test(key);

      // If this is a derived thumbnail key and no media record exists, it was never created;
      // do not return a speculative 404 URL.
      if (!item && isThumbnailKey) {
        continue;
      }

      // Public media or unregistered non-thumbnail keys return public URL instantly (0ms network overhead)
      if (!item || item.visibility === 'public') {
        if (item?.provider === 'supabase') {
          result[key] = this.getSupabasePublicUrl(item.bucket, item.objectKey);
        } else {
          result[key] = this.getPublicUrl(key);
        }
      } else if (item.ownerId === userId) {
        keysToSign.push(key);
      }
    }

    if (keysToSign.length > 0) {
      const signed = await this.getSignedUrls(keysToSign, expiresIn);
      Object.assign(result, signed);
    }

    return result;
  }

  async confirmUpload(key: string, userId: string) {
    if (!this.isSafeStorageKey(key)) return null;
    const media = await this.prisma.media.findUnique({
      where: { objectKey: key },
    });
    if (media && media.ownerId !== userId) return null;
    if (!media) {
      // If no media record exists, it might have been an unmonitored upload, let's create it
      const exists = await this.storageProvider.exists(key);
      if (!exists) return null;
      return this.prisma.media.create({
        data: {
          ownerId: userId,
          objectKey: key,
          provider: this.providerName,
          bucket: this.bucketName,
          storageKey: key,
          mimeType: 'application/octet-stream',
          fileSize: 0,
        },
      });
    }

    // Best-effort existence verification for diagnostics only. R2 is eventually
    // consistent, so a transient miss right after PUT is normal — we log it but
    // never delete the row here (that would regress the working image path).
    this.storageProvider
      .exists(key)
      .then((present) => {
        if (!present) {
          this.logger.warn(
            `confirmUpload: object not yet visible in storage (key=${key}, owner=${userId})`,
          );
        } else {
          this.logger.log(
            `confirmUpload: verified object present (key=${key})`,
          );
        }
      })
      .catch(() => {});

    // Non-blocking background metadata synchronization
    this.storageProvider
      .getMetadata(key)
      .then((metadata) => {
        if (metadata && (metadata.contentLength || metadata.contentType)) {
          this.prisma.media
            .update({
              where: { id: media.id },
              data: {
                fileSize: metadata.contentLength || media.fileSize,
                mimeType: metadata.contentType || media.mimeType,
              },
            })
            .catch(() => {});
        }
      })
      .catch(() => {});

    return media;
  }

  private normalizeFolder(folder = 'general'): string {
    // 'activities' backs CrewActivity cover images. Folders are only key
    // prefixes within the single configured bucket, so adding one needs no
    // storage provisioning.
    //
    // 'community-icons' and 'community-covers' are what the community editor
    // has always sent. They were missing from this list, so every avatar or
    // cover change on an existing community was rejected with a 400 before a
    // byte was uploaded — the client reported it as a generic "Upload failed"
    // and the real reason never surfaced. (Creating a community happened to
    // work because that dialog posts to 'communities'.) They are kept as
    // separate prefixes rather than folded into 'communities' so icons and
    // covers stay distinguishable in storage, exactly as avatars and
    // profile-covers already are for users.
    const allowedFolders = [
      'avatars',
      'profile-covers',
      'communities',
      'community-icons',
      'community-covers',
      'posts',
      'chat',
      'groups',
      'voice',
      'temp',
      'general',
      'events',
      'activities',
      'defaults',
      // Support-request attachments. Owner-less (the submitter is usually not
      // logged in) and never listed publicly — reachable only through the
      // admin ticket view, which resolves the key itself.
      'support',
      'verification',
    ];
    if (!allowedFolders.includes(folder)) {
      throw new BadRequestException(
        `Invalid upload folder. Allowed: ${allowedFolders.join(', ')}`,
      );
    }
    return folder;
  }

  /**
   * Stores an attachment for an unauthenticated support request.
   *
   * Separate from `uploadFile` because that one requires an owning account and
   * the support form must work for someone who cannot log in. The resulting
   * Media row has a null owner, which — per the note on `Media.ownerId` — also
   * makes the ownership check that guards deletion refuse everyone.
   *
   * The declared mimetype is not trusted: it comes from the same untrusted
   * multipart body as the bytes. The magic number is checked against the
   * declared type and both must agree and both must be on the allow-list.
   */
  async uploadSupportAttachment(file: Express.Multer.File) {
    const allowed =
      SUPPORT_ATTACHMENT_LIMITS.allowedMimeTypes as readonly string[];

    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(
        'That file type is not supported. Attach a PNG, JPG, WEBP, GIF, PDF or TXT file.',
      );
    }
    if (file.size > SUPPORT_ATTACHMENT_LIMITS.maxBytesPerFile) {
      throw new BadRequestException(
        'That file is too large. Attachments must be 10 MB or smaller.',
      );
    }

    const sniffed = sniffMimeType(file.buffer);
    // text/plain has no signature to sniff, so it is accepted on the declared
    // type alone — it is also the one type on the list that cannot carry an
    // active payload.
    if (file.mimetype !== 'text/plain' && sniffed !== file.mimetype) {
      throw new BadRequestException(
        "That file's contents do not match its type.",
      );
    }

    const ext = this.extensionForMime(file.mimetype);
    const key = `support/${require('crypto').randomBytes(16).toString('hex')}.${ext}`;

    await this.storageProvider.upload(key, file.buffer, file.mimetype);

    const media = await this.prisma.media.create({
      data: {
        ownerId: null,
        objectKey: key,
        provider: this.providerName,
        bucket: this.bucketName,
        storageKey: key,
        type: file.mimetype.startsWith('image') ? 'IMAGE' : 'FILE',
        mimeType: file.mimetype,
        fileSize: file.size,
        visibility: 'private',
      },
    });

    return {
      key,
      mediaId: media.id,
      filename: sanitizeFilename(file.originalname),
      mimeType: file.mimetype,
      size: file.size,
    };
  }

  private isAllowedMimeType(contentType: string): boolean {
    return /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|ogg)|audio\/(mpeg|wav|webm|ogg))$/i.test(
      contentType,
    );
  }

  private extensionForMime(contentType: string): string {
    const extensions: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/ogg': 'ogv',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/webm': 'webm',
      'audio/ogg': 'oga',
      'application/pdf': 'pdf',
      'text/plain': 'txt',
    };
    return extensions[contentType.toLowerCase()] || 'bin';
  }

  async delete(key: string): Promise<boolean> {
    const deleted = await this.storageProvider.delete(key);
    if (deleted) {
      await this.prisma.media.deleteMany({ where: { objectKey: key } });
    }
    return deleted;
  }

  /**
   * Discard an orphaned upload: deletes the storage object + Media row ONLY when
   * it is owned by the caller AND not yet attached to a post. Used to clean up
   * after a post-creation failure so a successful upload never leaves an orphan.
   * Safe/idempotent — returns false without touching anything it doesn't own.
   */
  async discardOwnedUnattached(
    key: string,
    userId: string,
  ): Promise<{ discarded: boolean }> {
    if (!this.isSafeStorageKey(key)) return { discarded: false };
    const media = await this.prisma.media.findUnique({
      where: { objectKey: key },
      select: { id: true, ownerId: true, postId: true },
    });
    if (!media || media.ownerId !== userId || media.postId) {
      return { discarded: false };
    }
    await this.storageProvider.delete(key).catch(() => {});
    await this.prisma.media.deleteMany({
      where: { objectKey: key, ownerId: userId, postId: null },
    });
    this.logger.log(
      `discardOwnedUnattached: removed orphan media key=${key} owner=${userId}`,
    );
    return { discarded: true };
  }
}
