import { Controller, Post, Put, Body, UseGuards, Req, Get, Param, Query, Res, UseInterceptors, UploadedFile, BadRequestException, InternalServerErrorException } from '@nestjs/common';
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
  @UseInterceptors(FileInterceptor('file'))
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
    @Req() req: any
  ) {
    if (!filename || !contentType) {
      throw new BadRequestException('filename and contentType are required');
    }
    const userId = req.user.id;
    return this.storageService.getPresignedUrl(userId, filename, contentType, folder, fileSize);
  }

  /**
   * PUT /api/media/direct-upload
   * Direct upload endpoint for local development environment fallback.
   */
  @Put('direct-upload')
  async directUpload(
    @Query('key') key: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!key) throw new BadRequestException('Key parameter is required');

    const uploadsDir = path.join(process.cwd(), 'uploads');
    const filePath = path.join(uploadsDir, key);
    const folderPath = path.dirname(filePath);

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const writeStream = fs.createWriteStream(filePath);
    req.pipe(writeStream);

    writeStream.on('finish', () => {
      return res.status(200).json({ status: 'ok', key, publicUrl: `/api/media/${key}` });
    });

    writeStream.on('error', (err) => {
      return res.status(500).json({ error: err.message });
    });
  }

  /**
   * GET /api/media/:folder/:filename
   * Serves file directly if stored locally, or redirects to cloud storage provider URL
   */
  @Get(':folder/:filename')
  getMedia(
    @Param('folder') folder: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    const key = `${folder}/${filename}`;
    const localFilePath = path.join(process.cwd(), 'uploads', key);

    if (fs.existsSync(localFilePath)) {
      return res.sendFile(localFilePath);
    }

    try {
      const url = this.storageService.getPublicUrl(key);
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        return res.redirect(url);
      }
    } catch (e) {
      // Fallback below
    }

    return res.status(404).json({ error: 'Media file not found' });
  }
}
