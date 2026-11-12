import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { AdminRequest } from '../../common/types/authenticated-request';
import { ModerationService } from '../../moderation/moderation.service';
import { UpdateReportDto } from '../../moderation/dto/update-report.dto';
import { BulkActionReportDto } from '../../moderation/dto/bulk-action-report.dto';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { clientIp } from '../../common/rate-limit/client-ip.util';
import {
  AdminReportsService,
  type RevealedConfessionAuthor,
} from './admin-reports.service';
import { RevealConfessionAuthorDto } from './reveal-confession-author.dto';

@UseGuards(AdminJwtGuard)
@Controller('admin/reports')
export class AdminReportsController {
  constructor(
    private readonly moderationService: ModerationService,
    private readonly reports: AdminReportsService,
  ) {}

  @Get()
  async listReports(
    // Plain strings, as a query string is: the service validates them.
    @Query('status') status?: string,
    @Query('targetType') targetType?: string,
    @Query('priority') priority?: string,
    @Query('reporterId') reporterId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.moderationService.listReports({
      status,
      targetType,
      priority,
      reporterId,
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('stats')
  async getReportStats() {
    return this.moderationService.getReportStats();
  }

  @Get(':id')
  async getReportById(@Param('id') id: string) {
    return this.moderationService.getReportById(id);
  }

  @Patch(':id')
  async updateReport(
    @Param('id') id: string,
    @Body() dto: UpdateReportDto,
    @Req() req: AdminRequest,
  ) {
    return this.moderationService.updateReport(id, dto, req.admin?.id);
  }

  @Post('bulk')
  async bulkAction(@Body() dto: BulkActionReportDto, @Req() req: AdminRequest) {
    return this.moderationService.bulkAction(dto, req.admin?.id);
  }

  /**
   * The only way to see who wrote an anonymous confession. A reason is
   * required and recorded; AuditInterceptor also writes its generic row for
   * this POST (the reason, no identity), alongside the specific one.
   */
  @Post(':id/reveal-author')
  async revealAuthor(
    @Param('id') id: string,
    @Body() dto: RevealConfessionAuthorDto,
    @Req() req: AdminRequest,
  ): Promise<{ author: RevealedConfessionAuthor }> {
    const requestId = req.headers['x-request-id'];
    return this.reports.revealConfessionAuthor(id, dto.reason, {
      adminId: req.admin.id,
      ip: clientIp(req) || req.ip || '0.0.0.0',
      endpoint: req.originalUrl || req.url || '',
      httpMethod: (req.method || 'POST').toUpperCase(),
      requestId: typeof requestId === 'string' ? requestId || null : null,
    });
  }
}
