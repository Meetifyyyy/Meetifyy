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
import { ModerationService } from './moderation.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { SubmitReportDto } from './dto/submit-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { BulkActionReportDto } from './dto/bulk-action-report.dto';
import { ReportStatus, ReportPriority } from '@prisma/client';

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
    @Req() req: any,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.moderationService.submitReport(req.user.id, body, ip, userAgent);
  }

  /**
   * Super Admin / Moderator Endpoint: List paginated & filtered reports
   */
  @Get()
  @UseGuards(AdminGuard)
  async listReports(
    @Query('status') status?: ReportStatus,
    @Query('targetType') targetType?: any,
    @Query('priority') priority?: ReportPriority,
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
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  /**
   * Super Admin Dashboard: Moderation metrics & analytics
   */
  @Get('stats')
  @UseGuards(AdminGuard)
  async getReportStats() {
    return this.moderationService.getReportStats();
  }

  /**
   * Super Admin / Moderator: Get single report details with hydrated target preview
   */
  @Get(':id')
  @UseGuards(AdminGuard)
  async getReportById(@Param('id') id: string) {
    return this.moderationService.getReportById(id);
  }

  /**
   * Super Admin / Moderator: Update report status/priority/notes
   */
  @Patch(':id')
  @UseGuards(AdminGuard)
  async updateReport(
    @Param('id') id: string,
    @Body() body: UpdateReportDto,
    @Req() req: any,
  ) {
    const adminUserId = req.dbUser?.id || req.user?.id;
    return this.moderationService.updateReport(id, body, adminUserId);
  }

  /**
   * Super Admin: Bulk action on multiple reports
   */
  @Post('bulk-action')
  @UseGuards(AdminGuard)
  async bulkAction(@Body() body: BulkActionReportDto, @Req() req: any) {
    const adminUserId = req.dbUser?.id || req.user?.id;
    return this.moderationService.bulkAction(body, adminUserId);
  }
}
