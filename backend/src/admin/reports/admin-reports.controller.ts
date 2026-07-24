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
import { ModerationService } from '../../moderation/moderation.service';
import { UpdateReportDto } from '../../moderation/dto/update-report.dto';
import { BulkActionReportDto } from '../../moderation/dto/bulk-action-report.dto';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { ReportStatus, ReportPriority } from '@prisma/client';

@UseGuards(AdminJwtGuard)
@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly moderationService: ModerationService) {}

  @Get()
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
    @Req() req: any,
  ) {
    return this.moderationService.updateReport(id, dto, req.admin?.id);
  }

  @Post('bulk')
  async bulkAction(@Body() dto: BulkActionReportDto, @Req() req: any) {
    return this.moderationService.bulkAction(dto, req.admin?.id);
  }
}
