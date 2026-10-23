import { Module } from '@nestjs/common';
import { ConfessionsController } from './confessions.controller';
import { ConfessionsService } from './confessions.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, SupabaseModule, RedisModule],
  controllers: [ConfessionsController],
  providers: [ConfessionsService],
  exports: [ConfessionsService],
})
export class ConfessionsModule {}
