import { Module, forwardRef } from '@nestjs/common';
import { MessagingCoreService } from './messaging-core.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { PresenceModule } from '../../presence/presence.module';
import { RealtimeModule } from '../../realtime/realtime.module';

@Module({
  imports: [PrismaModule, PresenceModule, forwardRef(() => RealtimeModule)],
  providers: [MessagingCoreService],
  exports: [MessagingCoreService]
})
export class MessagingCoreModule {}
