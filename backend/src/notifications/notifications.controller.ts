import { Controller, Get, Patch, Delete, Param, Query, Req, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtGuard } from '../common/guards/jwt.guard'; 

@Controller('api/notifications')
@UseGuards(JwtGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async getNotifications(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.notificationsService.getNotifications(req.user.id, limitNum, cursor);
  }

  @Get('unread-count')
  async getUnreadCount(@Req() req: any) {
    return this.notificationsService.getUnreadCount(req.user.id);
  }

  @Patch('read-all')
  async markAllAsRead(@Req() req: any) {
    return this.notificationsService.markAllAsRead(req.user.id);
  }

  @Patch(':id/read')
  async markAsRead(@Req() req: any, @Param('id') id: string) {
    return this.notificationsService.markAsRead(id, req.user.id);
  }

  @Delete(':id')
  async deleteNotification(@Req() req: any, @Param('id') id: string) {
    return this.notificationsService.deleteNotification(id, req.user.id);
  }
}
