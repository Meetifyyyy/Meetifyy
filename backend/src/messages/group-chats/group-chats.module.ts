import { Module, forwardRef } from '@nestjs/common';
import { GroupChatsController } from './group-chats.controller';
import { GroupChatsService } from './group-chats.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { PresenceModule } from '../../presence/presence.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { MessagingCoreModule } from '../core/messaging-core.module';
import { MentionsModule } from '../../mentions/mentions.module';

@Module({
  imports: [
    PrismaModule,
    PresenceModule,
    forwardRef(() => RealtimeModule),
    NotificationsModule,
    MessagingCoreModule,
    MentionsModule,
  ],
  controllers: [GroupChatsController],
  providers: [GroupChatsService],
  exports: [GroupChatsService],
})
export class GroupChatsModule {}
