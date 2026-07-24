import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { LinkPreviewService } from './link-preview.service';
import { JwtGuard } from '../common/guards/jwt.guard';

@Controller('api/link-preview')
@UseGuards(JwtGuard)
export class LinkPreviewController {
  constructor(private readonly linkPreviewService: LinkPreviewService) {}

  @Get()
  async getPreview(@Query('url') url: string) {
    return this.linkPreviewService.getPreview(url);
  }
}
