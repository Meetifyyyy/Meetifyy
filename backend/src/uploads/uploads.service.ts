import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
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

    // R2 is configured only if all credentials are present
    this.isConfigured =
      !!(accountId && accessKeyId && secretAccessKey &&
        accountId !== '' && accessKeyId !== '' && secretAccessKey !== '');

    if (this.isConfigured) {
      this.s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
      });
      this.logger.log('Cloudflare R2 configured — real presigned uploads active');
    } else {
      this.logger.warn(
        'R2 credentials not set — uploads will return mock URLs. ' +
        'Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL to enable real uploads.',
      );
    }
  }

  /**
   * Generate a presigned PUT URL for direct browser → R2 uploads.
   * Falls back to a mock response when R2 isn't configured (local dev).
   *
   * @param filename  Original filename (used to derive extension)
   * @param contentType  MIME type of the file
   * @param folder  R2 "folder" prefix, e.g. "avatars", "covers", "chat-media"
   * @param expiresIn  TTL in seconds (default 15 minutes)
   */
  async presign(
    filename: string,
    contentType: string,
    folder = 'general',
    expiresIn = 900,
  ): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
    const ext = filename.split('.').pop() || 'bin';
    const key = `${folder}/${randomUUID()}.${ext}`;

    // ── Local mock: no real upload, just return a placeholder ──────────────
    if (!this.isConfigured || !this.s3) {
      const mockPublicUrl = `/mock-upload/${key}`;
      this.logger.debug(`[MOCK] presign called for ${key}`);
      return {
        uploadUrl: mockPublicUrl, // frontend will PUT here but it'll fail gracefully
        publicUrl: mockPublicUrl,
        key,
      };
    }

    // ── Production: real R2 presigned URL ──────────────────────────────────
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn });
    const filePublicUrl = this.publicUrl
      ? `${this.publicUrl.replace(/\/$/, '')}/${key}`
      : `https://${this.bucketName}.r2.dev/${key}`;

    return { uploadUrl, publicUrl: filePublicUrl, key };
  }
}
