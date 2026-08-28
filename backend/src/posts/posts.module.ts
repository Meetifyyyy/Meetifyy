import { Module } from '@nestjs/common';
import { PostsService } from './posts.service';
import { ContentDeletionAuthorizer } from './content-deletion.authorizer';
import { PostsController } from './posts.controller';

import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { MentionsModule } from '../mentions/mentions.module';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [NotificationsModule, UsersModule, MentionsModule, UploadsModule],
  providers: [PostsService, ContentDeletionAuthorizer],
  controllers: [PostsController],
})
export class PostsModule {}

