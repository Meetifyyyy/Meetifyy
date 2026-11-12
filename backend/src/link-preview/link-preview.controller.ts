import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { LinkPreviewService } from './link-preview.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { RateLimitPolicyGuard } from '../common/rate-limit/rate-limit-policy.guard';

@Controller('api/link-preview')
@UseGuards(JwtGuard)
export class LinkPreviewController {
  constructor(private readonly linkPreviewService: LinkPreviewService) {}

  /**
   * The policy guard sits on the handler, after the class-level JwtGuard: a
   * user-keyed policy reads the identity that guard attaches, and the
   * decorator alone enforces nothing.
   */
  @Get()
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('link-preview.user')
  async getPreview(@Query('url') url: string) {
    return this.linkPreviewService.getPreview(url);
  }
}
