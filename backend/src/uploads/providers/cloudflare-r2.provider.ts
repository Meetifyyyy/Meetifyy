import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
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
      });
      this.logger.log('Cloudflare R2 configured');
    }
  }

  async createSignedUploadUrl(
    filename: string,
    contentType: string,
    folder = 'general',
    expiresIn = 900,
  ): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
    const ext = filename.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'bin';
    const key = `${folder}/${randomUUID()}.${ext}`;

    if (!this.isConfigured || !this.s3) {
      const mockPublicUrl = `/mock-upload/${key}`;
      return { uploadUrl: mockPublicUrl, publicUrl: mockPublicUrl, key };
    }

    const command = new PutObjectCommand({ Bucket: this.bucketName, Key: key, ContentType: contentType });
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
    if (!this.isConfigured || !this.s3) return this.getPublicUrl(key);
    try {
      await this.s3.send(new PutObjectCommand({ Bucket: this.bucketName, Key: key, Body: fileBuffer, ContentType: contentType }));
      return this.getPublicUrl(key);
    } catch (e) {
      this.logger.error(`Failed to upload object ${key}`, e);
      throw new Error('Upload failed');
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isConfigured || !this.s3) return false;
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }));
      return true;
    } catch (e: any) {
      if (e.name === 'NotFound') return false;
      throw e;
    }
  }

  async getMetadata(key: string): Promise<any> {
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
