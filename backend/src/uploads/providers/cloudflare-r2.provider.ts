import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { StorageProvider } from './storage-provider.interface';
import { config } from '../../config';

@Injectable()
export class CloudflareR2Provider implements StorageProvider {
  private readonly logger = new Logger(CloudflareR2Provider.name);
  private s3: S3Client | null = null;
  private bucketName: string;
  private publicUrl: string;
  private readonly isConfigured: boolean;

  constructor() {
    const { accountId, accessKeyId, secretAccessKey, bucketName, region } =
      config.storage.r2;
    this.bucketName = bucketName;
    this.publicUrl = config.storage.publicUrl || config.storage.r2.publicUrl;

    this.isConfigured = !!(
      accountId &&
      accessKeyId &&
      secretAccessKey &&
      accountId !== '' &&
      accessKeyId !== '' &&
      secretAccessKey !== ''
    );

    if (this.isConfigured) {
      this.s3 = new S3Client({
        region,
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: accessKeyId,
          secretAccessKey: secretAccessKey,
        },
        // AWS SDK v3 (>= 3.729) can add default integrity checksums as SIGNED
        // headers on PutObject, including in presigned URLs — headers a browser
        // PUT cannot reproduce. WHEN_REQUIRED keeps presigned browser uploads to
        // R2 signature-compatible (verified working against this bucket).
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
      this.logger.log('Cloudflare R2 configured');
      if (!this.publicUrl) {
        // Without a configured public host there is no correct URL to guess —
        // media is served through the API's own /api/media route instead.
        this.logger.warn(
          'STORAGE_PUBLIC_URL / R2_PUBLIC_URL is not set; media will be served via /api/media',
        );
      }
    }
  }

  private getLocalFilePath(key: string): string {
    const cwd = process.cwd();
    const baseDir = cwd.endsWith('backend')
      ? path.join(cwd, 'uploads')
      : path.join(cwd, 'backend', 'uploads');
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
    const ext =
      filename
        .split('.')
        .pop()
        ?.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 10) || 'bin';
    // An explicit key (validated by the caller) lets a client upload a derived
    // variant — e.g. a `<uuid>_thumb.webp` thumbnail sharing the original's key.
    const key = explicitKey || `${folder}/${randomUUID()}.${ext}`;

    if (!this.isConfigured || !this.s3) {
      const uploadUrl = `/api/media/direct-upload?key=${encodeURIComponent(key)}`;
      return { uploadUrl, publicUrl: `/api/media/${key}`, key };
    }

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    });
    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn });
    const filePublicUrl = this.getPublicUrl(key);

    return { uploadUrl, publicUrl: filePublicUrl, key };
  }

  async createSignedDownloadUrl(
    key: string,
    expiresIn = config.storage.r2.signedUrlTtlSeconds,
  ): Promise<string> {
    if (!this.isConfigured || !this.s3) return `/mock-download/${key}`;
    const command = new GetObjectCommand({ Bucket: this.bucketName, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn });
  }

  async createSignedUrls(
    keys: string[],
    expiresIn = config.storage.r2.signedUrlTtlSeconds,
  ): Promise<{ [key: string]: string }> {
    const result: { [key: string]: string } = {};
    if (!keys || keys.length === 0) return result;

    if (!this.isConfigured || !this.s3) {
      keys.forEach((k) => {
        result[k] = `/mock-download/${k}`;
      });
      return result;
    }

    await Promise.all(
      keys.map(async (key) => {
        try {
          const command = new GetObjectCommand({
            Bucket: this.bucketName,
            Key: key,
          });
          const url = await getSignedUrl(this.s3!, command, { expiresIn });
          result[key] = url;
        } catch (e) {
          result[key] = `/mock-download/${key}`;
        }
      }),
    );

    return result;
  }

  getPublicUrl(key: string): string {
    if (!this.isConfigured) return `/mock-public/${key}`;
    // The public host is a configuration value; when it is absent the key is
    // returned as an API-relative media path rather than a guessed bucket host.
    return this.publicUrl ? `${this.publicUrl}/${key}` : `/api/media/${key}`;
  }

  async delete(key: string): Promise<boolean> {
    try {
      const localPath = this.getLocalFilePath(key);
      if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    } catch (_) {}

    if (!this.isConfigured || !this.s3) return true;
    try {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }),
      );
      return true;
    } catch (e) {
      this.logger.error(`Failed to delete object ${key}`, e);
      return false;
    }
  }

  /**
   * Store an object, or fail.
   *
   * This used to be unable to fail. It wrote the bytes to the container's local
   * disk and then — whether R2 was unconfigured or the PutObject threw —
   * returned a public URL as though the upload had succeeded. The caller
   * (`StorageService.uploadFile`) took that as confirmation and wrote a Media
   * row, so the database ended up referencing objects that only ever existed on
   * one container's filesystem.
   *
   * On a platform with an ephemeral filesystem — Azure Container Apps, where this runs —
   * every deploy wipes that directory. The Media rows survive, the bytes do
   * not, and every post referencing them serves 404s from then on, with no way
   * to recover the image and nothing above warning level in the logs.
   *
   * Local disk is a development convenience for running without R2 credentials,
   * not a fallback for a configured provider that is failing. When R2 is
   * configured its result is the only thing that counts, and a failure
   * propagates so the upload — and the post attached to it — fails loudly
   * instead of quietly producing a permanently broken image.
   */
  async upload(
    key: string,
    fileBuffer: Buffer,
    contentType: string,
  ): Promise<string> {
    if (!this.isConfigured || !this.s3) {
      // No credentials: local-disk mode, for development only.
      this.saveToLocalDisk(key, fileBuffer);
      return this.getPublicUrl(key);
    }

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: fileBuffer,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      return this.getPublicUrl(key);
    } catch (e: any) {
      this.logger.error(
        `R2 upload failed for key ${key} in bucket ${this.bucketName}: ${e?.message || e}`,
      );
      throw new ServiceUnavailableException('Upload failed, please try again');
    }
  }

  async exists(key: string): Promise<boolean> {
    // Local disk is consulted only in local-disk mode. Checking it first while
    // R2 is configured let a leftover file from an earlier deploy mask an object
    // that was never actually stored — the image looked fine on the container
    // that had written it and 404'd on every other one.
    if (!this.isConfigured || !this.s3)
      return fs.existsSync(this.getLocalFilePath(key));
    try {
      await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucketName, Key: key }),
      );
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
      const head = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucketName, Key: key }),
      );
      return head;
    } catch (e) {
      return null;
    }
  }

  async copy(sourceKey: string, destinationKey: string): Promise<boolean> {
    if (!this.isConfigured || !this.s3) return true;
    try {
      await this.s3.send(
        new CopyObjectCommand({
          Bucket: this.bucketName,
          CopySource: `${this.bucketName}/${sourceKey}`,
          Key: destinationKey,
        }),
      );
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
