import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminAuditService } from './admin-audit.service';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { PageLimitPipe, PageNumberPipe } from '../../common/pagination';

@UseGuards(AdminJwtGuard)
@Controller('admin/audit')
export class AdminAuditController {
  constructor(private readonly auditService: AdminAuditService) {}

  @Get('logs')
  async listAuditLogs(
    @Query('action') action?: string,
    @Query('targetType') targetType?: string,
    @Query('adminId') adminId?: string,
    @Query('page', new PageNumberPipe({ max: 1000 })) page?: number,
    @Query('limit', new PageLimitPipe({ default: 20, max: 100 }))
    limit?: number,
  ) {
    return this.auditService.listAuditLogs({
      action,
      targetType,
      adminId,
      page,
      limit,
    });
  }

  @Get('security-events')
  async getSecurityEvents(
    @Query('page', new PageNumberPipe({ max: 1000 })) page?: number,
    @Query('limit', new PageLimitPipe({ default: 20, max: 100 }))
    limit?: number,
  ) {
    return this.auditService.getSecurityEvents({
      page,
      limit,
    });
  }

  @Get('login-audits')
  async getLoginAudits(
    @Query('page', new PageNumberPipe({ max: 1000 })) page?: number,
    @Query('limit', new PageLimitPipe({ default: 20, max: 100 }))
    limit?: number,
  ) {
    return this.auditService.getLoginAudits({
      page,
      limit,
    });
  }
}
