import { Module } from '@nestjs/common';
import { CommunitiesController } from './communities.controller';
import { CommunitiesService } from './communities.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { PresenceModule } from '../presence/presence.module';

@Module({
  imports: [PrismaModule, SupabaseModule, PresenceModule],
  controllers: [CommunitiesController],
  providers: [CommunitiesService],
  // RealtimeGateway needs the online-member count to push "active now"
  // updates into community rooms.
  exports: [CommunitiesService],
})
export class CommunitiesModule {}
