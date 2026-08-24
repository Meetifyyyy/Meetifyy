import { Module, forwardRef } from '@nestjs/common';
import { DmController } from './dm.controller';
import { DmService } from './dm.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { PresenceModule } from '../../presence/presence.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { MessagingCoreModule } from '../core/messaging-core.module';
import { MentionsModule } from '../../mentions/mentions.module';
import { BlocksService } from '../../users/blocks.service';

@Module({
  imports: [
    PrismaModule,
    PresenceModule,
    forwardRef(() => RealtimeModule),
    NotificationsModule,
    MessagingCoreModule,
    MentionsModule,
  ],
  controllers: [DmController],
  providers: [DmService, BlocksService],
  exports: [DmService],
})
export class DmModule {}
