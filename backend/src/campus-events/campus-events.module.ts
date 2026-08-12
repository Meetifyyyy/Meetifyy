import { Module } from '@nestjs/common';
import { CampusEventsController } from './campus-events.controller';
import { CampusEventsService } from './campus-events.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, SupabaseModule, RedisModule],
  controllers: [CampusEventsController],
  providers: [CampusEventsService],
  exports: [CampusEventsService],
})
export class CampusEventsModule {}
