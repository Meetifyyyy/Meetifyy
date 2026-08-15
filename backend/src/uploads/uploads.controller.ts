import { Controller, Post, Put, Body, UseGuards, Req, Get, Param, Query, Res, UseInterceptors, UploadedFile, BadRequestException, ForbiddenException } from '@nestjs/common';
import { StorageService } from './uploads.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response, Request } from 'express';
import * as path from 'path';
import * as fs from 'fs';

@Controller('api/media')
export class UploadsController {
  constructor(private readonly storageService: StorageService) {}

  /**
   * POST /api/media/upload
   * Pass-through upload endpoint that validates and stores the file.
   */
  @UseGuards(JwtGuard)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
      const allowed = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|ogg)|audio\/(mpeg|wav|webm|ogg))$/i.test(file.mimetype);
      callback(null, allowed);
    },
  }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('folder') folder: string = 'general',
    @Req() req: any
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
    @Req() req: any
  ) {
    if (!filename || !contentType) {
      throw new BadRequestException('filename and contentType are required');
    }
    const userId = req.user.id;
    return this.storageService.getPresignedUrl(userId, filename, contentType, folder, fileSize, variantKey, width, height, duration);
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
    if (!this.storageService.isSafeStorageKey(key)) throw new BadRequestException('Invalid storage key');
    const userId = (req as any).user?.id;
    if (!userId || !(await this.storageService.userOwnsMediaKey(key, userId))) {
      throw new ForbiddenException('You are not allowed to upload to this key');
    }

    const cwd = process.cwd();
    const uploadsDir = cwd.endsWith('backend') ? path.join(cwd, 'uploads') : path.join(cwd, 'backend', 'uploads');
    const resolvedUploadsDir = path.resolve(uploadsDir);
    const filePath = path.resolve(resolvedUploadsDir, key);
    if (!filePath.startsWith(`${resolvedUploadsDir}${path.sep}`)) throw new BadRequestException('Invalid storage path');
    const maxUploadBytes = 25 * 1024 * 1024;
    const declaredLength = Number(req.headers['content-length'] || 0);
    if (declaredLength > maxUploadBytes) throw new BadRequestException('File is too large');
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
        if (!res.headersSent) res.status(413).json({ error: 'File is too large' });
      }
    });
    req.pipe(writeStream);

    writeStream.on('finish', () => {
      if (tooLarge) return;
      return res.status(200).json({ status: 'ok', key, publicUrl: `/api/media/${key}` });
    });

    writeStream.on('error', (err) => {
      if (tooLarge) return;
      return res.status(500).json({ error: err.message });
    });
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
    if (keys.length === 0 || keys.length > 100 || keys.some((key) => !this.storageService.isSafeStorageKey(key))) {
      throw new BadRequestException('keys must contain 1 to 100 valid storage keys');
    }
    const safeExpiresIn = Math.min(Math.max(Number(expiresIn) || 3600, 60), 3600);
    return this.storageService.getSignedUrlsForUser(keys, safeExpiresIn, req.user.id);
  }

  /**
   * POST /api/media/confirm
   * Confirms a direct client upload and updates the DB Media record.
   */
  @UseGuards(JwtGuard)
  @Post('confirm')
  async confirmUpload(
    @Body('key') key: string,
    @Req() req: any
  ) {
    if (!key) {
      throw new BadRequestException('key is required');
    }
    const userId = req.user.id;
    const result = await this.storageService.confirmUpload(key, userId);
    if (!result) {
      throw new BadRequestException('Failed to confirm upload. Object might not exist.');
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
  async discardUpload(
    @Body('key') key: string,
    @Req() req: any,
  ) {
    if (!key) throw new BadRequestException('key is required');
    return this.storageService.discardOwnedUnattached(key, req.user.id);
  }

  private async handleGetMedia(key: string, folder: string | undefined, res: Response) {
    if (!this.storageService.isSafeStorageKey(key)) {
      return res.status(400).json({ error: 'Invalid media key' });
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
      const existsInStorage = await this.storageService.exists(key);
      if (existsInStorage) {
        const url = await this.storageService.getResolvedPublicUrl(key);
        if (url && (url.startsWith('http://') || url.startsWith('https://')) && !url.includes('/api/media/')) {
          // Let the browser/CDN cache the redirect destination for 1 hour.
          // The client-side MediaCacheManager already handles signed-URL expiry;
          // this header prevents redundant redirect hops on repeated loads.
          res.setHeader('Cache-Control', 'public, max-age=3600');
          return res.redirect(url);
        }
      }
    } catch (e) {
      // Fallback below
    }

    if (folder === 'avatars' || folder === 'avatar' || folder === 'users' || key.includes('avatar')) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
          <circle cx="50" cy="50" r="50" fill="#e2e8f0"/>
          <path d="M50 42 a 16 16 0 1 0 0 -32 a 16 16 0 1 0 0 32 Z M50 50 c -22 0 -36 14 -36 28 v 12 h 72 v -12 c 0 -14 -14 -28 -36 -28 Z" fill="#94a3b8"/>
        </svg>
      `.trim());
    }

    if (folder === 'posts' || key.includes('posts/') || key.includes('post')) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.redirect('https://images.unsplash.com/photo-1517842645767-c639042777db?w=800&auto=format&fit=crop&q=80');
    }

    return res.status(404).json({ error: 'Media file not found' });
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
