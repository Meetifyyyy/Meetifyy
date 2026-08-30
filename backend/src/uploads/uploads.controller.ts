import {
  Controller,
  Post,
  Put,
  Body,
  UseGuards,
  Req,
  Get,
  Param,
  Query,
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { StorageService } from './uploads.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response, Request } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import {
  MAX_COVERED_IMAGE_SIZE_BYTES,
  COVERED_IMAGE_SIZE_ERROR_MESSAGE,
  isCoveredImageFolder,
} from './uploads.constants';

/**
 * Resolved-redirect cache for GET /api/media/*.
 *
 * PERF: resolving one media key costs an R2 HeadObject (~370ms measured) plus a
 * `media` row lookup, and those were run back-to-back on every single request.
 * Media keys are effectively immutable — the filename carries a content hash or
 * a UUID, so a key that resolves to a URL today resolves to the same URL later —
 * yet a real traffic sample showed 529 media requests covering only 35 distinct
 * keys (one avatar alone was fetched 121 times). Every one of those repeats paid
 * the full ~500ms resolution again.
 *
 * The TTL is a deletion backstop — if media is removed, the stale redirect is
 * dropped within MEDIA_URL_TTL_MS rather than persisting for the process lifetime.
 */
const MEDIA_URL_TTL_MS = 5 * 60 * 1000;
const MEDIA_URL_MAX_ENTRIES = 5_000;

/**
 * Misses are cached too, but only briefly. A key that is genuinely absent was
 * otherwise re-probed against R2 on every single request — observed at ~417ms
 * per attempt, repeatedly, for one missing message attachment.
 *
 * The short window preserves the reason misses weren't cached at all before:
 * thumbnails are uploaded asynchronously, so a key that 404s now may exist
 * moments later and must stay re-checkable. `sendMediaMiss` still sends
 * `no-store`, so the browser never caches a miss.
 *
 * 3s rather than 15s: the in-flight map below already collapses concurrent
 * lookups of the same key into one HeadObject, so the negative cache is not
 * what protects against a storm — it only spaces out sequential retries. At
 * 15s a just-uploaded image stayed dark for a quarter of a minute after the
 * post appeared, which is precisely when someone is looking at it.
 */
const MEDIA_MISS_TTL_MS = 3 * 1000;

@Controller('api/media')
export class UploadsController {
  constructor(private readonly storageService: StorageService) {}

  /** `url: null` records a short-lived negative result. */
  private static readonly mediaUrlCache = new Map<
    string,
    { url: string | null; expiresAt: number }
  >();

  /**
   * De-duplicates concurrent resolutions of the same key. A feed rendering the
   * same avatar in twenty places would otherwise fire twenty parallel
   * HeadObject calls for one answer; they now share a single in-flight promise.
   */
  private static readonly mediaUrlInFlight = new Map<
    string,
    Promise<string | null>
  >();

  /**
   * Returns `{ url }` on a cache hit (where `url` may be null for a cached
   * miss), or `undefined` when nothing valid is cached. The wrapper object is
   * what lets a cached negative be told apart from "not cached".
   */
  private static getCachedMediaUrl(
    key: string,
  ): { url: string | null } | undefined {
    const hit = UploadsController.mediaUrlCache.get(key);
    if (hit && hit.expiresAt > Date.now()) return { url: hit.url };
    if (hit) UploadsController.mediaUrlCache.delete(key);
    return undefined;
  }

  private static setCachedMediaUrl(key: string, url: string | null) {
    const cache = UploadsController.mediaUrlCache;
    if (cache.size >= MEDIA_URL_MAX_ENTRIES) {
      const now = Date.now();
      for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
      if (cache.size >= MEDIA_URL_MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
    }
    const ttl = url === null ? MEDIA_MISS_TTL_MS : MEDIA_URL_TTL_MS;
    cache.set(key, { url, expiresAt: Date.now() + ttl });
  }

  /**
   * Resolves a storage key to its public URL, or null if it isn't in storage.
   * The existence check and the URL resolution are independent lookups (one hits
   * R2, the other the `media` table), so they run concurrently instead of
   * sequentially — on a cache miss that saves a full DB round-trip of wall time.
   */
  private async resolveMediaUrl(key: string): Promise<string | null> {
    const cached = UploadsController.getCachedMediaUrl(key);
    if (cached) return cached.url;

    const inFlight = UploadsController.mediaUrlInFlight.get(key);
    if (inFlight) return inFlight;

    const task = (async (): Promise<string | null> => {
      const [existsInStorage, url] = await Promise.all([
        this.storageService.exists(key),
        this.storageService.getResolvedPublicUrl(key),
      ]);
      const resolved =
        existsInStorage &&
        url &&
        (url.startsWith('http://') || url.startsWith('https://')) &&
        !url.includes('/api/media/')
          ? url
          : null;
      UploadsController.setCachedMediaUrl(key, resolved);
      return resolved;
    })().finally(() => {
      UploadsController.mediaUrlInFlight.delete(key);
    });

    UploadsController.mediaUrlInFlight.set(key, task);
    return task;
  }

  /**
   * POST /api/media/upload
   * Pass-through upload endpoint that validates and stores the file.
   */
  @UseGuards(JwtGuard)
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (_req, file, callback) => {
        const allowed =
          /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|ogg)|audio\/(mpeg|wav|webm|ogg))$/i.test(
            file.mimetype,
          );
        callback(null, allowed);
      },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('folder') folder: string = 'general',
    @Req() req: any,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    const userId = req.user.id;
    return this.storageService.uploadFile(userId, file, folder);
  }

  /**
   * POST /api/media/presigned-url
   * Generate a presigned URL for direct client upload.
   */
  @UseGuards(JwtGuard)
  @Post('presigned-url')
  async getPresignedUrl(
    @Body('filename') filename: string,
    @Body('contentType') contentType: string,
    @Body('folder') folder: string = 'general',
    @Body('fileSize') fileSize: number = 0,
    @Body('variantKey') variantKey: string | undefined,
    @Body('width') width: number | undefined,
    @Body('height') height: number | undefined,
    @Body('duration') duration: number | undefined,
    @Req() req: any,
  ) {
    if (!filename || !contentType) {
      throw new BadRequestException('filename and contentType are required');
    }
    const userId = req.user.id;
    return this.storageService.getPresignedUrl(
      userId,
      filename,
      contentType,
      folder,
      fileSize,
      variantKey,
      width,
      height,
      duration,
    );
  }

  /**
   * PUT /api/media/direct-upload
   * Direct upload endpoint for local development environment fallback.
   */
  @Put('direct-upload')
  @UseGuards(JwtGuard)
  async directUpload(
    @Query('key') key: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!key) throw new BadRequestException('Key parameter is required');
    if (!this.storageService.isSafeStorageKey(key))
      throw new BadRequestException('Invalid storage key');
    const userId = (req as any).user?.id;
    if (!userId || !(await this.storageService.userOwnsMediaKey(key, userId))) {
      throw new ForbiddenException('You are not allowed to upload to this key');
    }

    const cwd = process.cwd();
    const uploadsDir = cwd.endsWith('backend')
      ? path.join(cwd, 'uploads')
      : path.join(cwd, 'backend', 'uploads');
    const resolvedUploadsDir = path.resolve(uploadsDir);
    const filePath = path.resolve(resolvedUploadsDir, key);
    if (!filePath.startsWith(`${resolvedUploadsDir}${path.sep}`))
      throw new BadRequestException('Invalid storage path');
    const folder = key.split('/')[0] || 'general';
    const isCovered = isCoveredImageFolder(folder);
    const maxUploadBytes = isCovered
      ? MAX_COVERED_IMAGE_SIZE_BYTES
      : 50 * 1024 * 1024;
    const declaredLength = Number(req.headers['content-length'] || 0);
    if (declaredLength > maxUploadBytes)
      throw new BadRequestException(
        isCovered ? COVERED_IMAGE_SIZE_ERROR_MESSAGE : 'File is too large',
      );
    const folderPath = path.dirname(filePath);

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const writeStream = fs.createWriteStream(filePath);
    let receivedBytes = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      receivedBytes += chunk.length;
      if (receivedBytes > maxUploadBytes && !tooLarge) {
        tooLarge = true;
        req.unpipe(writeStream);
        writeStream.destroy();
        req.destroy();
        if (!res.headersSent)
          res.status(413).json({
            error: isCovered
              ? COVERED_IMAGE_SIZE_ERROR_MESSAGE
              : 'File is too large',
          });
      }
    });
    req.pipe(writeStream);

    writeStream.on('finish', () => {
      if (tooLarge) return;
      return res
        .status(200)
        .json({ status: 'ok', key, publicUrl: `/api/media/${key}` });
    });

    writeStream.on('error', (err) => {
      if (tooLarge) return;
      return res.status(500).json({ error: err.message });
    });
  }

  /** Cached manifest JSON in memory with its computed ETag and Last-Modified */
  private static cachedManifest: {
    data: any;
    etag: string;
    lastModified: string;
  } | null = null;

  private static getManifest() {
    if (UploadsController.cachedManifest) {
      return UploadsController.cachedManifest;
    }
    try {
      const manifestPath = path.join(__dirname, 'preset-media.manifest.json');
      if (fs.existsSync(manifestPath)) {
        const raw = fs.readFileSync(manifestPath, 'utf-8');
        const data = JSON.parse(raw);
        const etag = `"${crypto.createHash('sha256').update(raw).digest('hex').substring(0, 16)}"`;
        const lastModified = data.lastModified || new Date().toUTCString();
        UploadsController.cachedManifest = { data, etag, lastModified };
        return UploadsController.cachedManifest;
      }
    } catch (_) {}
    return null;
  }

  /**
   * GET /api/media/preset-media
   * Returns the curated media manifest with ETag, Last-Modified, and 304 support.
   */
  @Get('preset-media')
  getPresetMedia(@Req() req: Request, @Res() res: Response) {
    const manifest = UploadsController.getManifest();
    if (!manifest) {
      return res.status(200).json({ version: '1.0.0', images: [], gifs: [] });
    }

    const ifNoneMatch = req.headers['if-none-match'];
    const ifModifiedSince = req.headers['if-modified-since'];

    if (
      (ifNoneMatch && ifNoneMatch === manifest.etag) ||
      (ifModifiedSince && ifModifiedSince === manifest.lastModified)
    ) {
      res.setHeader('ETag', manifest.etag);
      res.setHeader('Last-Modified', manifest.lastModified);
      res.setHeader(
        'Cache-Control',
        'public, max-age=3600, stale-while-revalidate=86400',
      );
      return res.status(304).end();
    }

    res.setHeader('ETag', manifest.etag);
    res.setHeader('Last-Modified', manifest.lastModified);
    res.setHeader(
      'Cache-Control',
      'public, max-age=3600, stale-while-revalidate=86400',
    );
    return res.status(200).json(manifest.data);
  }

  /**
   * POST /api/media/signed-urls
   * Retrieve signed URLs in bulk for an array of object keys.
   */
  @Post('signed-urls')
  @UseGuards(JwtGuard)
  async getSignedUrls(
    @Body() body: { keys: string[]; expiresIn?: number },
    @Req() req: any,
  ) {
    const { keys, expiresIn } = body || {};
    if (!keys || !Array.isArray(keys)) {
      throw new BadRequestException('keys must be an array of strings');
    }
    if (
      keys.length === 0 ||
      keys.length > 100 ||
      keys.some((key) => !this.storageService.isSafeStorageKey(key))
    ) {
      throw new BadRequestException(
        'keys must contain 1 to 100 valid storage keys',
      );
    }
    const safeExpiresIn = Math.min(
      Math.max(Number(expiresIn) || 3600, 60),
      3600,
    );
    return this.storageService.getSignedUrlsForUser(
      keys,
      safeExpiresIn,
      req.user.id,
    );
  }

  /**
   * POST /api/media/confirm
   * Confirms a direct client upload and updates the DB Media record.
   */
  @UseGuards(JwtGuard)
  @Post('confirm')
  async confirmUpload(@Body('key') key: string, @Req() req: any) {
    if (!key) {
      throw new BadRequestException('key is required');
    }
    const userId = req.user.id;
    const result = await this.storageService.confirmUpload(key, userId);
    if (!result) {
      throw new BadRequestException(
        'Failed to confirm upload. Object might not exist.',
      );
    }
    return result;
  }

  /**
   * POST /api/media/discard
   * Clean up an orphaned upload (owned + not yet attached to a post). Called by
   * the client when post creation fails after a successful media upload.
   */
  @UseGuards(JwtGuard)
  @Post('discard')
  async discardUpload(@Body('key') key: string, @Req() req: any) {
    if (!key) throw new BadRequestException('key is required');
    return this.storageService.discardOwnedUnattached(key, req.user.id);
  }

  private async handleGetMedia(
    key: string,
    folder: string | undefined,
    res: Response,
  ) {
    if (!this.storageService.isSafeStorageKey(key)) {
      return this.sendMediaMiss(res, 400);
    }

    // Private media never leaves through this endpoint. It is unauthenticated
    // by design — every URL under /api/media is consumed as a plain <img> src —
    // which is exactly why identity documents must be refused here rather than
    // relying on the key being hard to guess. The local-disk branch below is
    // covered too: it serves bytes directly and would otherwise sidestep the
    // resolution path entirely.
    //
    // The response is an ordinary miss, so it cannot be used to probe whether a
    // particular verification document exists.
    if (this.storageService.isAlwaysPrivateKey(key)) {
      return this.sendMediaMiss(res, 404);
    }

    const cwd = process.cwd();

    // Check multiple potential uploads locations on local disk
    const pathsToCheck = [
      path.join(cwd, 'uploads', key),
      path.join(cwd, 'backend', 'uploads', key),
    ];

    for (const localFilePath of pathsToCheck) {
      if (fs.existsSync(localFilePath)) {
        // Content-addressed: filename contains a random hex so the same key always
        // maps to the same bytes. Safe to cache for 1 year.
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.sendFile(localFilePath);
      }
    }

    try {
      const url = await this.resolveMediaUrl(key);
      if (url) {
        // Let the browser/CDN cache the redirect destination for 1 hour.
        // The client-side MediaCacheManager already handles signed-URL expiry;
        // this header prevents redundant redirect hops on repeated loads.
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.redirect(url);
      }
    } catch (e) {
      // Fallback below
    }

    // If a thumbnail variant was requested but does not exist, try to fall back
    // to the original image. The candidates are probed concurrently rather than
    // one extension at a time — the old loop could serialize five R2 round-trips
    // before admitting the original was a .gif. First match in preference order
    // still wins, so the chosen fallback is unchanged.
    if (/_thumb\.(webp|jpe?g|png)$/i.test(key)) {
      const baseKey = key.replace(/_thumb\.(webp|jpe?g|png)$/i, '');
      const candidateExts = ['webp', 'jpg', 'jpeg', 'png', 'gif'];
      const resolved = await Promise.all(
        candidateExts.map((ext) =>
          this.resolveMediaUrl(`${baseKey}.${ext}`).catch(() => null),
        ),
      );
      const origUrl = resolved.find((u) => !!u);
      if (origUrl) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.redirect(origUrl);
      }
    }

    if (
      folder === 'avatars' ||
      folder === 'avatar' ||
      folder === 'users' ||
      key.includes('avatar')
    ) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(
        `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
          <circle cx="50" cy="50" r="50" fill="#e2e8f0"/>
          <path d="M50 42 a 16 16 0 1 0 0 -32 a 16 16 0 1 0 0 32 Z M50 50 c -22 0 -36 14 -36 28 v 12 h 72 v -12 c 0 -14 -14 -28 -36 -28 Z" fill="#94a3b8"/>
        </svg>
      `.trim(),
      );
    }

    return this.sendMediaMiss(res, 404);
  }

  /**
   * Ends a failed media request without a body.
   *
   * Every URL under /api/media is consumed as an <img>/<video> source, and the
   * API is served from a different origin than the app. A JSON error body on
   * such a request trips Chrome's Cross-Origin Read Blocking, which reports it
   * as a blocked response in DevTools and gives the element nothing useful
   * anyway. An empty body has no MIME type to sniff, so the browser simply
   * fires the element's `error` event and the UI falls back as intended.
   *
   * Nothing reads this endpoint as JSON, so no caller loses information.
   */
  private sendMediaMiss(res: Response, status: number) {
    res.status(status);
    res.removeHeader('Content-Type');
    // Don't let a miss get cached as though it were the image: thumbnails are
    // uploaded asynchronously and a key that 404s now may exist in a moment.
    res.setHeader('Cache-Control', 'no-store');
    return res.end();
  }

  /**
   * GET /api/media/:folder/:filename
   * Serves file directly if stored locally, or redirects to cloud storage provider URL
   */
  @Get(':folder/:filename')
  async getMedia(
    @Param('folder') folder: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    const key = `${folder}/${filename}`;
    return this.handleGetMedia(key, folder, res);
  }

  /**
   * GET /api/media/:filename
   * Fallback for files stored without a folder prefix
   */
  @Get(':filename')
  async getMediaNoFolder(
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    return this.handleGetMedia(filename, undefined, res);
  }
}
