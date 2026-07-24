import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { JwtGuard } from '../common/guards/jwt.guard';

class PresignDto {
  filename: string;
  contentType: string;
  folder?: string;
}

@Controller('api/uploads')
@UseGuards(JwtGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  /**
   * POST /api/uploads/presign
   * Returns a presigned PUT URL + public URL for direct browser → R2 uploads.
   */
  @Post('presign')
  async presign(@Body() body: PresignDto) {
    const { filename, contentType, folder = 'general' } = body;
    return this.uploadsService.presign(filename, contentType, folder);
  }
}
