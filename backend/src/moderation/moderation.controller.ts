import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Ip,
  Headers,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { ModerationService } from './moderation.service';
import { JwtGuard } from '../common/guards';
import { SubmitReportDto } from './dto/submit-report.dto';

@Controller('api/reports')
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  /**
   * Public Authenticated User Endpoint: Submit a new report
   */
  @Post()
  @UseGuards(JwtGuard)
  async submitReport(
    @Body() body: SubmitReportDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.moderationService.submitReport(
      req.user.id,
      body,
      ip,
      userAgent,
    );
  }

  /**
   * The admin-facing report operations used to live here too, behind
   * `AdminGuard`. They were a weaker-guarded duplicate of
   * `AdminReportsController` (`admin/reports`), which delegates to this same
   * service, is what the admin client actually calls, and is covered by the
   * audit interceptor.
   *
   * Nothing called the copies, and they were strictly worse: `AdminGuard`
   * accepts a shared `x-super-admin-api-key` header — authenticating the caller
   * as nobody in particular — performs no CSRF check on a mutating request, and
   * never verifies that the admin session is still live. Removing them deletes
   * the attack surface rather than hardening a second copy of it.
   */
}
