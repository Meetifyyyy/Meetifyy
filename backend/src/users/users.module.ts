import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import {
  BlockedContactsController,
  BlocksController,
} from './blocked-contacts.controller';
import { UsersService } from './users.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BlocksService } from './blocks.service';
import { RedisModule } from '../redis/redis.module';
import { BullModule } from '@nestjs/bullmq';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor';
import { PresenceModule } from '../presence/presence.module';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    RedisModule,
    PresenceModule,
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  controllers: [UsersController, BlockedContactsController, BlocksController],
  providers: [UsersService, BlocksService],
  exports: [UsersService, BlocksService],
})
export class UsersModule {}
