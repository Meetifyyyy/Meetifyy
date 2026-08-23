import { Module, Global } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { SupabaseModule } from '../supabase/supabase.module';
import { MessagesModule } from '../messages/messages.module';
import { PresenceModule } from '../presence/presence.module';
import { InstantMatchModule } from '../instant-match/instant-match.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityAccessModule } from '../activities/activity-access.module';
import { CommunitiesModule } from '../communities/communities.module';

@Global()
@Module({
  imports: [SupabaseModule, MessagesModule, PresenceModule, InstantMatchModule, PrismaModule, ActivityAccessModule, CommunitiesModule],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
