import { Injectable, Inject, Logger } from '@nestjs/common';
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

  /**
   * Upload file securely (pass-through) and register Media.
   */
  async uploadFile(userId: string, file: Express.Multer.File, folder = 'general') {
    const ext = file.originalname.split('.').pop() || 'bin';
    const randomHex = require('crypto').randomBytes(16).toString('hex');
    const key = `${folder}/${randomHex}.${ext}`;

    await this.storageProvider.upload(key, file.buffer, file.mimetype);

    // Register media in database
    const media = await this.prisma.media.create({
      data: {
        ownerId: userId,
        objectKey: key,
        provider: this.providerName,
        bucket: this.bucketName,
        storageKey: key, // Legacy fallback
        type: file.mimetype.startsWith('video') ? 'VIDEO' : 'IMAGE', // Legacy fallback
        mimeType: file.mimetype,
        fileSize: file.size,
      },
    });

    // Provide a generic, provider-agnostic URL to the frontend
    const publicUrl = `/api/media/${key}`;

    return { publicUrl, key, mediaId: media.id, media };
  }

  getPublicUrl(key: string): string {
    return this.storageProvider.getPublicUrl(key);
  }

  async delete(key: string): Promise<boolean> {
    const deleted = await this.storageProvider.delete(key);
    if (deleted) {
      await this.prisma.media.deleteMany({ where: { objectKey: key } });
    }
    return deleted;
  }
}
