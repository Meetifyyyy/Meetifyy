import { Module, Global } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { SupabaseModule } from '../supabase/supabase.module';
import { MessagesModule } from '../messages/messages.module';
import { PresenceModule } from '../presence/presence.module';
import { InstantMatchModule } from '../instant-match/instant-match.module';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [SupabaseModule, MessagesModule, PresenceModule, InstantMatchModule, PrismaModule],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
