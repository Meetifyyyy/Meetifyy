import { Controller, Get, Patch, Delete, Param, Query, Req, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { NotificationType } from '@prisma/client';

/**
 * Notification kinds a client may filter the feed down to. MESSAGE is
 * deliberately absent — it is surfaced by the chat badge, not this list.
 */
const ALLOWED_NOTIFICATION_FILTERS: NotificationType[] = [NotificationType.ACTIVITY_INVITE];

@Controller('api/notifications')
@UseGuards(JwtGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async getNotifications(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('type') type?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 20;
    // Allow-listed rather than passed through: an unvalidated value would reach
    // Prisma as an enum filter and throw on anything unexpected.
    const parsedType = ALLOWED_NOTIFICATION_FILTERS.includes(type as any)
      ? (type as NotificationType)
      : undefined;
    return this.notificationsService.getNotifications(req.user.id, limitNum, cursor, parsedType);
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
