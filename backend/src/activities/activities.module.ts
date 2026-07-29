import { Module, forwardRef } from '@nestjs/common';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { ActivityAuthorizationService } from './activity-authorization.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RedisModule } from '../redis/redis.module';
import { BullModule } from '@nestjs/bullmq';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor';

@Module({
  imports: [
    PrismaModule,
    SupabaseModule,
    NotificationsModule,
    UsersModule,
    RedisModule,
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
    forwardRef(() => RealtimeModule),
  ],
  controllers: [ActivitiesController],
  providers: [ActivitiesService, ActivityAuthorizationService],
  exports: [ActivitiesService, ActivityAuthorizationService]
})
export class ActivitiesModule {}

