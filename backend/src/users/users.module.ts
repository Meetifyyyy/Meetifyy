import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BlocksService } from './blocks.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, NotificationsModule, RedisModule],
  controllers: [UsersController],
  providers: [UsersService, BlocksService],
  exports: [UsersService, BlocksService],
})
export class UsersModule {}
