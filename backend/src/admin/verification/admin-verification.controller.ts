import { Controller, Get, Patch, Param, Body, UseGuards, Query } from '@nestjs/common';
import { AdminVerificationService } from './admin-verification.service';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { VerificationStatus } from '@prisma/client';

@Controller('api/admin/verification')
@UseGuards(JwtGuard, AdminGuard)
export class AdminVerificationController {
  constructor(private readonly adminVerificationService: AdminVerificationService) {}

  @Get('requests')
  async listRequests(
    @Query('status') status?: VerificationStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 20;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    return this.adminVerificationService.listRequests(status, limitNum, offsetNum);
  }

  @Patch('requests/:id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: VerificationStatus,
    @Body('adminNotes') adminNotes?: string,
  ) {
    return this.adminVerificationService.updateStatus(id, status, adminNotes);
  }
}
