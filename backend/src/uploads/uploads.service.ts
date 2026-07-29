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
    const requestedFileSize = Number(fileSize);
    if (!Number.isFinite(requestedFileSize) || requestedFileSize < 0 || requestedFileSize > 25 * 1024 * 1024) {
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

  getPublicUrl(key: string): string {
    return this.storageProvider.getPublicUrl(key);
  }

  async getSignedUrls(keys: string[], expiresIn = 3600): Promise<{ [key: string]: string }> {
    if (!keys || keys.length === 0) return {};
    return this.storageProvider.createSignedUrls(keys, expiresIn);
  }

  async getSignedUrlsForUser(keys: string[], expiresIn: number, userId: string) {
    const media = await this.prisma.media.findMany({
      where: { objectKey: { in: keys } },
      select: { objectKey: true, ownerId: true, visibility: true },
    });
    const allowedKeys = media.filter((item) => item.visibility === 'public' || item.ownerId === userId).map((item) => item.objectKey);
    return this.getSignedUrls(allowedKeys, expiresIn);
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

    // Optionally update metadata if we can get it from storage provider
    const metadata = await this.storageProvider.getMetadata(key);
    
    return this.prisma.media.update({
      where: { id: media.id },
      data: {
        fileSize: metadata?.contentLength || media.fileSize,
        mimeType: metadata?.contentType || media.mimeType,
      }
    });
  }

  private normalizeFolder(folder = 'general'): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(folder)) throw new Error('Invalid upload folder');
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
