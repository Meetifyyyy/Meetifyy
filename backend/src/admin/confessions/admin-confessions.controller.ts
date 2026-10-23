import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { ConfessionStatus } from '@prisma/client';
import type { AdminRequest } from '../../common/types/authenticated-request';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { ConfessionsService } from '../../confessions/confessions.service';
import { ModerateConfessionDto } from '../../confessions/dto/confession.dto';

/**
 * Moderator actions on anonymous confessions. Reports reach moderators
 * through /admin/reports (target type CONFESSION, with the author's account
 * resolved for them there); this is where they act on one. The admin audit
 * interceptor records every call.
 */
@UseGuards(AdminJwtGuard)
@Controller('admin/confessions')
export class AdminConfessionsController {
  constructor(private readonly confessions: ConfessionsService) {}

  @Patch(':id')
  async moderate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ModerateConfessionDto,
    @Req() req: AdminRequest,
  ): Promise<{ id: string; status: ConfessionStatus; reportCount: number }> {
    return this.confessions.moderate(id, dto.status, req.admin?.id);
  }
}
