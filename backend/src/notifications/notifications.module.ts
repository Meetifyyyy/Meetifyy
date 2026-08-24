import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationFactory } from './notification.factory';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsProcessor, NOTIFICATIONS_QUEUE } from './notifications.processor';
import { RedisModule } from '../redis/redis.module';
import { BlocksService } from '../users/blocks.service';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  controllers: [NotificationsController],
  // Provided directly, not via UsersModule — UsersModule imports this module,
  // so importing it back would be a cycle.
  providers: [NotificationsService, NotificationFactory, NotificationsProcessor, BlocksService],
  exports: [NotificationsService, NotificationFactory],
})
export class NotificationsModule {}
