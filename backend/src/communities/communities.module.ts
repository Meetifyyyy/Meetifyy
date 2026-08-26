import { Module } from '@nestjs/common';
import { CommunitiesController } from './communities.controller';
import { CommunitiesService } from './communities.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { PresenceModule } from '../presence/presence.module';
import { RedisModule } from '../redis/redis.module';
import { BlocksService } from '../users/blocks.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    PrismaModule,
    SupabaseModule,
    PresenceModule,
    RedisModule,
    NotificationsModule,
  ],
  controllers: [CommunitiesController],
  // BlocksService is provided directly rather than via UsersModule; its cache is
  // static, so every copy shares one map. (This once also avoided pulling in
  // notifications — no longer true: moderator promotions notify the promoted
  // member, so NotificationsModule is imported above deliberately.)
  providers: [CommunitiesService, BlocksService],
  // RealtimeGateway needs the online-member count to push "active now"
  // updates into community rooms.
  exports: [CommunitiesService],
})
export class CommunitiesModule {}
