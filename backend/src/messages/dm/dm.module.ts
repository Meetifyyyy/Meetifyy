import { Module, forwardRef } from '@nestjs/common';
import { DmController } from './dm.controller';
import { DmService } from './dm.service';
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
  controllers: [DmController],
  providers: [DmService],
  exports: [DmService],
})
export class DmModule {}
