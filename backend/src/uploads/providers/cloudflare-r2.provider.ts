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
  ListObjectsV2Command,
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
  private verificationBucketName: string;
  private publicUrl: string;
  private readonly isConfigured: boolean;

  constructor() {
    const { accountId, accessKeyId, secretAccessKey, bucketName, region } =
      config.storage.r2;
    this.bucketName = bucketName;
    // Falls back to the main bucket when unset, so nothing changes until an
    // operator provisions a private bucket and points this at it.
    this.verificationBucketName =
      config.storage.r2.verificationBucketName || bucketName;
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
      Bucket: this.bucketFor(key),
      Key: key,
      // Identity documents must never be told to cache publicly for a year.
      // They were, which is how a verification object stayed in a CDN long
      // after the request that produced it had failed.
      CacheControl: key.startsWith('verification/')
        ? 'private, no-store'
        : 'public, max-age=31536000, immutable',
    });
    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn });
    const filePublicUrl = this.getPublicUrl(key);

    return { uploadUrl, publicUrl: filePublicUrl, key };
  }

  /**
   * The bucket a key belongs in.
   *
   * Identity documents can be routed to a bucket with no public host, because
   * the main bucket is fronted by a `pub-*.r2.dev` URL that resolves any key
   * without authentication — leaving verification privacy resting on key
   * secrecy alone. Keyed off the prefix rather than passed by every caller, so
   * a new call site cannot forget to ask for the right bucket.
   */
  private static readonly PRIVATE_PREFIXES = [
    'verification/',
    // Conversation attachments, for the same reason. The main bucket's public
    // host resolves any key with no authentication, so an object placed there
    // is readable by anyone who ever sees its URL — after the message is
    // deleted, and with no way to revoke it. Authorizing `/api/media` does not
    // help if the CDN will serve the same bytes directly.
    'chat/',
    'messages/',
    'voice/',
  ];

  /**
   * The bucket a key is WRITTEN to.
   *
   * Falls back to the main bucket when no private one is configured, which
   * keeps existing deployments working exactly as before.
   */
  private bucketFor(key: string): string {
    const isPrivate = CloudflareR2Provider.PRIVATE_PREFIXES.some((prefix) =>
      key?.startsWith(prefix),
    );
    return isPrivate ? this.verificationBucketName : this.bucketName;
  }

  /** True when this key's prefix is routed away from the main bucket. */
  private isPrivatePrefix(key: string): boolean {
    return CloudflareR2Provider.PRIVATE_PREFIXES.some((prefix) =>
      key?.startsWith(prefix),
    );
  }

  /**
   * The bucket a key is actually READ from, which is not always the one it
   * would be written to today.
   *
   * Adding `chat/`, `messages/` and `voice/` to the private prefixes changed
   * where conversation attachments are stored, but said nothing about the ones
   * already stored. Every existing attachment is in the main bucket, so every
   * read — `exists`, the signed URL, the metadata lookup — went to the private
   * bucket, missed, and reported the object as gone. `/api/media/chat/...`
   * answered 404 for every attachment in the product, after passing its
   * authorization check, which is what made it look like a permissions bug.
   *
   * So reads try the key's own bucket first and fall back to the main one.
   * Writes are unaffected: new objects go to the private bucket, and the
   * fallback is what keeps the ones written before that change readable until
   * they are migrated.
   *
   * Returns null when the object is in neither, which callers treat as a miss.
   */
  private async resolveReadBucket(key: string): Promise<string | null> {
    const cached = this.readBucketCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.bucket;

    const primary = this.bucketFor(key);
    const candidates =
      this.isPrivatePrefix(key) && primary !== this.bucketName
        ? [primary, this.bucketName]
        : [primary];

    let found: string | null = null;
    for (const bucket of candidates) {
      if (await this.headIn(key, bucket)) {
        found = bucket;
        break;
      }
    }

    this.rememberReadBucket(key, found);
    return found;
  }

  /** One HeadObject, against one named bucket. */
  private async headIn(key: string, bucket: string): Promise<boolean> {
    if (!this.s3) return false;
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Where a key was last found, so a rendered conversation does not pay two
   * HeadObject calls per attachment. A miss is cached far more briefly than a
   * hit: a thumbnail is produced asynchronously, so "not there" is routinely a
   * statement about right now rather than about the object.
   */
  private readonly readBucketCache = new Map<
    string,
    { bucket: string | null; expiresAt: number }
  >();
  private static readonly READ_BUCKET_HIT_TTL_MS = 10 * 60 * 1000;
  private static readonly READ_BUCKET_MISS_TTL_MS = 3 * 1000;
  private static readonly READ_BUCKET_MAX_ENTRIES = 5_000;

  private rememberReadBucket(key: string, bucket: string | null): void {
    const cache = this.readBucketCache;
    if (cache.size >= CloudflareR2Provider.READ_BUCKET_MAX_ENTRIES) {
      const now = Date.now();
      for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
      if (cache.size >= CloudflareR2Provider.READ_BUCKET_MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
    }
    cache.set(key, {
      bucket,
      expiresAt:
        Date.now() +
        (bucket
          ? CloudflareR2Provider.READ_BUCKET_HIT_TTL_MS
          : CloudflareR2Provider.READ_BUCKET_MISS_TTL_MS),
    });
  }

  async createSignedDownloadUrl(
    key: string,
    expiresIn = config.storage.r2.signedUrlTtlSeconds,
  ): Promise<string> {
    if (!this.isConfigured || !this.s3) return `/mock-download/${key}`;
    const bucket = (await this.resolveReadBucket(key)) ?? this.bucketFor(key);
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
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
          const bucket =
            (await this.resolveReadBucket(key)) ?? this.bucketFor(key);
          const command = new GetObjectCommand({ Bucket: bucket, Key: key });
          const url = await getSignedUrl(this.s3!, command, { expiresIn });
          result[key] = url;
        } catch {
          result[key] = `/mock-download/${key}`;
        }
      }),
    );

    return result;
  }

  getPublicUrl(key: string): string {
    if (!this.isConfigured) return `/mock-public/${key}`;

    /**
     * A private-prefixed key has no public URL, and must not be given one.
     *
     * This returned the main bucket's public host for EVERY key, including the
     * ones routed to a bucket that host does not serve — so a conversation
     * attachment was advertised at an address where it does not exist, and an
     * identity document at an address where, in the fallback single-bucket
     * configuration, it does. The API path is the only correct answer for these:
     * it is the route that checks who is asking.
     */
    if (this.isPrivatePrefix(key)) return `/api/media/${key}`;

    // The public host is a configuration value; when it is absent the key is
    // returned as an API-relative media path rather than a guessed bucket host.
    return this.publicUrl ? `${this.publicUrl}/${key}` : `/api/media/${key}`;
  }

  async delete(key: string): Promise<boolean> {
    try {
      const localPath = this.getLocalFilePath(key);
      if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    } catch (_) {
      // Local disk is the unconfigured-development fallback; a file that will not delete is not worth reporting as a storage failure.
    }

    if (!this.isConfigured || !this.s3) return true;
    try {
      // The bucket it is actually IN, not the one it would be written to. A
      // legacy conversation attachment lives in the main bucket, and deleting
      // from the private one would report success while leaving the object —
      // and its public URL — in place.
      const bucket = (await this.resolveReadBucket(key)) ?? this.bucketFor(key);
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: key }),
      );
      this.readBucketCache.delete(key);
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
          Bucket: this.bucketFor(key),
          Key: key,
          Body: fileBuffer,
          ContentType: contentType,
          // An identity document is not a cacheable public asset. Storing one
          // with a year-long immutable directive is how a verification image
          // ended up pinned in a CDN edge long after the submission failed.
          CacheControl: key.startsWith('verification/')
            ? 'private, no-store'
            : 'public, max-age=31536000, immutable',
        }),
      );
      return this.getPublicUrl(key);
    } catch (e: any) {
      this.logger.error(
        `R2 upload failed for key ${key} in bucket ${this.bucketFor(key)}: ${e?.message || e}`,
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
    // Resolved rather than assumed: a conversation attachment written before
    // those prefixes moved to the private bucket is still in the main one.
    return (await this.resolveReadBucket(key)) !== null;
  }

  async getMetadata(key: string): Promise<any> {
    const localPath = this.getLocalFilePath(key);
    if (fs.existsSync(localPath)) {
      try {
        const stat = fs.statSync(localPath);
        return { contentLength: stat.size };
      } catch (_) {
        // Local disk is the unconfigured-development fallback; without metadata the caller gets the same answer as a missing object.
      }
    }

    if (!this.isConfigured || !this.s3) return null;
    try {
      const bucket = (await this.resolveReadBucket(key)) ?? this.bucketFor(key);
      const head = await this.s3.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      return head;
    } catch {
      return null;
    }
  }

  async copy(sourceKey: string, destinationKey: string): Promise<boolean> {
    if (!this.isConfigured || !this.s3) return true;
    // Copying across the public/private bucket boundary would move a document
    // out of the bucket that protects it, or move ordinary media into it.
    // Nothing does this today; refusing is cheaper than discovering it later.
    if (this.bucketFor(sourceKey) !== this.bucketFor(destinationKey)) {
      this.logger.error(
        `Refusing cross-bucket copy ${sourceKey} -> ${destinationKey}`,
      );
      return false;
    }
    try {
      await this.s3.send(
        new CopyObjectCommand({
          Bucket: this.bucketFor(destinationKey),
          CopySource: `${this.bucketFor(sourceKey)}/${sourceKey}`,
          Key: destinationKey,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async move(sourceKey: string, destinationKey: string): Promise<boolean> {
    const copied = await this.copy(sourceKey, destinationKey);
    if (copied) return this.delete(sourceKey);
    return false;
  }

  async list(folder: string): Promise<any[]> {
    if (!this.isConfigured || !this.s3) {
      const localFolder = this.getLocalFilePath(folder);
      if (!fs.existsSync(localFolder)) return [];
      try {
        const files = fs.readdirSync(localFolder, { recursive: true });
        return files.map((f) => ({
          Key: `${folder}/${String(f)}`,
          Size: 0,
        }));
      } catch (_) {
        return [];
      }
    }

    try {
      const prefix = folder.endsWith('/') ? folder : `${folder}/`;
      const allObjects: any[] = [];
      let continuationToken: string | undefined;

      do {
        const res = await this.s3.send(
          new ListObjectsV2Command({
            Bucket: this.bucketFor(prefix),
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );
        if (res.Contents) {
          allObjects.push(...res.Contents);
        }
        continuationToken = res.NextContinuationToken;
      } while (continuationToken);

      return allObjects;
    } catch (e) {
      this.logger.error(`Failed to list objects in folder ${folder}`, e);
      return [];
    }
  }
}
