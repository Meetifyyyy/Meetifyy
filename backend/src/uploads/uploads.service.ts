import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import type { StorageProvider } from './providers/storage-provider.interface';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

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
    this.providerName = this.configService.get<string>('app.storageProvider') || 'supabase';
    this.bucketName = this.providerName === 'r2' 
      ? (this.configService.get<string>('r2.bucketName') || 'meetifyy-dev')
      : (this.configService.get<string>('supabase.bucketName') || 'meetifyy-dev');
  }

  isSafeStorageKey(key: string): boolean {
    return typeof key === 'string' && /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/.test(key);
  }

  async userOwnsMediaKey(key: string, userId: string): Promise<boolean> {
    if (!this.isSafeStorageKey(key)) return false;
    const media = await this.prisma.media.findUnique({ where: { objectKey: key }, select: { ownerId: true } });
    return media?.ownerId === userId;
  }

  /**
   * Upload file securely (pass-through) and register Media.
   */
  async uploadFile(userId: string, file: Express.Multer.File, folder = 'general') {
    const safeFolder = this.normalizeFolder(folder);
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
  ) {
    const safeFolder = this.normalizeFolder(folder);
    if (typeof contentType !== 'string' || !this.isAllowedMimeType(contentType)) throw new BadRequestException('Unsupported content type');
    const requestedFileSize = Number(fileSize || 0);
    if (!Number.isFinite(requestedFileSize) || requestedFileSize < 0 || requestedFileSize > 50 * 1024 * 1024) {
      throw new BadRequestException('Invalid file size');
    }
    const { uploadUrl, publicUrl: providerUrl, key } = await this.storageProvider.createSignedUploadUrl(
      filename,
      contentType,
      safeFolder,
    );

    // Register media in database (pending state)
    const media = await this.prisma.media.create({
      data: {
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
      },
    });

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
      select: { provider: true, bucket: true, objectKey: true }
    });

    if (media?.provider === 'supabase') {
      return this.getSupabasePublicUrl(media.bucket, media.objectKey);
    }
    
    // Default to active provider if no media record found or provider is r2
    return this.getPublicUrl(key);
  }

  private getSupabasePublicUrl(bucket: string, key: string): string {
    const supabaseUrl = this.configService.get<string>('supabase.url');
    if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
      return `/mock-public/${key}`;
    }
    return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${bucket}/${key}`;
  }

  private signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

  async getSignedUrls(keys: string[], expiresIn = 3600): Promise<{ [key: string]: string }> {
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
      const freshUrls = await this.storageProvider.createSignedUrls(uncachedKeys, expiresIn);
      const cacheExpiresAt = now + Math.max(expiresIn - 60, 300) * 1000;
      for (const [key, url] of Object.entries(freshUrls)) {
        result[key] = url;
        this.signedUrlCache.set(key, { url, expiresAt: cacheExpiresAt });
      }
    }

    return result;
  }

  async getSignedUrlsForUser(keys: string[], expiresIn: number, userId: string) {
    if (!keys || keys.length === 0) return {};

    const media = await this.prisma.media.findMany({
      where: { objectKey: { in: keys } },
      select: { objectKey: true, ownerId: true, visibility: true, provider: true, bucket: true },
    });

    const mediaMap = new Map(media.map((m) => [m.objectKey, m]));
    const result: { [key: string]: string } = {};
    const keysToSign: string[] = [];

    for (const key of keys) {
      const item = mediaMap.get(key);
      // Public media or unregistered keys return public URL instantly (0ms network overhead)
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
    const media = await this.prisma.media.findUnique({ where: { objectKey: key } });
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

    // Non-blocking background metadata synchronization
    this.storageProvider.getMetadata(key).then(metadata => {
      if (metadata && (metadata.contentLength || metadata.contentType)) {
        this.prisma.media.update({
          where: { id: media.id },
          data: {
            fileSize: metadata.contentLength || media.fileSize,
            mimeType: metadata.contentType || media.mimeType,
          }
        }).catch(() => {});
      }
    }).catch(() => {});

    return media;
  }

  private normalizeFolder(folder = 'general'): string {
    const allowedFolders = ['avatars', 'profile-covers', 'posts', 'communities', 'chat', 'groups', 'temp', 'general'];
    if (!allowedFolders.includes(folder)) {
      throw new BadRequestException(`Invalid upload folder. Allowed: ${allowedFolders.join(', ')}`);
    }
    return folder;
  }

  private isAllowedMimeType(contentType: string): boolean {
    return /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|ogg)|audio\/(mpeg|wav|webm|ogg))$/i.test(contentType);
  }

  private extensionForMime(contentType: string): string {
    const extensions: Record<string, string> = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
      'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogv',
      'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'oga',
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
}
