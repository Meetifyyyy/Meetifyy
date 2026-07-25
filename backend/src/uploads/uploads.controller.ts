import { Controller, Post, Body, UseGuards, Req, Get, Param, Res, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { StorageService } from './uploads.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

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
   * GET /api/media/:folder/:filename
   * Redirects to the actual storage provider's public URL
   */
  @Get(':folder/:filename')
  getMedia(
    @Param('folder') folder: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    const key = `${folder}/${filename}`;
    const url = this.storageService.getPublicUrl(key);
    return res.redirect(url);
  }
}
