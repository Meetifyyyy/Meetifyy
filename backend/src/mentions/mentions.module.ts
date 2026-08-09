import { Module } from '@nestjs/common';
import { MentionsService } from './mentions.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [MentionsService],
  exports: [MentionsService],
})
export class MentionsModule {}
