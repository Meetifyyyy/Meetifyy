import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { StorageProvider } from './storage-provider.interface';

@Injectable()
export class CloudflareR2Provider implements StorageProvider {
  private readonly logger = new Logger(CloudflareR2Provider.name);
  private s3: S3Client | null = null;
  private bucketName: string;
  private publicUrl: string;
  private readonly isConfigured: boolean;

  constructor(private configService: ConfigService) {
    const accountId = this.configService.get<string>('r2.accountId');
    const accessKeyId = this.configService.get<string>('r2.accessKeyId');
    const secretAccessKey = this.configService.get<string>('r2.secretAccessKey');
    this.bucketName = this.configService.get<string>('r2.bucketName') || 'meetifyy-dev';
    this.publicUrl = this.configService.get<string>('r2.publicUrl') || '';

    this.isConfigured =
      !!(accountId && accessKeyId && secretAccessKey &&
        accountId !== '' && accessKeyId !== '' && secretAccessKey !== '');

    if (this.isConfigured) {
      this.s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
        // AWS SDK v3 (>= 3.729) can add default integrity checksums as SIGNED
        // headers on PutObject, including in presigned URLs — headers a browser
        // PUT cannot reproduce. WHEN_REQUIRED keeps presigned browser uploads to
        // R2 signature-compatible (verified working against this bucket).
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
      this.logger.log('Cloudflare R2 configured');
    }
  }

  private getLocalFilePath(key: string): string {
    const cwd = process.cwd();
    const baseDir = cwd.endsWith('backend') ? path.join(cwd, 'uploads') : path.join(cwd, 'backend', 'uploads');
    return path.resolve(baseDir, key);
  }

  private saveToLocalDisk(key: string, fileBuffer: Buffer): void {
    try {
      const filePath = this.getLocalFilePath(key);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, fileBuffer);
    } catch (e) {
      this.logger.error(`Failed to save file to local disk for key ${key}`, e);
    }
  }

  async createSignedUploadUrl(
    filename: string,
    contentType: string,
    folder = 'general',
    expiresIn = 900,
    explicitKey?: string,
  ): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
    const ext = filename.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'bin';
    // An explicit key (validated by the caller) lets a client upload a derived
    // variant — e.g. a `<uuid>_thumb.webp` thumbnail sharing the original's key.
    const key = explicitKey || `${folder}/${randomUUID()}.${ext}`;

    if (!this.isConfigured || !this.s3) {
      const uploadUrl = `/api/media/direct-upload?key=${encodeURIComponent(key)}`;
      return { uploadUrl, publicUrl: `/api/media/${key}`, key };
    }

    const command = new PutObjectCommand({ Bucket: this.bucketName, Key: key, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' });
    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn });
    const filePublicUrl = this.getPublicUrl(key);

    return { uploadUrl, publicUrl: filePublicUrl, key };
  }

  async createSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    if (!this.isConfigured || !this.s3) return `/mock-download/${key}`;
    const command = new GetObjectCommand({ Bucket: this.bucketName, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn });
  }

  async createSignedUrls(keys: string[], expiresIn = 3600): Promise<{ [key: string]: string }> {
    const result: { [key: string]: string } = {};
    if (!keys || keys.length === 0) return result;

    if (!this.isConfigured || !this.s3) {
      keys.forEach(k => { result[k] = `/mock-download/${k}`; });
      return result;
    }

    await Promise.all(keys.map(async (key) => {
      try {
        const command = new GetObjectCommand({ Bucket: this.bucketName, Key: key });
        const url = await getSignedUrl(this.s3!, command, { expiresIn });
        result[key] = url;
      } catch (e) {
        result[key] = `/mock-download/${key}`;
      }
    }));

    return result;
  }

  getPublicUrl(key: string): string {
    if (!this.isConfigured) return `/mock-public/${key}`;
    return this.publicUrl
      ? `${this.publicUrl.replace(/\/$/, '')}/${key}`
      : `https://${this.bucketName}.r2.dev/${key}`;
  }

  async delete(key: string): Promise<boolean> {
    try {
      const localPath = this.getLocalFilePath(key);
      if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    } catch (_) {}

    if (!this.isConfigured || !this.s3) return true;
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }));
      return true;
    } catch (e) {
      this.logger.error(`Failed to delete object ${key}`, e);
      return false;
    }
  }

  async upload(key: string, fileBuffer: Buffer, contentType: string): Promise<string> {
    // Always save to local disk as fallback guarantee
    this.saveToLocalDisk(key, fileBuffer);

    if (!this.isConfigured || !this.s3) return this.getPublicUrl(key);
    try {
      await this.s3.send(new PutObjectCommand({ Bucket: this.bucketName, Key: key, Body: fileBuffer, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }));
      return this.getPublicUrl(key);
    } catch (e) {
      this.logger.warn(`R2 upload failed for key ${key}, relying on local disk storage: ${e?.message || e}`);
      return this.getPublicUrl(key);
    }
  }

  async exists(key: string): Promise<boolean> {
    const localPath = this.getLocalFilePath(key);
    if (fs.existsSync(localPath)) return true;

    if (!this.isConfigured || !this.s3) return false;
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }));
      return true;
    } catch (e: any) {
      if (e.name === 'NotFound') return false;
      return false;
    }
  }

  async getMetadata(key: string): Promise<any> {
    const localPath = this.getLocalFilePath(key);
    if (fs.existsSync(localPath)) {
      try {
        const stat = fs.statSync(localPath);
        return { contentLength: stat.size };
      } catch (_) {}
    }

    if (!this.isConfigured || !this.s3) return null;
    try {
      const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }));
      return head;
    } catch (e) {
      return null;
    }
  }

  async copy(sourceKey: string, destinationKey: string): Promise<boolean> {
    if (!this.isConfigured || !this.s3) return true;
    try {
      await this.s3.send(new CopyObjectCommand({
        Bucket: this.bucketName,
        CopySource: `${this.bucketName}/${sourceKey}`,
        Key: destinationKey,
      }));
      return true;
    } catch (e) {
      return false;
    }
  }

  async move(sourceKey: string, destinationKey: string): Promise<boolean> {
    const copied = await this.copy(sourceKey, destinationKey);
    if (copied) return this.delete(sourceKey);
    return false;
  }

  async list(folder: string): Promise<any[]> {
    return []; // Placeholder for R2 implementation of listing
  }
}
