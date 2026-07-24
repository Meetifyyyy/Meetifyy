import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminAuditService } from './admin-audit.service';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';

@UseGuards(AdminJwtGuard)
@Controller('admin/audit')
export class AdminAuditController {
  constructor(private readonly auditService: AdminAuditService) {}

  @Get('logs')
  async listAuditLogs(
    @Query('action') action?: string,
    @Query('targetType') targetType?: string,
    @Query('adminId') adminId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditService.listAuditLogs({
      action,
      targetType,
      adminId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('security-events')
  async getSecurityEvents(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditService.getSecurityEvents({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('login-audits')
  async getLoginAudits(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditService.getLoginAudits({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
