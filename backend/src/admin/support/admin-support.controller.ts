import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AdminSupportService } from './admin-support.service';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';

@UseGuards(AdminJwtGuard)
@Controller('admin/support')
export class AdminSupportController {
  constructor(private readonly supportService: AdminSupportService) {}

  @Get()
  async listTickets(
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.supportService.listTickets({
      status,
      category,
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  async getTicket(@Param('id') id: string) {
    return this.supportService.getTicketById(id);
  }

  @Post(':id/reply')
  async replyToTicket(
    @Param('id') id: string,
    @Body() dto: { body: string; isInternal?: boolean; attachments?: any },
    @Req() req: any,
  ) {
    return this.supportService.replyToTicket(id, dto, req.admin?.id);
  }

  @Patch(':id/status')
  async updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.supportService.updateTicketStatus(id, status);
  }
}
