import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PrismaModule } from '../prisma/prisma.module';

import { NotificationFactory } from './notification.factory';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationFactory],
  exports: [NotificationsService, NotificationFactory],
})
export class NotificationsModule {}
