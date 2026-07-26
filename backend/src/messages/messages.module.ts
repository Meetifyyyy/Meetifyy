import { Module, forwardRef } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MessagingCoreModule } from './core/messaging-core.module';

@Module({
  imports: [PrismaModule, forwardRef(() => RealtimeModule), NotificationsModule, MessagingCoreModule],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService]
})
export class MessagesModule {}
