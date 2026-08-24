import { Module } from '@nestjs/common';
import { CommunitiesController } from './communities.controller';
import { CommunitiesService } from './communities.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { PresenceModule } from '../presence/presence.module';
import { RedisModule } from '../redis/redis.module';
import { BlocksService } from '../users/blocks.service';

@Module({
  imports: [PrismaModule, SupabaseModule, PresenceModule, RedisModule],
  controllers: [CommunitiesController],
  // BlocksService is provided directly rather than via UsersModule to avoid
  // pulling notifications and a queue registration into this module; its cache
  // is static, so every copy shares one map.
  providers: [CommunitiesService, BlocksService],
  // RealtimeGateway needs the online-member count to push "active now"
  // updates into community rooms.
  exports: [CommunitiesService],
})
export class CommunitiesModule {}
