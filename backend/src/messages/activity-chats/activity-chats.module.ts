import { Module, forwardRef } from '@nestjs/common';
import { ActivityChatsController } from './activity-chats.controller';
import { ActivityChatsService } from './activity-chats.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { PresenceModule } from '../../presence/presence.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { MessagingCoreModule } from '../core/messaging-core.module';

@Module({
  imports: [
    PrismaModule,
    PresenceModule,
    forwardRef(() => RealtimeModule),
    NotificationsModule,
    MessagingCoreModule,
  ],
  controllers: [ActivityChatsController],
  providers: [ActivityChatsService],
  exports: [ActivityChatsService],
})
export class ActivityChatsModule {}
