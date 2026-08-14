import { Module, forwardRef } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MessagingCoreModule } from './core/messaging-core.module';
import { RedisModule } from '../redis/redis.module';
import { MentionsModule } from '../mentions/mentions.module';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    forwardRef(() => RealtimeModule),
    NotificationsModule,
    MessagingCoreModule,
    MentionsModule,
  ],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService]
})
export class MessagesModule {}

