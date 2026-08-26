import { Module, forwardRef } from '@nestjs/common';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { ActivityAccessModule } from './activity-access.module';
import { ActivityDiscussionController } from './discussion/activity-discussion.controller';
import { ActivityDiscussionService } from './discussion/activity-discussion.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RedisModule } from '../redis/redis.module';
import { BullModule } from '@nestjs/bullmq';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor';
import { PresenceModule } from '../presence/presence.module';

@Module({
  imports: [
    PrismaModule,
    ActivityAccessModule,
    SupabaseModule,
    NotificationsModule,
    UsersModule,
    RedisModule,
    PresenceModule,
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
    forwardRef(() => RealtimeModule),
  ],
  controllers: [ActivitiesController, ActivityDiscussionController],
  providers: [ActivitiesService, ActivityDiscussionService],
  exports: [ActivitiesService, ActivityAccessModule],
})
export class ActivitiesModule {}
